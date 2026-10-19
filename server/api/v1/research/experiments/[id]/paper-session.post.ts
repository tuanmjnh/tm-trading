import { getRouterParam, readBody } from 'h3'
import { createPaperValidationSession, evidenceHttpError } from '../../../../../utils/evidenceSets'

// =============================================================================
//  POST /api/v1/research/experiments/:id/paper-session — validate a candidate.
//
//  Body: { instruments?, timeframes?, accountId?, evidenceSetId?, createdBy? }.
//
//  Refused (409) unless the experiment is IN `paper_validation`, and refused when
//  an ACTIVE profile already points at the candidate version — that would mean a
//  silent promotion (D31), not a validation. The created live-paper session is a
//  normal Slice C session: its manifest records the experiment and the frozen
//  evidence behind it, and its orders still pass the Risk Gate.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw evidenceHttpError(new Error('experiment id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null

  try {
    const data = await createPaperValidationSession(id, {
      instruments: Array.isArray(body?.instruments) ? body?.instruments.map(String) : undefined,
      timeframes: Array.isArray(body?.timeframes) ? body?.timeframes.map(String) : undefined,
      accountId: typeof body?.accountId === 'string' ? body.accountId : undefined,
      evidenceSetId: typeof body?.evidenceSetId === 'string' ? body.evidenceSetId : null,
      createdBy: typeof body?.createdBy === 'string' ? body.createdBy : null
    }, {}, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw evidenceHttpError(err)
  }
})
