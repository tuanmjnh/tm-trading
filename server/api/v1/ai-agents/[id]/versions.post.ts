import { getRouterParam, readBody } from 'h3'
import { aiAgentsHttpError, publishAgentVersion } from '../../../../utils/aiAgents'

// =============================================================================
//  POST /api/v1/ai-agents/:id/versions — publish an IMMUTABLE version (Slice D).
//
//  Body: { autonomy?, model?, prompts:{system}, tools?, note?, createdBy? }.
//  The version number is assigned server-side. A tool outside the autonomy
//  allowlist is rejected before anything is persisted (400) — an unauthorized
//  capability never becomes a stored version.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw aiAgentsHttpError(new Error('agent id is required'))

  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw aiAgentsHttpError(new Error('body must be an object'))
  }

  try {
    const data = await publishAgentVersion(id, {
      autonomy: typeof body.autonomy === 'string' ? body.autonomy : undefined,
      model: body.model && typeof body.model === 'object' && !Array.isArray(body.model)
        ? body.model as Record<string, unknown>
        : null,
      prompts: body.prompts && typeof body.prompts === 'object' && !Array.isArray(body.prompts)
        ? { system: typeof (body.prompts as Record<string, unknown>).system === 'string' ? String((body.prompts as Record<string, unknown>).system) : '' }
        : null,
      tools: Array.isArray(body.tools) ? body.tools.map(String) : [],
      note: typeof body.note === 'string' ? body.note : '',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : null
    }, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw aiAgentsHttpError(err)
  }
})
