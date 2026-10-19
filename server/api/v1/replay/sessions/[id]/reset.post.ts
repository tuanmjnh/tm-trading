import { createError, getRouterParam } from 'h3'
import { replayHttpError, resetReplaySession } from '../../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions/:id/reset — rewind a session to bar 0
//  (roadmap §30.6 Replay APIs).
//
//  Deterministic (D1): the player is rebuilt from the SAME source bars the
//  session was created with — no re-fetch, no new history. Cursor -> 0,
//  mode -> 'ready', events buffer + orders + positions cleared, timer stopped.
//  The session id is preserved. Unknown id -> 404 replay_not_found.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  try {
    return { success: true, data: await resetReplaySession(id, requireOwnerId(event)) }
  } catch (err) {
    throw replayHttpError(err)
  }
})