import { listVenues } from '../../../../utils/exchangeVenues'

// GET /api/v1/exchange-demo/venues — demo execution venues, profiles, declared
// capabilities, per-venue isolated health and masked connection status (§64.4).
// Market-data role vs execution role are reported distinctly; executionReady is
// false until a live probe verifies the required capabilities (fail-closed).
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const data = await listVenues(ownerId)
  return { success: true, data }
})
