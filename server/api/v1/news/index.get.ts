import { getQuery } from 'h3'
import { listNews } from '../../../utils/news'

/**
 * GET /api/v1/news - headline da score tu intel `news` stream (roadmap §58.5).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC; Mongo
 * khong ket noi duoc -> 200 + meta.mongo='down' + data rong (fail-soft, khong 500).
 *
 * Query: ?limit=(1..200, mac dinh 60)&since=(ISO-8601 hoac epoch ms)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = Number(query.limit)
  const limit = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 60, 1), 200)
  const since = query.since ? String(query.since) : undefined

  const { items, total, generatedAt, mongo } = await listNews({ limit, since })

  return {
    success: true,
    data: items,
    meta: { count: items.length, total, mongo, generatedAt }
  }
})
