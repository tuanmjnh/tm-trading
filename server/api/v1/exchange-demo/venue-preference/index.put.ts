import { readBody } from 'h3'
import { saveVenuePreference } from '../../../../utils/exchangeVenues'
import { exchangeDemoHttpError } from '../../../../utils/exchangeDemo'

// PUT /api/v1/exchange-demo/venue-preference — persist the preferred venue,
// market-data failover policy and fallback order. The store FORCES
// executionEnvironment=DEMO and executionSwitchPolicy=MANUAL_NEW_SESSION_ONLY,
// so the browser can never select production execution or automatic venue
// switching (§64.4/§64.5B).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => null) as Record<string, unknown> | null
  if (!body) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  try {
    return { success: true, data: await saveVenuePreference(ownerId, body) }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
