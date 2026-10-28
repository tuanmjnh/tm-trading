import { getRouterParam, readBody } from 'h3'
import { aiAgentsHttpError, updateAgentRecord } from '../../../utils/aiAgents'

/**
 * PATCH /api/v1/ai-agents/:id — update an AI agent's accountId, name, description, or instruments.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))
  const ownerId = requireOwnerId(event)
  const body = await readBody(event)
  try {
    const updated = await updateAgentRecord(id, ownerId, body)
    if (!updated) {
      throw Object.assign(new Error(`agent not found: ${id}`), { statusCode: 404, statusMessage: 'agent_not_found' })
    }
    return { success: true, data: updated }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
