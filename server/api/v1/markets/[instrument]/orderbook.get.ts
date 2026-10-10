import { getQuery, getRouterParam } from 'h3'
import {
  getOrderBook,
  normalizeMarket,
  normalizeOrderbookLimit,
  normalizeSymbol,
  toHttpError
} from '../../../../utils/marketRest'

/**
 * GET /api/v1/markets/:instrument/orderbook - order book snapshot (§17).
 *
 * Query: ?limit=exchange page size&market=spot|futures
 * REST depth is a SNAPSHOT (type: 'orderbook', no exchange event time) —
 * live depth diffs keep flowing on /ws/market as `market.book` events.
 * Upstream auth required (D10).
 */
export default defineEventHandler(async (event) => {
  try {
    const symbol = normalizeSymbol(getRouterParam(event, 'instrument'))
    const q = getQuery(event)
    const market = normalizeMarket(q.market ? String(q.market) : undefined, process.env.MARKET_EXCHANGE)
    const limit = normalizeOrderbookLimit(q.limit ? String(q.limit) : undefined, market)

    const { book, meta } = await getOrderBook({ symbol, market, limit })
    return { success: true, data: book, meta }
  } catch (err) {
    throw toHttpError(err)
  }
})
