import { createError, getRouterParam, readBody } from 'h3'
import { playReplaySession, replayHttpError } from '../../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions/:id/play — start (or resume) the auto-step.
//
//  Body: { speed? } — 0.5 | 1 | 2 | 5 | 10 (validated by the player itself,
//  REPLAY_SPEEDS is its single source). The server arms an unref'd timer that
//  steps ONE bar per candle-period / speed; the client keeps up by polling
//  GET :id?cursor=N. Playing a finished session = 409 replay_done.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  const body = await readBody(event).catch(() => undefined)
  const speed = body && typeof body === 'object' ? (body as { speed?: unknown }).speed : undefined
  try {
    return { success: true, data: playReplaySession(id, speed) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
