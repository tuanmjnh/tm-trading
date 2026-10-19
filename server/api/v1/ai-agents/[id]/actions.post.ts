import { getRouterParam, readBody } from 'h3'
import { AgentError, aiAgentsHttpError, submitAgentAction } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/actions — the ONLY way an agent request becomes
//  a real effect (Slice D, §59.15).
//
//  Body: { actionId, type, idempotencyKey, sessionId?, payload?, reason? }.
//  Required for every action: actionId + idempotencyKey (D4). Required for
//  ORDER actions: sessionId, a RUNNING trading session, and a Risk Gate
//  decision obtained by this route from exec/risk.mjs (D7).
//
//  Allowed  -> 200 with the ledger row.
//  Blocked  -> 403, AFTER the row is persisted: the denial is audited (§59.16),
//              never silent, and a retry with the same idempotencyKey replays
//              the same denial instead of acting.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw aiAgentsHttpError(new Error('body must be an object'))
  }

  try {
    const row = await submitAgentAction(id, body, requireOwnerId(event))
    if (row.status === 'blocked') {
      throw new AgentError(String(row.message || 'action blocked'), 403, String(row.code || 'action_blocked'))
    }
    return { success: true, data: row }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
