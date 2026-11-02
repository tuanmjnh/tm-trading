import { getRouterParam, readBody } from 'h3'
import { updateWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  PATCH /api/v1/watchlists/:id — rename a list or replace its symbols.
//
//  Body: { name?, symbols? }. Renaming to an existing name -> 409.
//  Store down -> 503. Unknown id (or another owner's) -> 404.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw watchlistsHttpError(new Error('watchlist id is required'))
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw watchlistsHttpError(new Error('body must be an object'))
  }
  try {
    const data = await updateWatchlist(id, ownerId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      symbols: Array.isArray(body.symbols) ? body.symbols : undefined
    })
    if (!data) throw Object.assign(new Error(`watchlist not found: ${id}`), {
      statusCode: 404,
      statusMessage: 'watchlist_not_found'
    })
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})