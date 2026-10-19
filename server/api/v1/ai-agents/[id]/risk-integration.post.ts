import { getRouterParam, readBody } from 'h3'
import { aiAgentsHttpError, recordAgentRiskIntegration } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/risk-integration — unblock A2, once (§59.15).
//
//  Body: { passed: true, tests: [names], evidence?, at? }. Write-once on the
//  active version: evidence may be recorded a single time and can never be
//  un-passed or replaced, so an A2 grant cannot be quietly retracted or forged
//  after the fact.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw aiAgentsHttpError(new Error('body must be an object'))
  }

  try {
    const data = await recordAgentRiskIntegration(id, {
      passed: body.passed === true,
      tests: Array.isArray(body.tests) ? body.tests.map(String) : [],
      evidence: typeof body.evidence === 'string' ? body.evidence : null,
      at: Number.isFinite(Number(body.at)) ? Number(body.at) : undefined
    }, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
