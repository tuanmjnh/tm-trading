import { getRouterParam, readBody } from 'h3'
import { aiProviderHttpError, setAiConnectionEnabled } from '../../../../../utils/aiProviders'

// PATCH /api/v1/ai/providers/connections/:id — enable/disable only. Editing
// provider/model/secret goes through POST so a partial body can never erase a
// credential by omission.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: '`enabled` boolean is required' })
  }
  try {
    const data = await setAiConnectionEnabled(ownerId, id, body.enabled)
    return { success: true, data }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
