// POST /api/v1/research/experiments/:id/news-evidence — cite a frozen news
// evidence set from an experiment (V3.5 §60 Slice E). Body: { setId }.
// The set and the experiment must both exist; the back-reference is append-only.
import { citeNewsEvidenceSet } from '~~/server/utils/newsEvidence'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event).catch(() => ({}))
  const setId = String(body.setId || '')
  if (!setId) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidArgs', message: 'setId is required' })
  }
  return citeNewsEvidenceSet(setId, id, undefined, requireOwnerId(event))
})
