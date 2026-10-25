import { readBody } from 'h3'
import { aiProviderHttpError, discoverAiModels } from '../../../../../utils/aiProviders'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }
  try {
    const data = await discoverAiModels(ownerId, body)
    return { success: true, data }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
