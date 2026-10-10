import { createError, getQuery, getRouterParam } from 'h3'
import { readReplaySession, replayHttpError } from '../../../../utils/replaySessions'

// =============================================================================
//  GET /api/v1/replay/sessions/:id — session summary + events after ?cursor.
//
//  The cursor is the client's "how many bars I already have" counter: the
//  response only ever contains PLAYED events (player.takeEvents(cursor)), so
//  polling for more can never observe the future (D17). No cursor = everything
//  played so far.
// =============================================================================

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  const q = getQuery(event)
  const raw = q.cursor !== undefined ? Number(q.cursor) : 0
  const cursor = Number.isInteger(raw) && raw >= 0 ? raw : 0
  try {
    return { success: true, data: readReplaySession(id, cursor) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
