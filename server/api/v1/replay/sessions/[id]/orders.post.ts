import { createError, getRouterParam, readBody } from 'h3'
import { placeReplayOrder, replayHttpError } from '../../../../../utils/replaySessions'

// =============================================================================
//  POST /api/v1/replay/sessions/:id/orders — place a manual ticket into a
//  replay session's in-memory book (Phase 7R2, roadmap §25).
//
//  Intake mirrors POST /api/v1/orders: validateTicket shape checks, then the
//  SAME risk gate (exec/risk checkOrder, D7) sizes and approves the order.
//  Differences: symbol/tf come from the SESSION (a ticket naming another
//  symbol is 400 replay_invalid_order), a gate reject is 400
//  replay_order_rejected with the gate's code+message, and nothing touches
//  the alerts/positions collections — the paper executor must never see a
//  replay order.
//
//  Response: { success, data: { order, session } } — order.status is
//  'working' until the replay clock provides a marketable quote.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'session id is required' })
  }
  const body = await readBody(event).catch(() => undefined)
  try {
    return { success: true, data: await placeReplayOrder(id, body) }
  } catch (err) {
    throw replayHttpError(err)
  }
})
