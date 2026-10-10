// exec/retention.mjs
// Retention enforcement (roadmap §23.4): every raw dataset declares
// `retentionDays` on the `datasets` manifest, and rows older than the cutoff
// are purged from the store. The manifest is re-synced with what really
// remains — `startTs` advances to the oldest RETAINED row, `count` shrinks by
// exactly the number deleted, and a dataset with nothing left is removed (an
// empty manifest is a lie).
//
// PURE at the core (`runRetention` takes injected models and `now` — nothing
// here reaches for Mongo or the clock), so it is testable offline with fakes.
// `runRetentionService()` is the thin orchestrator/CLI bridge.
//
// Fail-soft (D33): a bad dataset never aborts the sweep — it increments
// `errors` and moves on. Mongo down -> `{ skipped: 1, mongoDown: true }`.
import { DEFAULT_RETENTION_DAYS } from '../market/recorder.mjs'

/** ms in one day used for cutoffs. */
export const DAY_MS = 24 * 60 * 60 * 1000

/** Default retention sweep interval (seconds) — 6h. */
export const RETENTION_INTERVAL = Number(process.env.RETENTION_INTERVAL || 6 * 3600)

/** Retention cutoff for a dataset: now - retentionDays. */
export function retentionCutoff(now, retentionDays = DEFAULT_RETENTION_DAYS) {
  return now - Number(retentionDays) * DAY_MS
}

/** Fields that identify which candle/dataset a purge row belongs to. */
export function kindMatch(dataset) {
  return { source: dataset.source, symbol: dataset.symbol, timeframe: dataset.timeframe }
}

/**
 * Prune expired rows for every dataset on the manifest (§23.4) and re-sync it:
 *   kind === 'candles'      -> purge `candles.openTime` rows;
 *   kind === 'feed:<x>'     -> purge `market_feed.eventTime` rows for feed kind x.
 * Injected models: { Candle, MarketFeed, Dataset }. Honest accounting: `count`,
 * `startTs` always match the rows that physically remain; an emptied dataset is
 * removed, never left lying (D12). Fail-soft per dataset (D33).
 *
 * @returns {{datasets:number, purged:number, removed:number, errors:number, skipped:number}}
 */
export async function runRetention({ models = {}, now = Date.now(), log = console } = {}) {
  const summary = { datasets: 0, purged: 0, removed: 0, errors: 0, skipped: 0 }
  const m = models
  if (!m.Dataset) {
    summary.skipped = 1
    return summary
  }

  let datasets = []
  try {
    datasets = await m.Dataset.find({}).lean()
  } catch (e) {
    summary.errors++
    if (log && log.warn) log.warn(`[retention] manifest read error: ${e?.message || e}`)
    return summary
  }
  summary.datasets = datasets.length

  const purge = async (d, { model, field, match }) => {
    const cutoff = retentionCutoff(now, d.retentionDays)
    const del = await model.deleteMany({ ...match, [field]: { $lt: cutoff } })
    const purged = del.deletedCount || 0
    if (!purged) return 0
    summary.purged += purged // counted even when the whole dataset vanishes

    const leftover = await model.find(match).sort({ [field]: 1 }).limit(1).lean()
    if (leftover.length === 0) {
      await m.Dataset.deleteOne({ datasetId: d.datasetId })
      summary.removed++
      return purged
    }
    await m.Dataset.updateOne(
      { datasetId: d.datasetId },
      { $set: { startTs: Number(leftover[0][field]), updatedAt: new Date() }, $inc: { count: -purged } },
    )

    const after = await m.Dataset.findOne({ datasetId: d.datasetId }).lean()
    if (after && Number(after.count) <= 0) {
      await m.Dataset.deleteOne({ datasetId: d.datasetId })
      summary.removed++
    }
    return purged
  }

  for (const d of datasets) {
    try {
      if (d.kind === 'candles') {
        if (!m.Candle) { summary.skipped++; continue }
        await purge(d, { model: m.Candle, field: 'openTime', match: kindMatch(d) })
      } else if (typeof d.kind === 'string' && d.kind.startsWith('feed:')) {
        if (!m.MarketFeed) { summary.skipped++; continue }
        await purge(d, { model: m.MarketFeed, field: 'eventTime', match: { kind: d.kind.slice('feed:'.length), source: d.source } })
      }
    } catch (e) {
      summary.errors++
      if (log && log.warn) log.warn(`[retention] ${d.datasetId ?? d._id} error: ${e?.message || e}`)
    }
  }
  return summary
}

/**
 * Orchestrator entry (services/run.mjs): connect once, sweep, leave the
 * connection open for other beats — the CLI below disconnects explicitly.
 */
export async function runRetentionService() {
  const { connectMongo } = await import('../engine/db.mjs')
  const mg = await connectMongo()
  if (!mg) return { skipped: 1, mongoDown: true }
  const { Candle, Dataset, MarketFeed } = await import('../engine/models/index.mjs')
  return runRetention({ models: { Candle, Dataset, MarketFeed } })
}

// ---------------------------------------------------------------------------
// CLI:  node exec/retention.mjs  — one sweep, then exit
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
if (isMain) {
  const { disconnectMongo } = await import('../engine/db.mjs')
  try {
    const summary = await runRetentionService()
    console.log(`[retention] ${JSON.stringify(summary)}`)
    if (summary.errors) process.exit(1)
  } finally {
    await disconnectMongo()
  }
}