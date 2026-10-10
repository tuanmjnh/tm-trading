import { getQuery, getRouterParam } from 'h3'
import {
  getOpenInterest,
  normalizeMarket,
  normalizeSymbol,
  toHttpError
} from '../../../../utils/marketRest'

/**
 * GET /api/v1/markets/:instrument/open-interest — open interest snapshot.
 *
 * Query: ?market=spot|futures
 * Returns normalized open interest (§30.2).
 * Upstream auth required (D10).
 */
export default defineEventHandler(async (event) => {
  try {
    const symbol = normalizeSymbol(getRouterParam(event, 'instrument'))
    const q = getQuery(event)
    const market = normalizeMarket(q.market ? String(q.market) : undefined, process.env.MARKET_EXCHANGE)
    const { openInterest, meta } = await getOpenInterest({ symbol, market })
    return { success: true, data: openInterest, meta }
  } catch (err) {
    throw toHttpError(err)
  }
})