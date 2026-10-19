// GET /api/v1/news — News Desk list (V3.5 §60 Slice B, read-only).
// Rights-safe by construction: only the server-side allowlist projection
// leaves the API. Mongo down -> 200 empty + meta.mongo='down' (never 500).
import { listNewsItems } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const level = String(query.level || '')
  const data = await listNewsItems({
    limit: Number(query.limit || 50),
    marketGroup: query.group ? String(query.group) : undefined,
    level: level === 'high' || level === 'med' ? level : undefined,
    sourceId: query.source ? String(query.source) : undefined,
    q: query.q ? String(query.q) : undefined,
    since: query.since ? String(query.since) : undefined,
  })
  return data
})
