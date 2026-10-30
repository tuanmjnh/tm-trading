import { getRouterParam } from 'h3'
import { deleteExchangeDemoConnection, exchangeDemoHttpError } from '../../../../utils/exchangeDemo'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const profile = String(getRouterParam(event, 'profile') ?? '').trim()
  try {
    const deleted = await deleteExchangeDemoConnection(ownerId, profile)
    if (!deleted) throw createError({ statusCode: 404, statusMessage: 'error.not_found', message: 'demo connection not found' })
    return { success: true, data: { deleted: true } }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
