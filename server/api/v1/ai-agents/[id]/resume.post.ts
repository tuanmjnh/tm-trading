import { getRouterParam } from 'h3'
import { aiAgentsHttpError, moveAgent } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/resume — paused -> active (§59.13).
//
//  Resume stamps a fresh heartbeat: an agent resumed after a long pause must
//  prove liveness again rather than inherit a stale one.
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
