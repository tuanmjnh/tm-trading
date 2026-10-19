// GET /api/v1/news/:id — one item detail (V3.5 §60.12).
// Rights-safe: served only through the server-side allowlist projection, and
// items whose source is revoked/unverified resolve to 404 (not revealed).
// ?detail=full adds the append-only revision trail (§60.11 provenance).
import { getNewsItem, getNewsItemDetail } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const query = getQuery(event)
  if (query.detail === 'full') return getNewsItemDetail(id)
  return getNewsItem(id)
})
