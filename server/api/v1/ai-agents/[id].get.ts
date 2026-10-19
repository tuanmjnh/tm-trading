import { getRouterParam } from 'h3'
import { aiAgentsHttpError, getAgentDetail } from '../../../utils/aiAgents'

// =============================================================================
//  GET /api/v1/ai-agents/:id — agent + active version + derived health (§59.16).
//
//  `health` is computed from the persisted heartbeat, never stored as a second
//  truth. Unknown agent -> 404, store down -> 503.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  try {
    const data = await getAgentDetail(id, requireOwnerId(event))
    if (!data) throw Object.assign(new Error(`agent not found: ${id}`), {
      statusCode: 404,
      statusMessage: 'agent_not_found'
    })
    return { success: true, data }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
