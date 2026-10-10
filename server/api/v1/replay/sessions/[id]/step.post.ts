import { createError, getRouterParam, readBody } from 'h3'
import {
  replayHttpError,
  stepReplaySession,
  validateStepBody
} from '../../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions/:id/step — manual advance (roadmap §13:
//  "Step 1 event / Step 1 candle"). Body: { candles? } default 1, max 500.
//
//  Manual stepping takes over from the auto-timer (clears it first — play and
//  step never race), so the operator can drive the replay bar-by-bar, pause
//  included. Response carries the newly played events directly.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  const body = await readBody(event).catch(() => undefined)
  const v = validateStepBody(body)
  if (!v.ok || !v.value) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_step', message: v.error ?? 'invalid step body' })
  }
  try {
    return { success: true, data: await stepReplaySession(id, v.value.candles) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
