import { getQuery } from 'h3'
import { parseSince } from '../../../utils/signals'
import { listJournal } from '../../../utils/journal'

/**
 * GET /api/v1/journal - central executed-trade journal (Phase 13).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC —
 * engine/journal.mjs la nguon duy nhat (D1); Mongo down -> NDJSON mirror, ca
 * hai loi -> mang rong + meta.source='none' (fail-soft, khong 500).
 *
 * stats luon tinh tren TOAN bo bo loc (khong phan trang) — win rate cua 1 trang
 * khong phai win rate.
 *
 * Query: ?limit=&cursor=&source=&method=&regime=&result=&symbol=&tf=
 *        &account=&from=&to=  (from/to: ISO-8601 hoac epoch ms)
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)

  const from = parseSince(query.from ? String(query.from) : undefined)
  const to = parseSince(query.to ? String(query.to) : undefined)

  const { items, total, stats, source, warnings, filters } = await listJournal({
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
