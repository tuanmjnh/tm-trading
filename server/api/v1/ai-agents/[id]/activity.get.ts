import { getQuery, getRouterParam } from 'h3'
import { aiAgentsHttpError, listAgentActions } from '../../../../utils/aiAgents'

// =============================================================================
//  GET /api/v1/ai-agents/:id/activity — the append-only action ledger.
//
//  Returns allowed AND blocked rows: §59.16 requires unauthorized actions to be
//  audited, so a clean report is not the same as a silent one.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))
  const q = getQuery(event)
  try {
    const data = await listAgentActions(id, Number(q.limit) || 50, requireOwnerId(event))
    return { success: true, data, meta: { count: data.length } }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
