// =============================================================================
//  TM TRADING — candle recorder for the market plane (roadmap v3 §23).
//
//  The market plane is transport/aggregation only (D15); PERSISTENCE is a
//  separate consumer that subscribes to the plane bus and writes CLOSED candles
//  into Mongo `candles`, while keeping the §23.4 dataset manifest (`datasets`)
//  in sync. Pure + dependency-free (no mongoose, no IO): the caller injects the
//  two Mongoose models, so this module runs plain-node in tests and never pulls
//  a driver into `market/`.
//
//  Honesty rules enforced here:
//    - only CLOSED bars are recorded (forming bars are transient; D20 the
  //      distinction is explicit) → recorded bars are final facts (D12),
//    - `_id = symbol:timeframe:openTime` upserts, so a re-emitted close is a
//      no-op instead of a duplicate (D3/D4),
//    - Mongo down/malformed rows never break the data plane (fail-soft): they
//      are counted, re-buffered for retry, and surfaced via stats() (D27/§40).
//    - per-dataset manifest derives start/end/count from MEASURED rows, never
//      guessed timestamps; checksum stays null until an offline reconcile (§24).
// =============================================================================

import { TOPICS } from './events.mjs'

export const CANDLE_SCHEMA_VERSION = 'candle.v1'
export const DATASET_SCHEMA_VERSION = 'dataset.v1'
export const DEFAULT_RETENTION_DAYS = 90
export const RECORDER_VERSION = 'recorder.v1'

const finite = (v) => Number.isFinite(Number(v))

/** Idempotent natural key for a closed candle row (D3/D4). */
export function candleId(symbol, timeframe, openTime) {
  return `${symbol}:${timeframe}:${openTime}`
}

/** Dataset natural key (kind×source×symbol×timeframe) — §23.4 manifest. */
export function datasetIdFor(kind, source, symbol, timeframe) {
  return `${kind}:${source}:${symbol}:${timeframe}`
}

/**
 * Map a canonical `market.candle` (CLOSED) event to a record row.
 * Returns null when the payload is malformed (never fabricate, D12); the caller
 * counts those as `invalid`.
 */
export function candleRecord(ev) {
  if (!ev || typeof ev !== 'object') return null
  const symbol = String(ev.symbol || '')
  const timeframe = String(ev.timeframe || '')
  const source = String(ev.source || '')
  if (!symbol || !timeframe || !source) return null
  if (ev.state !== 'closed') return null
  const open = Number(ev.open)
  const high = Number(ev.high)
  const low = Number(ev.low)
  const close = Number(ev.close)
  const volume = Number(ev.volume ?? 0)
  const openTime = Number(ev.openTime)
  const closeTime = Number(ev.closeTime)
  const eventTime = Number(ev.eventTime ?? closeTime)
  const ingestTime = Number(ev.ingestTime ?? eventTime)
  const okNum = (v, min) => finite(v) && v >= min
  if (!okNum(open, 0) || !okNum(high, 0) || !okNum(low, 0) || !okNum(close, 0)) return null
  if (volume < 0 || !Number.isFinite(volume)) return null
  if (!finite(openTime) || !finite(closeTime) || closeTime <= openTime) return null
  if (high < Math.max(open, close) || low > Math.min(open, close)) return null
  return {
    _id: candleId(symbol, timeframe, openTime),
    symbol,
    timeframe,
    market: ev.market ? String(ev.market) : null,
    source,
    state: 'closed',
    open,
    high,
    low,
    close,
    volume,
    openTime,
    closeTime,
    eventTime,
    ingestTime,
    schemaVersion: CANDLE_SCHEMA_VERSION,
  }
}

/** Group record rows into per-dataset manifest patches (§23.4). */
export function manifestPatches(rows, { retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const by = new Map()
  for (const r of rows) {
    const key = datasetIdFor('candles', r.source, r.symbol, r.timeframe)
    let g = by.get(key)
    if (!g) {
      g = {
        datasetId: key,
        kind: 'candles',
        source: r.source,
        symbol: r.symbol,
        timeframe: r.timeframe,
        startTs: Infinity,
        endTs: -Infinity,
        countNew: 0,
        retentionDays,
      }
      by.set(key, g)
    }
    g.startTs = Math.min(g.startTs, r.openTime)
    g.endTs = Math.max(g.endTs, r.closeTime)
    g.countNew += 1
  }
  return [...by.values()]
}

/**
 * Newly-upserted _ids from a raw bulkWrite result. Modern drivers expose
 * `result.upserted` (array of {index, _id}); older ones expose only a count —
 * we return null then and the caller treats every row as new (approximate).
 */
export function upsertedIds(raw) {
  const u = raw?.upserted
  if (Array.isArray(u)) return new Set(u.map((x) => String(x._id)))
  return null
}

/**
 * Attach candle persistence to a plane bus.
 *
 * @param {object} opts
 * @param {object}  opts.bus          plane event bus (on/emit)
 * @param {object}  opts.candleModel  Mongoose model `candles` (injected)
 * @param {object}  opts.datasetModel Mongoose model `datasets` (injected)
 * @param {object}  [opts.clock]      { now(): number } — default Date.now
 * @param {number}  [opts.retentionDays=90]
 * @param {number}  [opts.batchIntervalMs=2000] flush heartbeat
 * @param {number}  [opts.maxBatchSize=500]     flush when buffer reaches N
 * @returns recorder handle { start, stop, flush, stats }
 */
export function createCandleRecorder({
  bus,
  candleModel,
  datasetModel,
  clock = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  batchIntervalMs = 2_000,
  maxBatchSize = 500,
} = {}) {
  if (!bus || !candleModel || !datasetModel) throw new Error('recorder: bus, candleModel and datasetModel are required')
  const now = clock?.now ? clock?.now.bind(clock) : () => Date.now()

  /** symbol:tf:openTime -> record (dedupe inside the buffer — one final row). */
  const buffer = new Map()
  let unsub = null
  let timer = null
  let started = false
  let flushing = false

  const stats = {
    started: false,
    schemaVersion: CANDLE_SCHEMA_VERSION,
    recorderVersion: RECORDER_VERSION,
    buffered: 0,
    written: 0, // freshly upserted rows (new inserts only)
    duplicate: 0,
    invalid: 0,
    errors: 0,
    lastError: null,
    lastTs: null,
    flushedAt: null,
  }

  const onCandle = (ev) => {
    if (!ev || ev.type !== TOPICS.CANDLE) return
    const row = candleRecord(ev)
    if (!row) {
      stats.invalid += 1
      return
    }
    if (buffer.has(row._id)) {
      stats.duplicate += 1
      return
    }
    buffer.set(row._id, row)
    stats.buffered = buffer.size
    if (buffer.size >= maxBatchSize) void flush().catch(() => {}) // async, fire-and-forget
  }

  async function applyDatasetPatches(rows, newIds) {
    const patches = manifestPatches(rows, { retentionDays })
    for (const p of patches) {
      const fresh = newIds ? rows.filter((r) => newIds.has(r._id) && r.symbol === p.symbol && r.timeframe === p.timeframe) : rows.filter((r) => r.symbol === p.symbol && r.timeframe === p.timeframe)
      const countNew = fresh.length
      if (countNew <= 0) continue
      try {
        await datasetModel.collection.updateOne(
          { datasetId: p.datasetId },
          {
            $min: { startTs: p.startTs },
            $max: { endTs: p.endTs },
            $inc: { count: countNew },
            $set: {
              kind: p.kind,
              source: p.source,
              symbol: p.symbol,
              timeframe: p.timeframe,
              schemaVersion: DATASET_SCHEMA_VERSION,
              retentionDays: p.retentionDays,
              compression: 'none',
              checksum: null, // honest: only an offline reconcile (§24) computes one
              updatedAt: new Date(now()),
            },
            $setOnInsert: { datasetId: p.datasetId, createdAt: new Date(now()) },
          },
          { upsert: true },
        )
      } catch (e) {
        // manifest bookkeeping must never sink the data path
        stats.errors += 1
        stats.lastError = String(e?.message || e)
      }
    }
  }

  async function flush() {
    if (!buffer.size || flushing) return
    flushing = true
    const rows = [...buffer.values()]
    buffer.clear()
    stats.buffered = 0
    try {
      const ops = rows.map((r) => ({
        updateOne: {
          filter: { _id: r._id },
          update: { $set: r, $setOnInsert: { _id: r._id, createdAt: r.ingestTime ? new Date(r.ingestTime) : new Date(now()) } },
          upsert: true,
        },
      }))
      const raw = await candleModel.collection.bulkWrite(ops, { ordered: false })
      const written = Number(raw?.upsertedCount ?? raw?.insertedCount ?? rows.length)
      const newIds = upsertedIds(raw)
      // `written` only counts rows FRESH on this flush; a row the DB already
      // holds upserts to nothing (matched, unchanged) and is deliberately NOT
      // counted as an anomaly — it was recorded once before (D4). `duplicate`
      // above counts only re-emissions inside the same buffer window.
      stats.written += written
      stats.lastTs = rows[rows.length - 1].eventTime
      stats.flushedAt = now()
      await applyDatasetPatches(rows, newIds)
    } catch (e) {
      // fail-soft: a Mongo outage must never break the data plane (D33);
      // re-buffer the failed rows so the next flush retries exactly them.
      stats.errors += 1
      stats.lastError = String(e?.message || e)
      for (const r of rows) if (!buffer.has(r._id)) buffer.set(r._id, r)
      stats.buffered = buffer.size
    } finally {
      flushing = false
    }
  }

  return {
    start() {
      if (started) return
      started = true
      unsub = bus.on(TOPICS.CANDLE, onCandle)
      timer = setInterval(() => { void flush().catch(() => {}) }, batchIntervalMs)
      if (typeof timer.unref === 'function') timer.unref()
      stats.started = true
    },
    async stop(flushPending = false) {
      if (!started) return
      started = false
      stats.started = false
      if (timer) { clearInterval(timer); timer = null }
      if (unsub) { unsub(); unsub = null }
      if (flushPending) await flush()
    },
    flush,
    stats: () => ({ ...stats }),
  }
}