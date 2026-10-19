import { getQuery } from 'h3'
import { parseSince } from '../../../utils/signals'
import { listResearchTrades } from '../../../utils/research'

/**
 * GET /api/v1/research/trades — executed-trade dataset for research (roadmap §30.7).
 *
 * Same source as GET /api/v1/journal (D1: engine/journal.mjs); research filters
 * the SAME executed-trade journal the dashboard shows. stats are computed over
 * the whole filtered set (not one page). Token required (server/middleware/auth.ts).
 *
 * Query: ?limit=&cursor=&source=&method=&regime=&result=&symbol=&tf=
 *        &account=&from=&to=  (from/to: ISO-8601 or epoch ms)
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)

  const from = parseSince(query.from ? String(query.from) : undefined)
  const to = parseSince(query.to ? String(query.to) : undefined)

  const { items, total, stats, source, warnings, filters } = await listResearchTrades({
    ownerId: requireOwnerId(event),
    limit,
    cursor,
    source: query.source ? String(query.source) : undefined,
    method: query.method ? String(query.method) : undefined,
    regime: query.regime ? String(query.regime) : undefined,
    result: query.result ? String(query.result) : undefined,
    symbol: query.symbol ? String(query.symbol) : undefined,
    tf: query.tf ? String(query.tf) : undefined,
    account: query.account ? String(query.account) : undefined,
    from,
    to
  })

  let start = 0
  if (cursor) {
    const idx = items.findIndex(i => i.key === cursor)
    start = idx >= 0 ? idx + 1 : 0
  }
  const page = items.slice(start, start + limit)
  const nextCursor = start + limit < items.length
    ? (page[page.length - 1]?.key ?? null)
    : null

  return {
    success: true,
    data: page,
    nextCursor,
    stats,
    meta: { total, source, warnings, filters }
  }
})
