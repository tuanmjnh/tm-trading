import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SNAPSHOT_SCHEMA_VERSION,
  snapshotIdFor,
  snapshotHash,
  barOf,
  snapshotRecord,
  recordDecisionSnapshot,
} from '../exec/snapshot.mjs'
import {
  DAY_MS,
  retentionCutoff,
  runRetention,
} from '../exec/retention.mjs'
import {
  FEED_SCHEMA_VERSION,
  LIQUIDATION_RETENTION_DAYS,
  feedIdFor,
  feedDatasetId,
  fundingFeedDoc,
  liquidationFeedDoc,
  tradeFeedDoc,
  orderbookFeedDoc,
  createFeedRecorder,
} from '../market/feedRecorder.mjs'

// =============================================================================
//  §23 completion: decision-point market snapshots (§26.3) + retention (§23.4).
//  Pure helpers exercised offline — no Mongo, no clock. The snapshot is the
//  immutable context the risk gate saw at the moment it decided; retention
//  prunes raw candles past their manifest retentionDays and re-syncs the
//  manifest with what really remains (empty dataset = removed, D12).
// =============================================================================

const ctx = {
  alertKey: 'tv_ENTRY_BTCUSDT_2026-10-09T04:00:00.000Z_abc123',
  symbol: 'BTCUSDT',
  venue: 'binance:fapi',
  timeframe: '15m',
  clockTime: 1_700_000_000_000,
  bar: { open: 100, high: 101, low: 99, close: 100.5, volume: 12, time: 1_699_999_800_000 },
  quote: { last: 100.5, time: 1_699_999_800_000 },
  dataQuality: { source: 'binance:kline1m' },
  decision: { ok: true, code: 'APPROVED', message: 'gate approved entry', side: 'BUY', qty: 0.5, notional: 50 },
}

// --- tiny in-memory Mongo fakes (query chain) --------------------------------
const OPS = { $lt: (a, b) => a < b, $gt: (a, b) => a > b, $lte: (a, b) => a <= b, $gte: (a, b) => a >= b }
const matcher = (f, doc) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).every(([op, val]) => (OPS[op] ? OPS[op](doc[k], val) : true))
  }
  return doc[k] === v
})

// Mirrors the real Mongoose shapes: Model.find() returns a QUERY object (not a
// promise) with .sort()/.limit()/.lean(), while Model.findOne() returns one too.
const query = (rows) => ({
  sort: () => query(rows),
  limit: (n) => query(rows.slice(0, n)),
  lean: async () => rows.map((r) => ({ ...r })),
})

const findOneOf = (rows) => ({
  lean: async () => {
    const r = rows.length ? rows[0] : null
    return r ? { ...r } : null
  },
})

const applyPatch = (doc, patch) => {
  if (patch.$set) Object.assign(doc, patch.$set)
  if (patch.$setOnInsert) for (const [k, v] of Object.entries(patch.$setOnInsert)) if (!(k in doc)) doc[k] = v
  if (patch.$inc) for (const [k, v] of Object.entries(patch.$inc)) doc[k] = (Number(doc[k]) || 0) + v
  if (patch.$min) for (const [k, v] of Object.entries(patch.$min)) doc[k] = Math.min(Number(doc[k]) ?? v, v)
  if (patch.$max) for (const [k, v] of Object.entries(patch.$max)) doc[k] = Math.max(Number(doc[k]) ?? v, v)
  return doc
}

// =============================================================================
describe('snapshot helpers (§26.3 market_snapshots)', () => {
  test('snapshotIdFor keys one snapshot per alert (D3)', () => {
    assert.equal(snapshotIdFor('ABC'), 'snap:ABC')
  })

  test('snapshotHash is deterministic and sensitive to context', () => {
    const a = snapshotHash({ bar: { close: 1, open: 2 }, venue: 'x' })
    const b = snapshotHash({ bar: { open: 2, close: 1 }, venue: 'x' }) // key order differs
    assert.equal(a, b)
    assert.notEqual(a, snapshotHash({ bar: { close: 1, open: 3 }, venue: 'x' }))
    assert.match(a, /^[0-9a-f]{64}$/)
  })

  test('barOf normalizes a raw kline and refuses a bar without a close', () => {
    assert.deepEqual(barOf({ open: 1, high: 2, low: 1, close: 1.5, volume: 3, time: 5 }), {
      open: 1, high: 2, low: 1, close: 1.5, volume: 3, time: 5, state: 'closed',
    })
    assert.equal(barOf({ high: 2 }), null)
    assert.equal(barOf(null), null)
  })

  test('snapshotRecord builds the validated §26.3 doc with honest empties', () => {
    const doc = snapshotRecord(ctx)
    assert.ok(doc)
    assert.equal(doc.snapshotId, `snap:${ctx.alertKey}`)
    assert.equal(doc.kind, 'entry-decision')
    assert.equal(doc.instrumentId, 'binance:fapi:BTCUSDT')
    assert.equal(doc.venue, 'binance:fapi')
    assert.equal(doc.clockTime, ctx.clockTime)
    assert.equal(doc.strategyVersionId, null) // no version catalog yet — never guessed
    assert.equal(doc.indicators, null) // pipeline carries no indicator outputs
    assert.deepEqual(doc.methods, [])
    assert.equal(doc.modelVersion, SNAPSHOT_SCHEMA_VERSION)
    assert.equal(doc.bar.state, 'closed')
    assert.equal(doc.dataQuality.source, 'binance:kline1m')
    assert.equal(doc.dataQuality.ageMs, ctx.clockTime - ctx.bar.time)
    assert.deepEqual(doc.decision, {
      ok: true, code: 'APPROVED', message: 'gate approved entry', side: 'BUY', qty: 0.5, notional: 50,
    })
    assert.equal(doc.snapshotHash, snapshotHash({
      venue: 'binance:fapi', symbol: 'BTCUSDT', timeframe: '15m',
      bar: doc.bar, quote: { last: 100.5, bid: null, ask: null, time: ctx.quote.time },
      indicators: null, regime: null,
    }))
  })

  test('snapshotRecord drops a quote that has no timestamp (honest null)', () => {
    const doc = snapshotRecord({ ...ctx, quote: { last: 100 } })
    assert.equal(doc.quote, null)
  })

  test('snapshotRecord refuses malformed input (null, never a guess)', () => {
    assert.equal(snapshotRecord({}), null)
    assert.equal(snapshotRecord({ ...ctx, alertKey: '' }), null)
    assert.equal(snapshotRecord({ ...ctx, symbol: '' }), null)
    assert.equal(snapshotRecord({ ...ctx, venue: '' }), null)
    assert.equal(snapshotRecord({ ...ctx, clockTime: 0 }), null)
    assert.equal(snapshotRecord({ ...ctx, decision: null }), null)
  })

  test('recordDecisionSnapshot upserts $setOnInsert and fails soft', async () => {
    const writes = []
    const model = {
      async updateOne(filter, patch, opts) {
        writes.push({ filter, patch, opts })
        return { upsertedCount: writes.length === 1 ? 1 : 0 }
      },
    }
    const doc = snapshotRecord(ctx)
    assert.deepEqual(await recordDecisionSnapshot(model, doc), { wrote: true })
    assert.deepEqual(await recordDecisionSnapshot(model, doc), { wrote: false })
    assert.equal(writes[0].opts.upsert, true)
    assert.ok(writes[0].patch.$setOnInsert)

    // A throwing model must not propagate (ledger miss never breaks the cycle)
    const boom = { async updateOne() { throw new Error('mongo down') } }
    assert.deepEqual(await recordDecisionSnapshot(boom, doc), { wrote: false })
    // Missing model -> null
    assert.equal(await recordDecisionSnapshot(null, doc), null)
  })
})

// =============================================================================
describe('retention (§23.4 manifest-driven pruning)', () => {
  test('retentionCutoff subtracts retentionDays', () => {
    assert.equal(retentionCutoff(1_000_000_000, 90), 1_000_000_000 - 90 * DAY_MS)
    assert.equal(retentionCutoff(1_000_000_000), 1_000_000_000 - 90 * DAY_MS)
  })

  test('purges old candles, advances startTs, shrinks count exactly', async () => {
    const now = 2_000_000_000_000
    const Candle = {
      rows: [
        { _id: 'c1', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', openTime: now - 200 * DAY_MS },
        { _id: 'c2', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', openTime: now - 10 * DAY_MS },
        { _id: 'c3', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', openTime: now - 5 * DAY_MS },
      ],
      async deleteMany(f) {
        const del = this.rows.filter((c) => matcher(f, c))
        this.rows = this.rows.filter((c) => !matcher(f, c))
        return { deletedCount: del.length }
      },
      find(f) {
        const filtered = this.rows.filter((c) => matcher(f, c)).sort((a, b) => a.openTime - b.openTime)
        return query(filtered)
      },
    }
    const Dataset = {
      rows: [
        { datasetId: 'candles:binance:BTCUSDT:1m', kind: 'candles', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', retentionDays: 90, count: 3, startTs: now - 200 * DAY_MS, endTs: now - 5 * DAY_MS },
      ],
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
      findOne(f) { return findOneOf(this.rows.filter((d) => matcher(f, d))) },
      async updateOne(f, patch) { const d = this.rows.find((r) => matcher(f, r)); if (d) applyPatch(d, patch); return { modifiedCount: d ? 1 : 0 } },
      async deleteOne(f) { const b = this.rows.length; this.rows = this.rows.filter((r) => !matcher(f, r)); return { deletedCount: b - this.rows.length } },
    }

    const s = await runRetention({ models: { Candle, Dataset }, now })
    assert.deepEqual(s, { datasets: 1, purged: 1, removed: 0, errors: 0, skipped: 0 })

    // Only the 200-day candle died; the two retained ones stay untouched
    assert.equal(Candle.rows.length, 2)
    assert.ok(!Candle.rows.some((c) => c._id === 'c1'))
    // Manifest follows what physically remains: startTs advances, count shrinks by EXACTLY purged
    assert.equal(Dataset.rows.length, 1)
    assert.equal(Dataset.rows[0].startTs, now - 10 * DAY_MS)
    assert.equal(Dataset.rows[0].count, 2) // 3 - 1, exactly the purged count
  })

  test('removes a dataset whose count drops to 0', async () => {
    const now = 2_000_000_000_000
    const base = { source: 'binance', symbol: 'BTCUSDT', timeframe: '1m' }
    const Candle = {
      rows: [
        { _id: 'c1', ...base, openTime: now - 500 * DAY_MS },
        { _id: 'c2', ...base, openTime: now - 400 * DAY_MS },
      ],
      async deleteMany(f) {
        const del = this.rows.filter((c) => matcher(f, c))
        this.rows = this.rows.filter((c) => !matcher(f, c))
        return { deletedCount: del.length }
      },
      find(f) {
        return query(this.rows.filter((c) => matcher(f, c)).sort((a, b) => a.openTime - b.openTime))
      },
    }
    const Dataset = {
      rows: [{ datasetId: 'candles:binance:BTCUSDT:1m', kind: 'candles', ...base, retentionDays: 90, count: 2, startTs: now - 500 * DAY_MS }],
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
      findOne(f) { return findOneOf(this.rows.filter((d) => matcher(f, d))) },
      async updateOne(f, patch) { const d = this.rows.find((r) => matcher(f, r)); if (d) applyPatch(d, patch); return { modifiedCount: d ? 1 : 0 } },
      async deleteOne(f) { const b = this.rows.length; this.rows = this.rows.filter((r) => !matcher(f, r)); return { deletedCount: b - this.rows.length } },
    }

    const s = await runRetention({ models: { Candle, Dataset }, now })
    assert.deepEqual(s, { datasets: 1, purged: 2, removed: 1, errors: 0, skipped: 0 })
    assert.equal(Dataset.rows.length, 0) // all purged -> manifest gone
  })

  test('a failing dataset increments errors and sweeps continues', async () => {
    const now = 2_000_000_000_000
    let n = 0
    const Candle = {
      async deleteMany() { n++; if (n === 1) throw new Error('lock timeout'); return { deletedCount: 0 } },
      find() { return query([]) },
    }
    const Dataset = {
      rows: [
        { datasetId: 'a', kind: 'candles', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', retentionDays: 90, count: 1 },
        { datasetId: 'b', kind: 'candles', source: 'binance', symbol: 'ETHUSDT', timeframe: '1m', retentionDays: 90, count: 1 },
      ],
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
    }
    const s = await runRetention({ models: { Candle, Dataset }, now, log: { warn: () => {} } })
    assert.equal(s.errors, 1)
    assert.equal(s.datasets, 2) // second dataset was still attempted
  })

  test('missing models -> skipped, never throws', async () => {
    assert.deepEqual(await runRetention({ models: {}, now: Date.now() }), { datasets: 0, purged: 0, removed: 0, errors: 0, skipped: 1 })
  })
})

// =============================================================================
describe('feed recorder (§23.3 P1 market_feed: funding/OI + liquidation)', () => {
  test('feedIdFor + feedDatasetId keying (D3/D4)', () => {
    assert.equal(feedIdFor('funding', ['BTCUSDT', 99]), 'feed:funding:BTCUSDT:99')
    assert.equal(feedDatasetId('funding', 'binance:fapi'), 'feed:funding:binance:fapi:*')
  })

  test('fundingFeedDoc keys one row per settlement period, leaves OI honest-null', () => {
    const doc = fundingFeedDoc({
      symbol: 'BTCUSDT', rate: 0.0001, price: 60000, nextFundingTime: 123456789,
      ingestTime: 999, market: 'futures',
    })
    assert.equal(doc.feedId, 'feed:funding:BTCUSDT:123456789')
    assert.equal(doc.kind, 'funding')
    assert.equal(doc.eventTime, 123456789) // the settlement period's own time
    assert.equal(doc.schemaVersion, FEED_SCHEMA_VERSION)
    assert.equal(doc.data.rate, 0.0001)
    assert.equal(doc.data.oiContracts, null) // no OI observation -> honest null
    assert.equal(doc.data.oiNotionalUsd, null)
    // OI rides when it was fetched
    const withOi = fundingFeedDoc({ symbol: 'BTCUSDT', rate: 0.0001, price: 60000, nextFundingTime: 123456789, oiContracts: 12, oiNotionalUsd: 720000, ingestTime: 999 })
    assert.equal(withOi.data.oiContracts, 12)
    assert.equal(withOi.data.oiNotionalUsd, 720000)
    assert.equal(fundingFeedDoc({ rate: 0.0001, nextFundingTime: 1 }), null) // no symbol
  })

  test('liquidationFeedDoc keys an immutable event fact and derives usd', () => {
    const doc = liquidationFeedDoc({ symbol: 'ETHUSDT', price: 1800, qty: 2, side: 'long', eventTime: 1111, ingestTime: 2222 })
    assert.equal(doc.feedId, 'feed:liquidation:ETHUSDT:1111:1800:2')
    assert.equal(doc.eventTime, 1111)
    assert.equal(doc.retentionDays, LIQUIDATION_RETENTION_DAYS)
    assert.deepEqual(doc.data, { price: 1800, qty: 2, usd: 3600, side: 'long' })
    assert.equal(liquidationFeedDoc({ symbol: 'ETHUSDT', eventTime: 0 }), null)
  })

  test('tradeFeedDoc keys one row per tradeId and computes usd (aggressor side)', () => {
    const doc = tradeFeedDoc({ symbol: 'BTCUSDT', price: 100, qty: 2, side: 'buy', tradeId: 't1', eventTime: 1111, ingestTime: 2222 })
    assert.equal(doc.feedId, 'feed:trade:BTCUSDT:t1')
    assert.equal(doc.kind, 'trade')
    assert.equal(doc.eventTime, 1111)
    assert.equal(doc.schemaVersion, FEED_SCHEMA_VERSION)
    assert.deepEqual(doc.data, { price: 100, qty: 2, usd: 200, side: 'buy', tradeId: 't1' })
    // unknown side -> honest null
    assert.equal(tradeFeedDoc({ symbol: 'BTCUSDT', price: 1, qty: 1, tradeId: 'x', eventTime: 5 }).data.side, null)
    // no tradeId -> null (no identity)
    assert.equal(tradeFeedDoc({ symbol: 'BTCUSDT', price: 1, qty: 1, eventTime: 5 }), null)
    // price 0 -> null (can't fabricate a fill)
    assert.equal(tradeFeedDoc({ symbol: 'BTCUSDT', price: 0, qty: 1, tradeId: 'x', eventTime: 5 }), null)
    assert.equal(tradeFeedDoc({ symbol: 'BTCUSDT', price: 1, qty: 1, tradeId: 'x', eventTime: 0 }), null)
  })

  test('orderbookFeedDoc keys by lastUpdateId, normalizes best levels honestly', () => {
    const doc = orderbookFeedDoc({
      symbol: 'BTCUSDT',
      bids: [[99, 1], [100, 2], [98, 3]], // unsorted -> best (100) first
      asks: [[102, 1], [101, 5]],
      lastUpdateId: 42,
      eventTime: 1111,
      ingestTime: 2222,
    })
    assert.equal(doc.feedId, 'feed:orderbook:BTCUSDT:42')
    assert.equal(doc.kind, 'orderbook')
    assert.equal(doc.data.bestBid, 100) // normalized: bids desc
    assert.equal(doc.data.bestAsk, 101) // asks asc
    assert.equal(doc.data.bidDepthUsd, 100 * 2 + 99 * 1 + 98 * 3) // sum of recorded levels
    assert.equal(doc.data.askDepthUsd, 101 * 5 + 102 * 1)
    assert.equal(doc.data.lastUpdateId, 42)
    // string levels from the provider normalize to numbers
    const strings = orderbookFeedDoc({ symbol: 'X', bids: [['100.5', '2']], asks: [], lastUpdateId: 1, eventTime: 5 })
    assert.equal(strings.data.bids[0][0], 100.5)
    // empty book -> null (nothing to record)
    assert.equal(orderbookFeedDoc({ symbol: 'X', bids: [], asks: [], lastUpdateId: 1, eventTime: 5 }), null)
    // no lastUpdateId -> null (no identity)
    assert.equal(orderbookFeedDoc({ symbol: 'X', bids: [[1, 1]], asks: [], eventTime: 5 }), null)
    // qty-0 level is kept only when the price is positive; qty is never dropped
    const zero = orderbookFeedDoc({ symbol: 'X', bids: [[100, 0]], asks: [], lastUpdateId: 1, eventTime: 5 })
    assert.equal(zero.data.bids[0][1], 0)
    assert.equal(zero.data.bidDepthUsd, 0)
  })

  test('trade/orderbook builders plug into the same ledger recorder (no re-wire)', async () => {
    const feedRows = []
    const feedModel = {
      async updateOne(filter, patch, opts) {
        const existed = feedRows.some((r) => r.feedId === filter.feedId)
        if (!existed) feedRows.push({ ...patch.$setOnInsert, feedId: filter.feedId })
        return { upsertedCount: existed ? 0 : 1 }
      },
    }
    const datasetModel = {
      async updateOne(filter, patch) {
        let d = this.rows.find((r) => r.datasetId === filter.datasetId)
        if (!d) { d = { ...patch.$setOnInsert, datasetId: filter.datasetId }; this.rows.push(d) }
        applyPatch(d, patch)
        return {}
      },
      rows: [],
    }
    const t = createFeedRecorder({ model: feedModel, datasetModel, kind: 'trade', source: 'binance:fapi' })
    const b = createFeedRecorder({ model: feedModel, datasetModel, kind: 'orderbook', source: 'binance:fapi' })
    const tDoc = tradeFeedDoc({ symbol: 'BTCUSDT', price: 1, qty: 1, tradeId: 'r1', eventTime: 5, ingestTime: 6 })
    const bDoc = orderbookFeedDoc({ symbol: 'BTCUSDT', bids: [[100, 1]], asks: [[101, 1]], lastUpdateId: 7, eventTime: 5, ingestTime: 6 })
    assert.deepEqual(await t.record(tDoc), { wrote: true })
    assert.deepEqual(await b.record(bDoc), { wrote: true })
    assert.equal(feedRows.length, 2)
    assert.equal(datasetModel.rows.length, 2)
    assert.equal(datasetModel.rows[0].kind, 'feed:trade')
    assert.equal(datasetModel.rows[1].kind, 'feed:orderbook')
    assert.equal(datasetModel.rows[0].count, 1)
    assert.equal(datasetModel.rows[1].count, 1)
    // replaying the same tradeId/lastUpdateId -> no new rows, count unchanged
    assert.deepEqual(await t.record(tDoc), { wrote: false })
    assert.deepEqual(await b.record(bDoc), { wrote: false })
    assert.equal(feedRows.length, 2)
    assert.equal(datasetModel.rows[0].count, 1)
    assert.equal(datasetModel.rows[1].count, 1)
  })

  test('record() writes once, keeps the manifest honest, and fails soft', async () => {
    const feedRows = []
    const datasetRows = []
    const feedModel = {
      async updateOne(filter, patch, opts) {
        let row = feedRows.find((r) => r.feedId === filter.feedId)
        const existed = Boolean(row)
        if (!row) { row = { ...patch.$setOnInsert, feedId: filter.feedId }; feedRows.push(row) }
        else if (patch.$set) Object.assign(row, patch.$set)
        return { upsertedCount: existed ? 0 : 1 }
      },
    }
    const datasetModel = {
      async updateOne(filter, patch, opts) {
        let d = datasetRows.find((r) => r.datasetId === filter.datasetId)
        if (!d) { d = { ...patch.$setOnInsert, datasetId: filter.datasetId }; datasetRows.push(d) }
        applyPatch(d, patch) // $min/$max/$inc and $setOnInsert
        return { upsertedCount: datasetRows.length === 1 ? 1 : 0 }
      },
    }

    const recorder = createFeedRecorder({ model: feedModel, datasetModel, kind: 'funding', source: 'binance:fapi', retentionDays: 90 })
    const doc = fundingFeedDoc({ symbol: 'BTCUSDT', rate: 0.0001, price: 60000, nextFundingTime: 5, ingestTime: 1 })

    assert.deepEqual(await recorder.record(doc), { wrote: true }) // new row
    assert.deepEqual(await recorder.record(doc), { wrote: false }) // idempotent
    assert.equal(feedRows.length, 1)

    // manifest: one row, honest count/start/end
    assert.equal(datasetRows.length, 1)
    assert.equal(datasetRows[0].kind, 'feed:funding')
    assert.equal(datasetRows[0].count, 1)
    assert.equal(datasetRows[0].startTs, 5)
    assert.equal(datasetRows[0].endTs, 5)
    assert.equal(datasetRows[0].checksum, null) // §24 reconcile later, never faked

    // MERGE mode refreshes the row in place without inflating count
    const doc2 = fundingFeedDoc({ symbol: 'BTCUSDT', rate: 0.0001, price: 61000, nextFundingTime: 5, ingestTime: 2 })
    assert.deepEqual(await recorder.record(doc2, { mode: 'set' }), { wrote: false })
    assert.equal(feedRows[0].data.price, 61000) // price refreshed, same row
    assert.equal(datasetRows[0].count, 1) // count still matches rows

    // Second settlement period -> a NEW row, count 2
    const doc3 = fundingFeedDoc({ symbol: 'BTCUSDT', rate: 0.0002, price: 62000, nextFundingTime: 6, ingestTime: 3 })
    assert.deepEqual(await recorder.record(doc3), { wrote: true })
    assert.equal(feedRows.length, 2)
    assert.equal(datasetRows[0].count, 2)
    assert.equal(datasetRows[0].endTs, 6)

    // Missing model -> null; throwing model -> { wrote:false } (fail-soft)
    assert.equal(await createFeedRecorder({ model: null, datasetModel, kind: 'funding', source: 'x' }).record(doc), null)
    const boom = { async updateOne() { throw new Error('mongo down') } }
    assert.deepEqual(await createFeedRecorder({ model: boom, datasetModel, kind: 'funding', source: 'x' }).record(doc), { wrote: false })
  })
})

// =============================================================================
describe('retention: feed datasets (market_feed pruned by eventTime)', () => {
  test('purges old market_feed rows and removes an emptied feed dataset', async () => {
    const now = 2_000_000_000_000
    const MarketFeed = {
      rows: [
        { _id: 'f1', kind: 'funding', source: 'binance:fapi', symbol: 'BTCUSDT', eventTime: now - 200 * DAY_MS },
        { _id: 'f2', kind: 'funding', source: 'binance:fapi', symbol: 'BTCUSDT', eventTime: now - 10 * DAY_MS },
      ],
      async deleteMany(f) {
        const del = this.rows.filter((r) => matcher(f, r))
        this.rows = this.rows.filter((r) => !matcher(f, r))
        return { deletedCount: del.length }
      },
      find(f) {
        const filtered = this.rows.filter((r) => matcher(f, r)).sort((a, b) => a.eventTime - b.eventTime)
        return query(filtered)
      },
    }
    const Dataset = {
      rows: [
        { datasetId: 'feed:funding:binance:fapi:*', kind: 'feed:funding', source: 'binance:fapi', retentionDays: 90, count: 2, startTs: now - 200 * DAY_MS, endTs: now - 10 * DAY_MS },
        { datasetId: 'feed:funding:binance:fapi:*', kind: 'feed:liquidation', source: 'binance:fapi', retentionDays: 7, count: 1, startTs: now - 3 * DAY_MS, endTs: now - 3 * DAY_MS },
      ],
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
      findOne(f) { return findOneOf(this.rows.filter((d) => matcher(f, d))) },
      async updateOne(f, patch) { const d = this.rows.find((r) => matcher(f, r)); if (d) applyPatch(d, patch); return { modifiedCount: d ? 1 : 0 } },
      async deleteOne(f) { const b = this.rows.length; this.rows = this.rows.filter((r) => !matcher(f, r)); return { deletedCount: b - this.rows.length } },
    }

    const s = await runRetention({ models: { Candle: null, MarketFeed, Dataset }, now })
    assert.deepEqual(s, { datasets: 2, purged: 1, removed: 0, errors: 0, skipped: 0 })
    // funding feed: old row pruned, manor stays honest with what remains
    assert.equal(MarketFeed.rows.length, 1)
    assert.equal(MarketFeed.rows[0]._id, 'f2')
    assert.equal(Dataset.rows[0].startTs, now - 10 * DAY_MS)
    assert.equal(Dataset.rows[0].count, 1)
  })

  test('a feed dataset with MarketFeed missing is skipped, never crashes', async () => {
    const now = 2_000_000_000_000
    const Dataset = {
      rows: [{ datasetId: 'feed:funding:binance:fapi:*', kind: 'feed:funding', source: 'binance:fapi', retentionDays: 90, count: 1, startTs: now - 5 * DAY_MS }],
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
    }
    const s = await runRetention({ models: { Candle: null, MarketFeed: null, Dataset }, now })
    assert.equal(s.skipped, 1)
    assert.equal(s.errors, 0)
  })
})