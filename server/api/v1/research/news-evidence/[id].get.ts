// GET /api/v1/research/news-evidence/:id — one frozen news evidence set and
// its survival report (V3.5 §60 Slice E + §60.11 retention exception).
//
// The set is immutable and self-citing: `refs` are the references copied at
// freeze time, and `survival` counts how many cited rows are still live versus
// expired by the 7-day NewsItem TTL. Expired citations are still reproducible —
// that is the point of copying them — and the field is reported, not hidden.
import { getNewsEvidenceSet } from '~~/server/utils/newsEvidence'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidArgs', message: 'id is required' })
  }
  return getNewsEvidenceSet(id, undefined, requireOwnerId(event))
})
