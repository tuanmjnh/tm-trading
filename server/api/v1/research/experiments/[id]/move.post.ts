import { createError, getRouterParam, readBody } from 'h3'
import { moveExperimentResearch, researchHttpError } from '../../../../../utils/research'

// =============================================================================
//  POST /api/v1/research/experiments/:id/move — advance the §28.1 lifecycle one
//  legal step. Body: { to: <state> }.
//
//  The engine's transition() refuses every illegal jump, so a client cannot skip
//  stages or leave a terminal state. This endpoint only maps the result to HTTP;
//  a human drives the state machine (D7).
//
//  Fail-soft: bad body -> 400; unknown experiment -> 404; illegal/again
//  transition -> 409 illegal_transition; Mongo down -> 503.
// =============================================================================

interface MoveBody {
  to?: unknown
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'experiment id is required' })
  }

  const body = (await readBody(event).catch(() => null)) as MoveBody | null
  const to = String(body?.to ?? '').trim()
  if (!to) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_state', message: 'to is required' })
  }

  try {
    const data = await moveExperimentResearch(id, to, {}, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw researchHttpError(err)
  }
})
