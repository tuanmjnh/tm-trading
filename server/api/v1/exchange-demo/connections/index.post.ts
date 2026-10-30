import { readBody } from 'h3'
import { exchangeDemoHttpError, saveExchangeDemoConnection } from '../../../../utils/exchangeDemo'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => null) as Record<string, unknown> | null
  if (!body) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  try {
    return { success: true, data: await saveExchangeDemoConnection(ownerId, body) }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
