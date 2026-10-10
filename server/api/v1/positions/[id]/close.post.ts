import { createError, getRouterParam, readBody } from 'h3'
import { closePositionAction } from '../../../../utils/positionActions'

// =============================================================================
//  POST /api/v1/positions/:id/close — close a position (Phase 7P D7e).
//
//  Body: {} or absent = FULL close; { qty } = partial by absolute size;
//  { pct } = partial by percent (pct 100 = full). qty XOR pct once given.
//  The risk gate checks it first (checkPartialClose), the fill model prices
//  the slice (taker market on the latest 1m close), then the CAS write lands:
//  full -> parent closed + alert follows; partial -> parent re-sized + a
//  CLOSED child document forked. Rejects: 400 close_rejected (gate codes),
//  409 conflict (concurrent change), 502 no_quote (no price to fill at).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'position id is required' })
  }
  // A bodyless POST is a legitimate full close — never let readBody throw on it.
  const body = await readBody(event).catch(() => undefined)
  return await closePositionAction(id, body)
})
