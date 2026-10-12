import { readBody } from 'h3'
import { createAlertRule } from '../../../utils/alertRules'

/**
 * POST /api/v1/alert-rules — create an alert rule (roadmap §58.5).
 *
 * Requires the hub token (server/middleware/auth.ts). Thin on purpose: the util
 * validates/normalizes via the engine (engine/alertRules.mjs) and persists.
 * Duplicate definitions (same stable ruleKey) surface as 409; Mongo down as 503.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const rule = await createAlertRule(body)
  return { success: true, data: rule }
})
