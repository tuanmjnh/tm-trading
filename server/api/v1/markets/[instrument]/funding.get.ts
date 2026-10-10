import { getQuery, getRouterParam } from 'h3'
import {
  getFunding,
  normalizeMarket,
  normalizeSymbol,
  toHttpError
} from '../../../../utils/marketRest'

/**
 * GET /api/v1/markets/:instrument/funding — current funding / premium index.
 *
 * Query: ?market=spot|futures
 * Returns normalized premium index rows (§30.2).
 * Upstream auth required (D10).
 */
export default defineEventHandler(async (event) => {
  try {
    const symbol = normalizeSymbol(getRouterParam(event, 'instrument'))
    const q = getQuery(event)
    const market = normalizeMarket(q.market ? String(q.market) : undefined, process.env.MARKET_EXCHANGE)
    const { funding, meta } = await getFunding({ symbol, market })
    return { success: true, data: funding, meta }
  } catch (err) {
    throw toHttpError(err)
  }
})