import { getRouterParam } from 'h3'
import { deleteWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  DELETE /api/v1/watchlists/:id — remove a named list.
//
//  The default list CANNOT be deleted (409 with code 'cannot_delete_default').
//  Unknown id (or another owner's) -> 404. Store down -> 503.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw watchlistsHttpError(new Error('watchlist id is required'))

  try {
    await deleteWatchlist(id, requireOwnerId(event))
    return { success: true }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})