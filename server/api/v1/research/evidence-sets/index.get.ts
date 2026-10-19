import { getQuery } from 'h3'
import { listEvidenceSets } from '../../../../utils/evidenceSets'

// =============================================================================
//  GET /api/v1/research/evidence-sets — frozen evidence sets (§59.15 Slice E).
//
//  Read-only and fail-soft: an unavailable store returns an empty list, never a
//  500 — the UI shows "no evidence yet", which is true, instead of an error.
// =============================================================================

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

  const data = await listEvidenceSets({
    kind: str(q.kind),
    sessionId: str(q.sessionId),
    strategyVersionId: str(q.strategyVersionId),
    limit: Number(q.limit) || 50
  }, {}, requireOwnerId(event))

  return { success: true, data, meta: { count: data.length } }
})
