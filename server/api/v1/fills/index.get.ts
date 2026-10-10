import { getQuery } from 'h3'
import { listPaperFills } from '../../../utils/paperFills'

/**
 * GET /api/v1/fills - paper fill ledger (roadmap v3 §18.5/§18.6/§26.5) -
 * collection `paper_fills`, append-only execution facts written by the paper
 * executor. READ-only: the terminal is a viewer of execution quality (price,
 * qty, fee rate/amount, spread, slippage, latency chain), never a writer.
 *
 * Token do tm-hub cap bat buoc (D10). Mongo khong ket noi duoc -> 200 +
 * meta.mongo='down' (fail-soft).
 *
 * Query: ?limit=&cursor=&symbol=&orderId=
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)

  const { items, meta, mongo } = await listPaperFills({
    limit,
    cursor,
    symbol: query.symbol ? String(query.symbol) : undefined,
    orderId: query.orderId ? String(query.orderId) : undefined
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