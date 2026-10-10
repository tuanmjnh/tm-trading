import { getQuery, getRouterParam } from 'h3'
import {
  getTrades,
  normalizeLimit,
  normalizeMarket,
  normalizeSymbol,
  toHttpError
} from '../../../../utils/marketRest'

/**
 * GET /api/v1/markets/:instrument/trades - recent public trades (§17).
 *
 * Query: ?limit=1..500&market=spot|futures
 * Each row is normalized to a canonical `market.trade` event — the same
 * shape /ws/market pushes (§7/D16). Upstream auth required (D10).
 */
export default defineEventHandler(async (event) => {
  try {
    const symbol = normalizeSymbol(getRouterParam(event, 'instrument'))
    const q = getQuery(event)
    const market = normalizeMarket(q.market ? String(q.market) : undefined, process.env.MARKET_EXCHANGE)
    const limit = normalizeLimit(q.limit ? String(q.limit) : undefined, { min: 1, max: 500, def: 100 })

    const { trades, meta } = await getTrades({ symbol, market, limit })
    return { success: true, data: trades, meta }
  } catch (err) {
    throw toHttpError(err)
  }
})
