import { getRouterParam } from 'h3'
import { aiAgentsHttpError, moveAgent } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/start — draft/validated -> active (§59.13).
//
//  An agent cannot become active without a published version (409). The move is
//  guarded by engine/agentPolicy.mjs transitionAgent: illegal jumps are
//  refused, never forced.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))
  try {
    return { success: true, data: await moveAgent(id, 'active', requireOwnerId(event)) }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
