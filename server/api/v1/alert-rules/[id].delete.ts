import { getRouterParam } from 'h3'
import { deleteAlertRule } from '../../../utils/alertRules'

/**
 * DELETE /api/v1/alert-rules/:id — remove a rule (roadmap §58.5). Requires the hub
 * token. Deleting a rule never touches the notification ledger (history is kept).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const result = await deleteAlertRule(id, requireOwnerId(event))
  return { success: true, data: result }
})
