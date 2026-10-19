import { getRouterParam, readBody } from 'h3'
import { aiAgentsHttpError, heartbeatAgent } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/heartbeat — liveness from a runtime (§59.16).
//
//  Body: { at? } (epoch ms, defaults to now). A non-active agent is refused
//  (409): a paused or disabled agent reporting "alive" would be a fabricated
//  status, which is the one thing health reporting must never do (D12).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  const at = body && Number.isFinite(Number(body.at)) ? Number(body.at) : undefined

  try {
    return { success: true, data: await heartbeatAgent(id, at, requireOwnerId(event)) }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
