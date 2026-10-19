// POST /api/v1/news/ingestion/retry — manual reprocessing (V3.5 §60.12).
// Body: { sourceIds?: string[] } — omit/empty to retry every enabled source.
// Privileged: inherits the global hub-token write guard like other mutations.
// Returns the accepted source ids, any unknown ids, and the durable request
// stamp the ingest runner honors on its next cycle.
import { requestNewsRetry } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  return requestNewsRetry(body?.sourceIds)
})
