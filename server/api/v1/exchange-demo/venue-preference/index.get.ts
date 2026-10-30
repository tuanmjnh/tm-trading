import { getVenuePreference } from '../../../../utils/exchangeVenues'
import { exchangeDemoHttpError } from '../../../../utils/exchangeDemo'

// GET /api/v1/exchange-demo/venue-preference — the owner's preferred demo venue,
// market-data failover policy + fallback order, and switch policy (§64.4).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  try {
    return { success: true, data: await getVenuePreference(ownerId) }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
