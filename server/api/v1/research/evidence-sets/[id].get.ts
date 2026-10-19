import { getRouterParam } from 'h3'
import { evidenceHttpError, getEvidenceSet } from '../../../../utils/evidenceSets'

// =============================================================================
//  GET /api/v1/research/evidence-sets/:id — one set + integrity + sufficiency.
//
//  `integrity.ok === false` means the stored hash no longer matches its content:
//  the set was edited after being frozen. That is reported, never repaired or
//  hidden — a tampered evidence set is the one thing this document exists to
//  detect.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw evidenceHttpError(new Error('evidence set id is required'))

  try {
    const data = await getEvidenceSet(id, {}, requireOwnerId(event))
    if (!data) {
      throw Object.assign(new Error(`evidence set not found: ${id}`), {
        statusCode: 404,
        statusMessage: 'evidence_not_found'
      })
    }
    return { success: true, data }
  } catch (err) {
    throw evidenceHttpError(err)
  }
})
