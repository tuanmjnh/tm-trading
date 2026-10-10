#!/usr/bin/env node
// =============================================================================
//  TM TRADING — CANDLE RECONCILIATION SERVICE (roadmap §24.2).
//
//  Periodically compare locally-recorded CLOSED candles against venue REST
//  bars. Runs every ~6h. When a dataset diverges beyond tolerance:
//    - the dataset manifest is flagged `suspect` + stores the measured
//      verdict (§24.2 "mark data suspect"), so derived consumers (backtest,
//      replay, AI training) can refuse to trust it — invalidation is a flag,
//      never a silent rewrite;
//    - with RECONCILE_REPAIR=1 mismatched/missing bars are repaired FROM the
//      venue (venue REST is the source of truth per §24.2), row by row.
//
//  Honesty (D12): only binance-fapi sources are reconciled (the fetcher IS
//  fapi); any other source or a non-standard interval (4m/10m are OUR
//  aggregations, not venue facts) is skipped with a reason — never compared
//  against a mismatched venue. Fail-soft per dataset (D33).
//
//    node services/reconcile.mjs          # one pass (same entry as heartbeat)
// =============================================================================
import { loadEnv } from '../exec/env.mjs'
import { klinesRaw } from './binance.mjs'
import { notify } from '../notify/service.mjs'
import { reconcileCandles, buildRepairPatches } from '../market/reconcile.mjs'

/** Intervals the venue itself publishes (§24.2 compares venue facts only). */
const RECONCILABLE_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'])

/** Normalize one raw Binance kline row into a venue bar for reconciliation. */
export function venueBarFromRaw(k) {
  if (!Array.isArray(k) || k.length < 7) return null
  const bar = {
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  }
  return Object.values(bar).every((v) => Number.isFinite(v)) ? bar : null
}

/**
 * Which venue can vouch for a recorded source string? null = not comparable.
 * engine/data.mjs records sources as REST base urls ('https://fapi.binance.com'),
 * the market plane as 'binance'. Anything else (bybit..., spot api.binance.com)
 * has no venue fetcher here yet — honest skip until one exists.
 */
export function venueForSource(source) {
  const s = String(source ?? '')
  if (s === 'binance' || s === 'binance:fapi' || s.includes('fapi.binance.com')) return BINANCE_FAPI
  return null
}
const BINANCE_FAPI = { id: 'binance:fapi' }

/**
 * One reconciliation pass. Injected for tests: { Candle, Dataset } + klineFetcher.
 *
 * @returns {Promise<{datasets:number, checked:number, ok:number, suspect:number, gap:number, skipped:number, errors:number, repaired:number}>}
 */
export async function runReconcile({
  models = {},
  klineFetcher = klinesRaw,
  limit = Number(process.env.RECONCILE_LIMIT || 120),
  repair = process.env.RECONCILE_REPAIR === '1',
  symbols = null,
  notifyFn = null,
  now = Date.now(),
  log = console,
} = {}) {
  const summary = { datasets: 0, checked: 0, ok: 0, suspect: 0, gap: 0, skipped: 0, errors: 0, repaired: 0 }
  const m = models
  if (!m.Candle || !m.Dataset) { summary.skipped = 1; return summary }

  let datasets = []
  try {
    datasets = await m.Dataset.find({ kind: 'candles' }).lean()
  } catch (e) {
    summary.errors++
    if (log && log.warn) log.warn(`[reconcile] manifest read error: ${e?.message || e}`)
    return summary
  }
  summary.datasets = datasets.length

  for (const d of datasets) {
    if (symbols && !symbols.includes(d.symbol)) continue
    try {
      if (!RECONCILABLE_INTERVALS.has(d.timeframe)) { summary.skipped++; continue }
      const venue = venueForSource(d.source)
      if (!venue) { summary.skipped++; continue }

      const raw = await klineFetcher({ symbol: d.symbol, interval: d.timeframe, limit }, {})
      const venueBars = (Array.isArray(raw) ? raw : []).map(venueBarFromRaw).filter(Boolean)
      if (venueBars.length === 0) { summary.skipped++; continue }

      const minOT = venueBars[0].openTime
      const maxOT = venueBars[venueBars.length - 1].openTime
      const localBars = await m.Candle.find({ symbol: d.symbol, timeframe: d.timeframe, openTime: { $gte: minOT, $lte: maxOT } }).lean()

      const res = reconcileCandles({ localBars, venueBars })
      summary.checked++
      if (res.verdict === 'ok') summary.ok++
      else if (res.verdict === 'gap') summary.gap++
      else if (res.verdict === 'suspect') summary.suspect++

      // Mark the manifest with the MEASURED verdict (invalidate-by-flag).
      await m.Dataset.updateOne(
        { datasetId: d.datasetId },
        {
          $set: {
            lastReconcileAt: new Date(now),
            lastReconcile: {
              verdict: res.verdict,
              checked: res.checked,
              matched: res.matched,
              mismatches: res.mismatches.length,
              missingLocal: res.missingLocal.length,
              missingVenue: res.missingVenue.length,
              venue: venue.id, windowStart: minOT, windowEnd: maxOT,
            },
            suspect: res.verdict === 'suspect' || res.verdict === 'gap',
          },
        },
      )

      // §25 — a suspect dataset is a market-data event (loud, but deduped per
      // dataset within a 12h window so a 6h sweep cycle pings at most twice).
      // `notifyFn` is INJECTED (null in tests — a suite must never dial Mongo).
      if ((res.verdict === 'suspect' || res.verdict === 'gap') && notifyFn) {
        void notifyFn(
          {
            kind: 'market', priority: 'important', name: 'candles.suspect', symbol: d.symbol,
            dedupeKey: `candles.suspect:${d.datasetId}`,
            title: `Candles ${d.symbol} ${d.timeframe} ${res.verdict}`,
            body: `Reconcile ${d.datasetId}: ${res.verdict} (${res.mismatches.length} mismatch, ${res.missingLocal.length} local gap, ${res.missingVenue.length} local-only) vs ${venue.id}. Dataset flagged suspect.`,
          },
          { dedupeWindowMs: 12 * 3600_000 },
        ).catch(() => {})
      }

      // Optional repair (§24.2): venue REST overwrites local rows, patch by patch.
      if (repair && (res.mismatches.length > 0 || res.missingLocal.length > 0)) {
        const patches = buildRepairPatches(
          { mismatches: res.mismatches, missingLocal: res.missingLocal },
          { symbol: d.symbol, timeframe: d.timeframe, source: d.source, market: d.market ?? null },
        )
        for (const p of patches) {
          await m.Candle.updateOne(p.filter, p.update, { upsert: p.upsert })
          summary.repaired++
        }
      }
    } catch (e) {
      summary.errors++
      if (log && log.warn) log.warn(`[reconcile] ${d.datasetId ?? d._id} error: ${e?.message || e}`)
    }
  }
  return summary
}

/** Orchestrator entry used by services/run.mjs + heartbeat (fail-soft). */
export async function runReconcileService() {
  const { connectMongo } = await import('../engine/db.mjs')
  const mg = await connectMongo()
  if (!mg) return { skipped: 1, mongoDown: true }
  const { Candle, Dataset } = await import('../engine/models/index.mjs')
  return runReconcile({ models: { Candle, Dataset }, notifyFn: notify })
}

// ---------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
if (isMain) {
  loadEnv()
  const { disconnectMongo } = await import('../engine/db.mjs')
  try {
    const summary = await runReconcileService()
    console.log('[reconcile]', JSON.stringify(summary))
    await disconnectMongo()
    process.exit(0)
  } catch (e) {
    console.error('[reconcile] fatal:', e?.message || e)
    await disconnectMongo().catch(() => {})
    process.exit(1)
  }
}