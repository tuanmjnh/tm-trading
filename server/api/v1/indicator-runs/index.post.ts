import type { H3Event } from 'h3'
import { createError, readBody } from 'h3'
import {
  loadIndicatorRun,
  runIndicator,
  saveIndicatorRun
} from '../../../utils/indicators'
import { toEngineBars } from '../../../utils/methods'
import {
  getCandles,
  normalizeInterval,
  normalizeLimit,
  normalizeMarket,
  normalizeSymbol,
  toHttpError
} from '../../../utils/marketRest'

// =============================================================================
//  POST /api/v1/indicator-runs — compute + persist one indicator over
//  current history for a symbol/timeframe (roadmap §30.3).
//
//  Body:
//    { indicator, symbol, tf?, market?, limit?, params? }
//      indicator  required — id from the catalog (engine/indicators.mjs, D1)
//      symbol     required — e.g. BTCUSDT (normalized via marketRest)
//      tf         interval, default 1m (1m|4m|10m|1h...)
//      market     spot|futures, default env MARKET_EXCHANGE (futures)
//      limit      bars, default 300
//      params     optional partial params — clamped onto the CANONICAL schema
//
//  Candles come from the SAME marketRest path as the chart (§17); bars are
//  converted with toEngineBars (the one shape the engine consumes). The math
//  is the CANONICAL registry — the dashboard never reimplements it.
//
//  Fail-soft rules:
//    - bad body / unknown indicator            -> 400
//    - upstream candles failure                -> 502 (marketRest.toHttpError)
//    - engine registry unavailable             -> 503
//    - Mongo unavailable                       -> 503 mongo_down (nothing stored)
// =============================================================================

interface RunBody {
  indicator?: unknown
  symbol?: unknown
  tf?: unknown
  market?: unknown
  limit?: unknown
  params?: unknown
}

function asNumberMap(v: unknown, path: string): Record<string, number> | null {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_params', message: `${path} must be an object` })
  }
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw createError({ statusCode: 400, statusMessage: 'invalid_params', message: `${path}.${k} must be a finite number` })
    }
    out[k] = val
  }
  return out
}

export default defineEventHandler(async (event: H3Event) => {
  const body = (await readBody(event).catch(() => null)) as RunBody | null

  const indicator = String(body?.indicator ?? '').trim()
  if (!indicator) {
    throw createError({ statusCode: 400, statusMessage: 'indicator_required', message: 'indicator is required' })
  }

  let symbol: string
  let market: 'spot' | 'futures'
  let interval: string
  let limit: number
  let params: Record<string, number>
  try {
    symbol = normalizeSymbol(body?.symbol ? String(body.symbol) : undefined)
    market = normalizeMarket(body?.market ? String(body.market) : undefined, process.env.MARKET_EXCHANGE)
    interval = normalizeInterval(body?.tf ? String(body.tf) : undefined).interval
    limit = normalizeLimit(body?.limit ? String(body.limit) : undefined, { min: 1, max: 500, def: 300 })
    params = asNumberMap(body?.params, 'params') ?? {}
  } catch (err) {
    throw toHttpError(err)
  }

  // Candles (same REST path the chart uses) -> engine bars.
  let bars: ReturnType<typeof toEngineBars>
  try {
    const { candles } = await getCandles({ symbol, market, interval, limit })
    bars = toEngineBars(candles)
  } catch (err) {
    throw toHttpError(err)
  }
  if (bars.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'empty_candles', message: `no usable candles for ${symbol} ${interval}` })
  }
  if (bars.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'not_enough_bars', message: `at least 2 bars required, got ${bars.length}` })
  }

  const run = await runIndicator({ id: indicator, bars, rawParams: params, symbol, tf: interval, market })
  if (!run) {
    throw createError({
      statusCode: 503,
      statusMessage: 'indicator_unavailable',
      message: `Indicator registry unavailable or unknown: ${indicator}`
    })
  }

  const id = await saveIndicatorRun(run)
  if (!id) {
    throw createError({
      statusCode: 503,
      statusMessage: 'mongo_down',
      message: 'MongoDB unavailable — run not stored'
    })
  }

  return { success: true, data: { id, ...run } }
})