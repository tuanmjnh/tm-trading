import { getQuery } from 'h3'
import { listSignals } from '../../../utils/signals'

/**
 * GET /api/v1/signals - tin hieu webhook TradingView (collection `alerts`, D4).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC,
 * khong tinh lai; Mongo khong ket noi duoc tra 200 + meta.mongo='down' (fail-soft).
 *
 * Query: ?limit=&cursor=&symbol=&action=&side=&since=(ISO hoac epoch ms)
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)
  const symbol = query.symbol ? String(query.symbol) : undefined
  const action = query.action ? String(query.action) : undefined
  const side = query.side ? String(query.side) : undefined
  const since = query.since ? String(query.since) : undefined

  const { items, total, mongo } = await listSignals({ limit, cursor, symbol, action, side, since })
  const { data, nextCursor } = cursorPage(items, limit, (item) => item.id)

  return {
    success: true,
    data,
    nextCursor,
    meta: { total, mongo }
  }
})
