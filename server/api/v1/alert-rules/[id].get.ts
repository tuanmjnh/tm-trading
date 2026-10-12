import { createError, getRouterParam } from 'h3'
import { getAlertRuleById } from '../../../utils/alertRules'

/**
 * GET /api/v1/alert-rules/:id — one alert rule (roadmap §58.5). Read-only.
 * Mongo down -> the util returns null -> 404 (no rule can be confirmed).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const rule = await getAlertRuleById(id)
  if (!rule) {
    throw createError({ statusCode: 404, statusMessage: 'not_found', message: `alert rule not found: ${id}` })
  }
  return { success: true, data: rule }
})
