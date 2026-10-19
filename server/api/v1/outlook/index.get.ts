// GET /api/v1/outlook — horizon outlook snapshot (V3.5 §60 Slice D).
// ?group=crypto&horizon=short_term|swing|long_term. Deterministic rule-v1
// synthesis with evidence IDs; unsupported groups -> insufficient_evidence.
import { getOutlook } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  return getOutlook(String(query.group || 'crypto'), String(query.horizon || 'short_term'))
})
