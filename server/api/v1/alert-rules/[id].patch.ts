import { getRouterParam, readBody } from 'h3'
import { updateAlertRule } from '../../../utils/alertRules'

/**
 * PATCH /api/v1/alert-rules/:id — edit a rule / toggle `enabled` (roadmap §58.5).
 *
 * Requires the hub token. The util merges the patch over the stored rule, then
 * re-validates + re-normalizes via the engine and mints the new stable ruleKey.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody(event)
  const rule = await updateAlertRule(id, body, requireOwnerId(event))
  return { success: true, data: rule }
})
