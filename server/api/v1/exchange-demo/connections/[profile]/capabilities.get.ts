import { capabilitiesFor } from '../../../../../utils/exchangeVenues'
import { exchangeDemoHttpError } from '../../../../../utils/exchangeDemo'
import { getRouterParam } from 'h3'

// GET /api/v1/exchange-demo/connections/:profile/capabilities — declared vs
// verified capability matrix + demo endpoints for one profile (§64.3/§64.8).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const profile = String(getRouterParam(event, 'profile') ?? '').trim()
  try {
    return { success: true, data: await capabilitiesFor(ownerId, profile) }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
