import { getQuery } from 'h3'
import { listNativeSignals } from '../../../utils/nativeSignals'

/**
 * GET /api/v1/signals/native - signals produced by the NATIVE engine (§61.17
 * Phase D), collection `signals`, with full method/strategy/engine attribution.
 *
 * This is the read path that does NOT depend on the TradingView webhook. The
 * legacy webhook route stays at GET /api/v1/signals (collection alerts).
 *
 * Token from tm-hub required (server/middleware/auth.ts - D10). Read-only; Mongo
 * down -> 200 + meta.mongo='down' (fail-soft).
 *
 * Query: ?limit=&cursor=&symbol=&method=&strategyVersion=
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)
  const symbol = query.symbol ? String(query.symbol) : undefined
  const method = query.method ? String(query.method) : undefined
  const strategyVersion = query.strategyVersion ? String(query.strategyVersion) : undefined

  const { items, total, mongo } = await listNativeSignals({
    limit,
    ownerId: requireOwnerId(event),
    cursor,
    symbol,
    method,
    strategyVersion
  })
  const { data, nextCursor } = cursorPage(items, limit, (item) => item.id)

  return {
    success: true,
    data,
    nextCursor,
    meta: { total, mongo }
  }
})
