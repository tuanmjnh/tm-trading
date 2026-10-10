import { getQuery, getRouterParam } from 'h3'
import {
  getCandles,
  normalizeInterval,
  normalizeLimit,
  normalizeMarket,
  normalizeSymbol,
  toHttpError
} from '../../../../utils/marketRest'

/**
 * GET /api/v1/markets/:instrument/candles - historical candles (§17).
 *
 * Query: ?interval=1m|4m|10m|1h... &limit=&market=spot|futures
 * Native intervals come straight from Binance; 4m/10m are composed from 1m
 * rows with market/aggregate.mjs (same boundaries as /ws/market).
 * Upstream auth token required (server/middleware/auth.ts - D10).
 *
 * In-memory TTL cache: the chart polls history far more often than the
 * forming candle actually changes, and the live plane already pushes
 * forming-candle updates over /ws/market — so REST only has to refresh the
 * BASE. Without this, sustained chart polling drives the fapi klines
 * endpoint into a Binance HTTP 418 IP ban, which also kills the depth
 * snapshot and skew sync. Errors are never cached.
 *
 * Stale-while-error: Binance 418 bans flap per request on a throttled IP —
 * sometimes the endpoint stays banned for minutes. When upstream fails and
 * a previous good payload exists for the same key, serve it (meta.servedStale
 * = true) instead of 502. Live candles keep flowing from the WS plane, so a
 * stale BASE only matters for the oldest rows; it heals on the next success.
 */
const CACHE = new Map<string, { at: number; payload: unknown }>()
const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 100
const LAST_GOOD = new Map<string, { at: number; payload: { data: unknown[]; meta: Record<string, unknown> } }>()

export default defineEventHandler(async (event) => {
  try {
    const symbol = normalizeSymbol(getRouterParam(event, 'instrument'))
    const q = getQuery(event)
    const market = normalizeMarket(q.market ? String(q.market) : undefined, process.env.MARKET_EXCHANGE)
    const { interval, composite, maxLimit } = normalizeInterval(q.interval ? String(q.interval) : undefined)
    const limit = normalizeLimit(q.limit ? String(q.limit) : undefined, { min: 1, max: maxLimit, def: 300 })
    const key = `${market}:${symbol}:${interval}:${limit}`

    try {
      const hit = CACHE.get(key)
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload

      const { candles, meta } = await getCandles({ symbol, market, interval, limit })
      const payload = { success: true, data: candles, meta: { ...meta, composite } }
      CACHE.set(key, { at: Date.now(), payload })
      LAST_GOOD.set(key, { at: Date.now(), payload })
      if (CACHE.size > CACHE_MAX_ENTRIES) {
        const oldest = CACHE.keys().next().value
        if (oldest !== undefined) CACHE.delete(oldest)
      }
      return payload
    } catch (err) {
      const stale = LAST_GOOD.get(key)
      if (stale) {
        console.warn(`[market] candles upstream failed, serving stale (${key}, age=${Date.now() - stale.at}ms): ${err instanceof Error ? err.message : String(err)}`)
        return { success: true, data: stale.payload.data, meta: { ...stale.payload.meta, servedStale: true, staleAt: stale.at } }
      }
      throw err
    }
  } catch (err) {
    throw toHttpError(err)
  }
})
