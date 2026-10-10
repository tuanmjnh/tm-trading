import { getQuery } from 'h3'
import { getCandles, normalizeInterval, normalizeLimit, normalizeSymbol, toHttpError } from '../../../utils/marketRest'
import { loadMethodPlugins, methodEventsFromBars, toEngineBars } from '../../../utils/methods'

/**
 * GET /api/v1/methods/events?symbol=&interval=&methods=&limit=
 *
 * Compute directional method events (price-action / trend / orderflow / VSA /
 * sweep) over the same candle window the chart renders, for marker overlays +
 * the event inspector (roadmap Phase 10).
 *
 * Read-only, no Mongo needed. Bars come from the shared candles endpoint path
 * (in-memory cached -> avoids hammering Binance). Analyze is executed by the
 * engine method plugins themselves (D1 — the dashboard never reimplements a
 * strategy). Registry miss for a requested id -> it is skipped, the call still
 * succeeds; no engine available -> empty events (fail-soft).
 */
export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const symbol = normalizeSymbol(q.symbol ? String(q.symbol) : undefined)
    const { interval } = normalizeInterval(q.interval ? String(q.interval) : undefined)
    const limit = normalizeLimit(q.limit ? String(q.limit) : undefined, { min: 60, max: 300, def: 150 })

    const { candles } = await getCandles({ symbol, market: 'futures', interval, limit })
    const bars = toEngineBars(candles)

    const plugins = await loadMethodPlugins()
    const allIds = plugins.map((p) => p.id)
    const requested = q.methods
      ? String(q.methods).split(',').map((s) => s.trim()).filter(Boolean).filter((s) => allIds.includes(s))
      : allIds
    const requestedSet = new Set(requested)

    const { events, ran, window: win } = methodEventsFromBars(
      bars,
      [...requestedSet],
      plugins
    )

    return {
      success: true,
      data: { symbol, interval, limit, events, ran },
      meta: { window: win, count: events.length, methods: [...requestedSet] }
    }
  } catch (err) {
    throw toHttpError(err)
  }
})