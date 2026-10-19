import { getRouterParam, readBody } from 'h3'
import { logSessionEvent, sessionsHttpError } from '../../../../utils/sessions'

// =============================================================================
//  POST /api/v1/sessions/:id/events — append a timeline event (Slice C).
//
//  Body: { kind?, message? }. The timeline is capped server-side (overflow
//  drops the oldest and counts it — never silent). Unknown session -> 404,
//  store down -> 503. Token required (D10).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw sessionsHttpError(new Error('session id is required'))
  }

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw sessionsHttpError(new Error('body must be an object'))
  }

  try {
    const data = await logSessionEvent(id, {
      kind: typeof body.kind === 'string' ? body.kind : 'note',
      message: typeof body.message === 'string' ? body.message.slice(0, 500) : ''
    }, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw sessionsHttpError(err)
  }
})
