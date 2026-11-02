import { getQuery } from 'h3'
import { listSignals } from '../../../utils/signals'

/**
 * GET /api/v1/signals - tin hieu webhook TradingView (collection `alerts`, D4).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC,
 * khong tinh lai; Mongo khong ket noi duoc tra 200 + meta.mongo='down' (fail-soft).
 *
 * Query: ?limit=&cursor=&symbol=&action=&side=&since=(ISO hoac epoch ms)
 *        &lifecycle=all|active|intrabar|closed|expired
 *        &mode=closed|live|intrabar|all   (default `closed` — CLOSE_ONLY)
 *
 * S8 chunk 5: the read default is `mode=closed` (the engine only trusts closed
 * bars). `live`/`intrabar` are opt-in repaint risk. The `lifecycle` filter is
 * additive over the legacy `status` field; `active` matches legacy null rows.
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)
  const symbol = query.symbol ? String(query.symbol) : undefined
  const action = query.action ? String(query.action) : undefined
  const side = query.side ? String(query.side) : undefined
  const since = query.since ? String(query.since) : undefined
  const lifecycle = query.lifecycle ? String(query.lifecycle) : undefined
  // CLOSE_ONLY default: an absent `mode` means `closed`.
  const mode = query.mode ? String(query.mode) : 'closed'

  const { items, total, mongo } = await listSignals({
    limit,
    ownerId: requireOwnerId(event),
    cursor,
    symbol,
    action,
    side,
    since,
    lifecycle: lifecycle as any,
    mode: mode as any,
  })
  const { data, nextCursor } = cursorPage(items, limit, (item) => item.id)

  return {
    success: true,
    data,
    nextCursor,
    meta: { total, mongo, mode }
  }
})
