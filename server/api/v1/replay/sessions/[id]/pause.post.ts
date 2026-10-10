import { createError, getRouterParam } from 'h3'
import { pauseReplaySession, replayHttpError } from '../../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions/:id/pause — stop the auto-step timer.
//
//  The cursor freezes where it is: already-played events stay readable, the
//  future stays private. Pausing a paused/ready session is a no-op (idempotent).
// =============================================================================

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  try {
    return { success: true, data: pauseReplaySession(id) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
