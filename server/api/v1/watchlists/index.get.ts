import { listWatchlists } from '../../../utils/watchlists'
import { watchlistsModel } from '../../../utils/engineModel'

// =============================================================================
//  GET /api/v1/watchlists — the owner's named lists (default first).
//
//  Fail-soft: a down store returns an empty list, never a 500 (D12). The
//  trading panel reads the default list from here; the Lists tab reads the
//  rest. Tenancy: every list is scoped to requireOwnerId(event).
// =============================================================================

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const Model = await watchlistsModel()
  const data = await listWatchlists(ownerId)
  return { success: true, data, meta: { count: data.length, mongo: Model ? 'up' : 'down' } }
})