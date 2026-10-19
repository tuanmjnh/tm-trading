// POST /api/v1/news/sources/:id/validate — connectivity probe (V3.5 §60.12).
// Fetches the public feed endpoint with a timeout; reports reachability +
// latency. Never mutates the registry (health is written by ingest runs) and
// never touches secrets (none are stored).
import { validateNewsSource } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  return validateNewsSource(id)
})
