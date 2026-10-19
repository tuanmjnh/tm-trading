import { getRouterParam, readBody } from 'h3'
import { aiAgentsHttpError, validateAgentVersion } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/validate — check a version against policy.
//
//  Body: { versionId? } (defaults to the active version). Returns 200 with
//  `data.ok` plus every failing check (hash integrity, tool allowlist, disabled
//  autonomy, missing risk-integration evidence). A validation result is data,
//  not an error — the UI needs the reasons.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  const versionId = body && typeof body.versionId === 'string' ? body.versionId : undefined

  try {
    const data = await validateAgentVersion(id, versionId, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
