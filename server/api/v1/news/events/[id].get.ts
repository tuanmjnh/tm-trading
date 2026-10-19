// GET /api/v1/news/events/:id — event detail: evidence items + revision trail.
// ?detail=full includes corroborating items (capped); default is the event row.
import { getMarketEvent, getMarketEventDetail } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const query = getQuery(event)
  if (query.detail === 'full') return getMarketEventDetail(id)
  return getMarketEvent(id)
})
