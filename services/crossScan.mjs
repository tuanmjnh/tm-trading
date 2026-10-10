// =============================================================================
//  TM TRADING — CROSS-EXCHANGE SCANNER SERVICE (roadmap §36)
//
//  Periodic: fetch quotes/funding/OI for the watchlist from every registered
//  venue adapter, compare canonical instruments (market/crossScanner.mjs —
//  pure), and store the snapshot in `intel` (kind 'cross_scan').
//
//  Honesty (§36): the numbers are OBSERVED differences. The stored doc and the
//  Telegram text both carry the warning that a spread is market context,
//  NEVER a guaranteed executable arbitrage.
//
//  Fail-soft: a venue that fails is recorded as an error on that row; one dead
//  venue never blocks the other comparisons. Mongo down -> the scan still runs
//  and prints (D33).
// =============================================================================
import { scanAll, formatScanLine, topSpreads, SCANNER_VERSION } from '../market/crossScanner.mjs'
import { saveSnapshot } from './store.mjs'
import { notify } from '../notify/service.mjs'

/** Watchlist: canonical instrument + the venue-native symbol per venue. */
export const DEFAULT_WATCHLIST = Object.freeze([
  { symbol: 'BTC/USDT', type: 'perp', venues: [{ venue: 'binance', native: 'BTCUSDT' }, { venue: 'bybit', native: 'BTCUSDT' }, { venue: 'okx', native: 'BTC-USDT-SWAP' }] },
  { symbol: 'ETH/USDT', type: 'perp', venues: [{ venue: 'binance', native: 'ETHUSDT' }, { venue: 'bybit', native: 'ETHUSDT' }, { venue: 'okx', native: 'ETH-USDT-SWAP' }] },
])

/** Default adapters — binance is built in; bybit/okx are REST-only (lazy). */
const defaultAdapters = {
  binance: {
    fetch: async ({ native }) => {
      const { premiumIndex } = await import('./binance.mjs')
      const { fetch } = globalThis
      const url = new URL('https://fapi.binance.com/fapi/v1/ticker/24hr')
      url.searchParams.set('symbol', native)
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`binance ticker HTTP ${res.status}`)
      const row = await res.json()
      const last = Number(row?.lastPrice)
      const quote = Number.isFinite(last) && last > 0 ? { last, bid: null, ask: null } : null
      const prem = (await premiumIndex().catch(() => [])).find((p) => p.symbol === native)
      const rate = Number(prem?.lastFundingRate)
      const oi = await import('./binance.mjs').then((m) => m.openInterest(native)).catch(() => null)
      return {
        quote,
        funding: Number.isFinite(rate) ? { rate, nextFundingTime: Number(prem?.nextFundingTime) || null } : null,
        oi: oi ? { value: oi } : null,
      }
    },
  },
  bybit: { fetch: ({ symbol, native }, o) => import('../market/providers/bybit.mjs').then((m) => m.fetch({ symbol, native }, o)) },
  okx: { fetch: ({ symbol, native }, o) => import('../market/providers/okx.mjs').then((m) => m.fetch({ symbol, native }, o)) },
}

/**
 * Run one scan. @returns the scan array (empty array when nothing to scan).
 */
export async function runCrossScan({ watchlist = DEFAULT_WATCHLIST, adapters = null, log = console.log } = {}) {
  const ads = adapters ?? defaultAdapters
  const scans = await scanAll(watchlist, ads)

  const rows = []
  for (const s of scans) {
    rows.push({
      key: `cross_${s.instrument}`,
      kind: 'cross_scan',
      symbol: s.instrument,
      title: formatScanLine(s),
      ts: new Date(s.scannedAt),
      data: { ...s, version: SCANNER_VERSION, warning: 'observed differences — market context, not guaranteed arbitrage' },
    })
    log(`[cross-scan] ${formatScanLine(s)}`)
  }

  const top = topSpreads(scans, { limit: 3 })
  if (top.length) {
    const widest = top[0]
    notify({
      kind: 'market', priority: 'normal',
      name: 'market.cross_scan',
      title: `Cross-exchange spread ${widest.instrument} ${widest.pair}: ${(widest.spread * 100).toFixed(3)}%`,
      body: 'Observed price difference — market context, not guaranteed arbitrage (§36).',
    }, { dedupeWindowMs: 3_600_000 })
  }

  try {
    const n = await saveSnapshot('cross_scan', rows)
    log(`[cross-scan] saved ${n} rows to intel`)
  } catch (e) {
    log(`[cross-scan] intel save failed: ${e?.message || e}`)
  }
  return scans
}

// CLI: node services/crossScan.mjs [--limit N]
export async function main(argv = process.argv.slice(2)) {
  await runCrossScan({})
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main()
