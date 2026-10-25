import { getRouterParam, readBody } from 'h3'
import { aiProviderHttpError, saveAiModels } from '../../../../../../../utils/aiProviders'

// POST /api/v1/ai/providers/connections/:id/models — bulk-save models into the
// connection's catalogue. Body: { models: Array<string | { model, displayName? }>,
// source?: 'discovered'|'manual' }. Idempotent: existing rows keep their
// per-model enablement.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const connectionId = String(getRouterParam(event, 'id') ?? '').trim()
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  const models = Array.isArray(body?.models) ? body!.models : []
  if (models.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'models array is required' })
  }
  const source = body?.source === 'manual' ? 'manual' : 'discovered'
  const entries = models.map((m) => {
    if (m && typeof m === 'object') {
      const e = m as Record<string, unknown>
      return {
        model: String(e.model ?? e.modelId ?? '').trim(),
        displayName: typeof e.displayName === 'string' ? e.displayName.trim().slice(0, 128) : '',
      }
    }
    return { model: String(m).trim(), displayName: '' }
  }).filter((e) => e.model)
  if (entries.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'models array is required' })
  }
  try {
    const res = await saveAiModels(ownerId, connectionId, entries, source)
    if (!res?.ok) {
      throw createError({
        statusCode: res?.code === 'connection_not_found' ? 404 : 500,
        statusMessage: res?.code === 'connection_not_found' ? 'error.notFound' : 'error.ai_provider',
        message: res?.code ?? 'save failed',
      })
    }
    return { success: true, data: { added: res.added, total: res.total ?? entries.length } }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})



