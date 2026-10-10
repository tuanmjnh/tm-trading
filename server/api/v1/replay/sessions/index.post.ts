import { createError, readBody } from 'h3'
import {
  createReplaySession,
  replayHttpError,
  validateCreateSessionBody
} from '../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions — create a replay session (Phase 7R2).
//
//  Body: { symbol?, interval?, limit?, market? } (all optional, defaults
//  BTCUSDT / 1m / 300 / MARKET_EXCHANGE). Bars come from the same candles
//  source the live chart uses; the player keeps only CLOSED bars — a
//  forming candle is future data (D17). Response: the session summary
//  (cursor 0 — nothing played yet, nothing leaked).
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => undefined)
  const v = validateCreateSessionBody(body)
  if (!v.ok || !v.value) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_replay_session', message: v.error ?? 'invalid session body' })
  }
  try {
    return { success: true, data: await createReplaySession(v.value) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
