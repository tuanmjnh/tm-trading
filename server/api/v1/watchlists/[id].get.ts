import { getRouterParam } from 'h3'
import { getWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  GET /api/v1/watchlists/:id — one of the owner's lists.
//
//  Unknown id (or another owner's id) -> 404, store down -> 503. The owner
//  scoping is applied in the query, so a list id from a different tenant
//  can never leak across (docs/web-app/user-tenancy-plan.md).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw watchlistsHttpError(new Error('watchlist id is required'))

  try {
    const data = await getWatchlist(id, requireOwnerId(event))
    if (!data) throw Object.assign(new Error(`watchlist not found: ${id}`), {
      statusCode: 404,
      statusMessage: 'watchlist_not_found'
    })
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})