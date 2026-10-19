import { getRouterParam } from 'h3'
import { aiAgentsHttpError, moveAgent } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/disable — any non-terminal state -> disabled.
//
//  `disabled` is terminal: the state machine has no outgoing edge, so a
//  disabled agent can never be resumed — it is superseded by a new agent or a
//  new version, which keeps the audit trail honest.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))
  try {
    return { success: true, data: await moveAgent(id, 'disabled', requireOwnerId(event)) }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
