import { getRouterParam } from 'h3'
import { aiAgentsHttpError, moveAgent } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/pause — active -> paused (§59.13).
//
//  A paused agent may not act: every action is refused with AGENT_NOT_ACTIVE and
//  audited, so pause is a real stop, not a label.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))
  try {
    return { success: true, data: await moveAgent(id, 'paused', requireOwnerId(event)) }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
