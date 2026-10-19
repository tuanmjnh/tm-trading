import { getQuery } from 'h3'
import { agentPolicyAsync, listAgents } from '../../../utils/aiAgents'

// =============================================================================
//  GET /api/v1/ai-agents — governed agent registry (V3.5 §59.15 Slice D).
//
//  Read-only. Fail-soft: a down store returns an empty list, never a 500 (the
//  page renders an empty state instead of inventing agents — D12). The policy
//  table rides along in `meta` so the UI never hardcodes the autonomy ladder.
// =============================================================================

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const q = getQuery(event)
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s || undefined
  }

  const data = await listAgents({
    ownerId,
    limit: Number(q.limit) || 50,
    state: str(q.state),
    autonomy: str(q.autonomy),
    accountId: str(q.accountId)
  })

  return { success: true, data, meta: { count: data.length, policy: await agentPolicyAsync() } }
})
