import { getRouterParam } from 'h3'
import { evidenceGraphHttpError, getSessionEvidenceGraph } from '../../../../utils/evidenceGraph'

// =============================================================================
//  GET /api/v1/sessions/:id/evidence — reconstruct a session from its evidence.
//
//  Returns the session, its frozen evidence set (or a clearly labelled live
//  preview), the journal rows derived from it, linked news evidence, citing
//  experiments and related sets, plus the deterministic digest and the record
//  ids an analysis is allowed to cite (Phase F, roadmap §61.17).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw evidenceGraphHttpError(Object.assign(new Error('session id is required'), { statusCode: 400, statusMessage: 'invalid_session' }))

  try {
    const data = await getSessionEvidenceGraph(id, {}, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw evidenceGraphHttpError(err)
  }
})
