import { readBody } from 'h3'
import { aiAgentsHttpError, createAgentRecord } from '../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents — register a governed agent (Slice D).
//
//  Body: { name, description?, autonomy?, accountId?, instruments?, createdBy? }.
//  The doc is guard-built (engine/agentPolicy.mjs createAgent) and starts in
//  `draft` — creating an agent never grants it autonomy. 400 on bad input,
//  409 on duplicate id, 503 when the store is down.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw aiAgentsHttpError(new Error('body must be an object'))
  }
  try {
    const data = await createAgentRecord({
      ownerId: requireOwnerId(event),
      name: typeof body.name === 'string' ? body.name : '',
      description: typeof body.description === 'string' ? body.description : '',
      autonomy: typeof body.autonomy === 'string' ? body.autonomy : undefined,
      accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      instruments: Array.isArray(body.instruments) ? body.instruments.map(String) : undefined,
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : null
    })
    return { success: true, data }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
