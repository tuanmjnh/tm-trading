import { getRouterParam, getQuery } from 'h3'
import { listPositions } from '~~/server/utils/positions'

/**
 * GET /api/v1/paper/accounts/:id/positions — positions for a paper account (§30.5).
 * Query: ?limit=&cursor=&status=&symbol=&source=
 */
export default defineEventHandler(async (event) => {
  const accountId = getRouterParam(event, 'id')
  if (!accountId) return { success: false, error: 'account id required', data: [], meta: { count: 0, mongo: 'down' } }

  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50

  const { items, total, open, closed, realizedPnlAbs, mongo } = await listPositions({
    limit,
    cursor: q.cursor ? String(q.cursor) : undefined,
    status: q.status ? String(q.status) : undefined,
    symbol: q.symbol ? String(q.symbol).toUpperCase() : undefined,
    source: q.source ? String(q.source) : undefined,
    account: accountId,
  })

  const { data: paged, nextCursor } = cursorPage(items, limit, (item: any) => item.id)

  return { success: true, data: paged, nextCursor, meta: { total, open, closed, realizedPnlAbs }, mongo }
})