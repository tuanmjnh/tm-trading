// market/feedRecorder.mjs
// Raw market FEED recorder (roadmap §23.3 P1 — funding, OI, liquidation; trades
// and orderbook reuse the same `market_feed` ledger when their streams exist).
//
// PURE core (no IO, no clock of its own): every doc builder takes its inputs
// explicitly and returns a validated row. `createFeedRecorder` is the thin
// persister — injected models (feed + dataset manifest), fail-soft, idempotent.
//
// Keys (D3/D4):
//   funding     feed:funding:<symbol>:<nextFundingTime>  — ONE row per funding
//               SETTLEMENT PERIOD (the rate is a period fact). MERGE mode: the
//               latest observed price/OI for that period refreshes the row
//               ($set), the RATE never changes. Bounded: ~1 row/symbol/period.
//   liquidation feed:liquidation:<symbol>:<eventTime>:<price>:<qty> — immutable
//               event fact, $setOnInsert (a crash replay can never duplicate).
//
// Honesty (D12): null fields stay null (OI was only fetched for a subset of
// symbols — never fabricated); `eventTime` is the feed's OWN time, `ingestTime`
// is when WE observed it (D16). Every row carries its own `retentionDays`.

/** Version stamp (D1) — bump when the feed shape changes meaningfully. */
export const FEED_SCHEMA_VERSION = 'feed.v1'
export const DEFAULT_FEED_RETENTION_DAYS = 90
/** Liquidation events default to 7d (the file ledger trims the same window). */
export const LIQUIDATION_RETENTION_DAYS = 7

const fin = (v) => Number.isFinite(Number(v))
const numOrNull = (v) => (v == null || v === '' ? null : fin(v) ? Number(v) : null)
/** A real eventTime is a post-epoch positive epoch ms (0 or missing = absent). */
const validTime = (v) => fin(v) && Number(v) > 0

/** Natural key (D3): prefix + slash-free parts joined by ':'. */
export function feedIdFor(kind, parts) {
  return `feed:${kind}:${parts.join(':')}`
}

/** datasetId of a feed dataset on the `datasets` manifest. */
export function feedDatasetId(kind, source) {
  return `feed:${kind}:${source}:*`
}

/**
 * Funding/OI row — one per (symbol, nextFundingTime) settlement period.
 * eventTime = settlement time (the fact's own time), ingestTime = when WE wrote.
 */
export function fundingFeedDoc({
  symbol, venue = 'binance:fapi', market = 'futures',
  rate, price, nextFundingTime, oiContracts = null, oiNotionalUsd = null,
  ingestTime, retentionDays = DEFAULT_FEED_RETENTION_DAYS,
} = {}) {
  if (!symbol) return null
  const eventTime = numOrNull(nextFundingTime) || numOrNull(ingestTime)
  if (!validTime(eventTime)) return null
  return {
    feedId: feedIdFor('funding', [String(symbol), eventTime]),
    kind: 'funding',
    symbol: String(symbol),
    venue,
    market,
    eventTime,
    ingestTime: numOrNull(ingestTime) ?? null,
    data: {
      rate: numOrNull(rate),
      price: numOrNull(price),
      nextFundingTime: eventTime,
      oiContracts: numOrNull(oiContracts),
      oiNotionalUsd: numOrNull(oiNotionalUsd),
    },
    retentionDays,
    schemaVersion: FEED_SCHEMA_VERSION,
  }
}

/**
 * Trade row — one immutable fact per tradeId (D4). Bounded: ~1 row/tradeId.
 * `side` is the AGGRESSOR side (buyer is market maker -> aggressor is seller).
 * Not wired yet: the WS trade stream only reaches the in-memory market plane
 * (no durable source today), so the builder is here and the recorder is NOT
 * connected to a service. Same for orderbookFeedDoc below.
 *
 * @returns {object|null} validated row, or null when identity is impossible.
 */
export function tradeFeedDoc({
  symbol, venue = 'binance:fapi', market = 'futures',
  price, qty, side, tradeId, eventTime, ingestTime,
  retentionDays = DEFAULT_FEED_RETENTION_DAYS,
} = {}) {
  if (!symbol || !validTime(eventTime) || tradeId == null) return null
  const p = numOrNull(price)
  const q = numOrNull(qty)
  if (!(p && p > 0) || !(q && q >= 0)) return null
  return {
    feedId: feedIdFor('trade', [String(symbol), String(tradeId)]),
    kind: 'trade',
    symbol: String(symbol),
    venue,
    market,
    eventTime,
    ingestTime: numOrNull(ingestTime) ?? null,
    data: {
      price: p,
      qty: q,
      usd: Number((p * q).toFixed(2)),
      side: side === 'buy' || side === 'sell' ? side : null,
      tradeId: String(tradeId),
    },
    retentionDays,
    schemaVersion: FEED_SCHEMA_VERSION,
  }
}

/**
 * Orderbook snapshot row — one immutable fact per `lastUpdateId` (D4). The store
 * only ever holds top-N levels, so the recorded levels are the honest top-N
 * (not a claim of full depth); `bidDepthUsd`/`askDepthUsd` are computed from
 * those recorded levels.
 *
 * @returns {object|null} validated row, or null when identity is impossible.
 */
export function orderbookFeedDoc({
  symbol, venue = 'binance:fapi', market = 'futures',
  bids = [], asks = [], lastUpdateId, eventTime, ingestTime,
  retentionDays = DEFAULT_FEED_RETENTION_DAYS, maxLevels = 25,
} = {}) {
  if (!symbol || !validTime(eventTime) || lastUpdateId == null || !Number.isFinite(Number(lastUpdateId))) return null
  const keep = (arr) => (Array.isArray(arr) ? arr.map((l) => [numOrNull(l?.[0]), numOrNull(l?.[1])]).filter((l) => l[0] && l[0] > 0 && l[1] != null) : [])
  // Normalize order honestly (the store sorts, but the builder can't assume it):
  // bids descending by price, asks ascending — index 0 = best level.
  const b = keep(bids).sort((x, y) => y[0] - x[0]).slice(0, maxLevels)
  const a = keep(asks).sort((x, y) => x[0] - y[0]).slice(0, maxLevels)
  if (!b.length && !a.length) return null
  const depthUsd = (levels) => Number(levels.reduce((s, [p, q]) => s + (p * q), 0).toFixed(2))
  return {
    feedId: feedIdFor('orderbook', [String(symbol), String(lastUpdateId)]),
    kind: 'orderbook',
    symbol: String(symbol),
    venue,
    market,
    eventTime,
    ingestTime: numOrNull(ingestTime) ?? null,
    data: {
      bids: b,
      asks: a,
      bestBid: b.length ? b[0][0] : null,
      bestAsk: a.length ? a[0][0] : null,
      bidDepthUsd: b.length ? depthUsd(b) : null,
      askDepthUsd: a.length ? depthUsd(a) : null,
      lastUpdateId: Number(lastUpdateId),
    },
    retentionDays,
    schemaVersion: FEED_SCHEMA_VERSION,
  }
}

/**
 * Liquidation row — one immutable fact per forceOrder event (D4).
 * `qty`/`price` participate in the identity so the same event can never be
 * double-recorded, even when a read window overlaps between runs.
 */
export function liquidationFeedDoc({
  symbol, venue = 'binance:fapi', market = 'futures',
  price, qty, side, eventTime, ingestTime, retentionDays = LIQUIDATION_RETENTION_DAYS,
} = {}) {
  if (!symbol || !validTime(eventTime)) return null
  const p = numOrNull(price)
  const q = numOrNull(qty)
  return {
    feedId: feedIdFor('liquidation', [String(symbol), eventTime, p ?? 0, q ?? 0]),
    kind: 'liquidation',
    symbol: String(symbol),
    venue,
    market,
    eventTime,
    ingestTime: numOrNull(ingestTime) ?? null,
    data: { price: p, qty: q, usd: fin(p) && fin(q) ? Number((p * q).toFixed(2)) : null, side: side ?? null },
    retentionDays,
    schemaVersion: FEED_SCHEMA_VERSION,
  }
}

/**
 * Persister for ONE feed row. Fail-soft: no model / write error logs and never
 * throws (the feed is evidence, not a choke point).
 *
 * mode:
 *   'setOnInsert' (default) — immutable event fact, first write wins (D4);
 *   'set'                   — merge/refresh the latest observation (funding).
 *
 * Keeps the `datasets` manifest (§23.4) honest: startTs/endTs ($min/$max over
 * eventTime) and `count` ($inc only on NEW rows — count always matches rows).
 *
 * @returns {Promise<{wrote:boolean}|null>} null when the feed model is absent
 */
export function createFeedRecorder({ model = null, datasetModel = null, kind, source, retentionDays = DEFAULT_FEED_RETENTION_DAYS } = {}) {
  return {
    async record(doc, { mode = 'setOnInsert' } = {}) {
      if (!doc?.feedId) return null
      if (!model) return null
      try {
        const patch = mode === 'set' ? { $set: doc } : { $setOnInsert: doc }
        const res = await model.updateOne({ feedId: doc.feedId }, patch, { upsert: true })
        const wrote = Boolean(res?.upsertedCount)
        if (wrote && datasetModel) {
          const datasetId = feedDatasetId(doc.kind, source)
          await datasetModel.updateOne(
            { datasetId },
            {
              $setOnInsert: {
                datasetId,
                kind: `feed:${doc.kind}`,
                source,
                symbol: '*',
                timeframe: null,
                schemaVersion: FEED_SCHEMA_VERSION,
                retentionDays,
                compression: 'none',
                checksum: null, // null until an offline reconcile exists (§24)
                startTs: doc.eventTime,
                endTs: doc.eventTime,
                count: 0,
              },
              $min: { startTs: doc.eventTime },
              $max: { endTs: doc.eventTime },
              $inc: { count: 1 },
            },
            { upsert: true },
          )
        }
        return { wrote }
      } catch (e) {
        console.warn(`[feed] ${doc.kind} record error ${doc.feedId}: ${e?.message || e}`)
        return { wrote: false }
      }
    },
  }
}