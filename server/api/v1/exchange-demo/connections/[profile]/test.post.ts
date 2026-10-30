import { getRouterParam } from 'h3'
import { exchangeDemoHttpError, testExchangeDemoConnection } from '../../../../../utils/exchangeDemo'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const profile = String(getRouterParam(event, 'profile') ?? '').trim()
  try {
    return { success: true, data: await testExchangeDemoConnection(ownerId, profile) }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
