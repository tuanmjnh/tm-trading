import { createError, getRouterParam, readBody } from 'h3'
import { modifyPositionAction } from '../../../utils/positionActions'

// =============================================================================
//  PATCH /api/v1/positions/:id — modify SL / TP (roadmap Phase 7P D7e).
//
//  Thin on purpose (mirror POST /api/v1/orders): the util owns gate -> CAS
//  write. Body { sl?, tps? }, at least one present. The risk gate decides —
//  a reject comes back as 400 modify_rejected with the gate's own code+message
//  (BAD_SL / BAD_TPS / RISK_BUDGET / MIN_RR / HALTED / DAILY_LOSS_CAP ...).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'position id is required' })
  }
  const body = await readBody(event).catch(() => undefined)
  return await modifyPositionAction(id, body)
})
