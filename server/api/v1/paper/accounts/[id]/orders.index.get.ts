import { getRouterParam, getQuery } from 'h3'
import { listPaperOrders } from '~~/server/utils/paperOrders'

/**
 * GET /api/v1/paper/accounts/:id/orders — orders for a paper account (§30.5).
 * Query: ?limit=&cursor=&status=&symbol=
 */
export default defineEventHandler(async (event) => {
  const accountId = getRouterParam(event, 'id')
  if (!accountId) return { success: false, error: 'account id required', data: [], meta: { count: 0, mongo: 'down' } }

  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 24

  const { items, meta, mongo } = await listPaperOrders({
    limit,
    cursor: q.cursor ? String(q.cursor) : undefined,
    status: q.status ? String(q.status) : undefined,
    symbol: q.symbol ? String(q.symbol).toUpperCase() : undefined,
  })

  // Filter by account
  const filteredItems = items.filter((o: any) => o.account === accountId)
  const { data: paged, nextCursor } = cursorPage(filteredItems, limit, (item: any) => item.id)

  return { success: true, items: paged, meta: { ...meta, total: filteredItems.length }, mongo, nextCursor }
})