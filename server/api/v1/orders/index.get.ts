import { getQuery } from 'h3'
import { listPaperOrders } from '../../../utils/paperOrders'

/**
 * GET /api/v1/orders - paper orders (roadmap v3 §17.2 / §26.4) - collection
 * `paper_orders`, the FIRST-CLASS order docs of the LIVE paper path.
 *
 * Token do tm-hub cap bat buoc (D10). Chi DOC engine model (D1);
 * Mongo khong ket noi duoc tra 200 + meta.mongo='down' (fail-soft).
 *
 * Query: ?limit=&cursor=&status=(created|riskChecked|pending|partiallyFilled|
 * filled|cancelled|expired|rejected)&symbol=
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)

  const { items, meta, mongo } = await listPaperOrders({
    limit,
    cursor,
    status: query.status ? String(query.status) : undefined,
    symbol: query.symbol ? String(query.symbol) : undefined
  })

  const { data: paged, nextCursor } = cursorPage(items, limit, (item) => item.id)

  return {
    success: true,
    items: paged,
    meta,
    mongo,
    nextCursor
  }
})