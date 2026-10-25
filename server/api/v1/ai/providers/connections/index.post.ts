import { readBody } from 'h3'
import { aiProviderHttpError, saveAiConnection } from '../../../../../utils/aiProviders'

// POST /api/v1/ai/providers/connections — create or update an app-owned provider
// connection. Omit `apiKey` on an update to keep the stored secret; the response
// is a redacted row (mask + fingerprint only).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }
  try {
    const data = await saveAiConnection(ownerId, body)
    return { success: true, data }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
