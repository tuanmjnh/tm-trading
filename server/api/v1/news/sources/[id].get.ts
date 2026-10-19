// GET /api/v1/news/sources/:id — one registry row (V3.5 §60.2).
import { getNewsSource } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  return getNewsSource(id)
})
