import { getRouterParam, readBody } from 'h3'
import { aiProviderHttpError, setAiModelEnabled, setAiPrimaryModel, clearAiPrimaryModel } from '../../../../../../../utils/aiProviders'

// PATCH /api/v1/ai/providers/connections/:id/models/:model — per-model control.
// Body: { isEnabled?: boolean, isPrimary?: boolean }. `isPrimary: true` switches
// the bot's active model (connection.model) and resets the health result;
// `isPrimary: false` only clears the primary badge (the active model stays).
// `:model` is URL-encoded by the client (model ids contain `:`, `/`, `.`).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const connectionId = String(getRouterParam(event, 'id') ?? '').trim()
  const model = decodeURIComponent(String(getRouterParam(event, 'model') ?? '')).trim()
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!model || !body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'model and a JSON body are required' })
  }
  try {
    if (body.isPrimary === true) {
      const res = await setAiPrimaryModel(ownerId, connectionId, model)
      if (!res) {
        throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'connection not found' })
      }
      return { success: true, data: { model: res.model, primary: model } }
    }
    if (body.isPrimary === false) {
      const res = await clearAiPrimaryModel(ownerId, connectionId, model)
      if (!res) {
        throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'model row not found' })
      }
      return { success: true, data: { model: res.model, primary: null } }
    }
    if (typeof body.isEnabled === 'boolean') {
      const row = await setAiModelEnabled(ownerId, connectionId, model, body.isEnabled)
      if (!row) {
        throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'model row not found' })
      }
      return { success: true, data: { model: row.model, isEnabled: row.isEnabled } }
    }
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'isEnabled or isPrimary is required' })
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})



