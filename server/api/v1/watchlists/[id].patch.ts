import { getRouterParam, readBody } from 'h3'
import { reorderSymbols, updateWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  PATCH /api/v1/watchlists/:id — rename a list, replace its symbols, or reorder.
//
//  Body: { name?, symbols?, order? }. `order` is the full ordered array of
//  symbols (same set as stored, else 400). Renaming to an existing name -> 409.
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

  // `order` is mutually exclusive with `symbols` — a reorder is a position
  // change, not a content change, so it must not also swap the symbol set.
  if (Array.isArray(body.order) && body.symbols !== undefined) {
    throw watchlistsHttpError(new Error('order and symbols cannot be combined in one PATCH'))
  }

  try {
    let data
    if (Array.isArray(body.order)) {
      data = await reorderSymbols(id, ownerId, body.order as readonly string[])
    } else {
      data = await updateWatchlist(id, ownerId, {
        name: typeof body.name === 'string' ? body.name : undefined,
        symbols: Array.isArray(body.symbols) ? body.symbols : undefined
      })
    }
    if (!data) throw Object.assign(new Error(`watchlist not found: ${id}`), {
      statusCode: 404,
      statusMessage: 'watchlist_not_found'
    })
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})