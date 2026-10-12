import { getQuery } from 'h3'
import { listAlertRules } from '../../../utils/alertRules'

/**
 * GET /api/v1/alert-rules — the user's alert rule definitions (roadmap §58.5).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC; Mongo
 * khong ket noi duoc -> 200 + meta.mongo='down' + data rong (fail-soft, khong 500).
 *
 * Query: ?limit=(1..200, mac dinh 100)&enabled=(true|false)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = Number(query.limit)
  const limit = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 100, 1), 200)

  let enabled: boolean | undefined
  if (query.enabled === 'true') enabled = true
  else if (query.enabled === 'false') enabled = false

  const { items, total, mongo } = await listAlertRules({ limit, enabled })

  return {
    success: true,
    data: items,
    meta: { count: items.length, total, mongo }
  }
})
