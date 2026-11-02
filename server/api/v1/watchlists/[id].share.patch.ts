import { getRouterParam, readBody } from 'h3'
import { shareWatchlist, unshareWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  PATCH /api/v1/watchlists/:id/share — grant or revoke another owner's access.
//
//  Body: { action: 'add' | 'remove', with: <hub user id> }. Owner-only: a
//  shared recipient gets 403. Unknown id -> 404. Store down -> 503.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw watchlistsHttpError(new Error('watchlist id is required'))
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw watchlistsHttpError(new Error('body must be an object'))
  }

  const action = typeof body.action === 'string' ? body.action.toLowerCase().trim() : undefined
  const withId = typeof body.with === 'string' ? body.with.trim() : undefined
  if (action !== 'add' && action !== 'remove') {
    throw watchlistsHttpError(new Error('action must be "add" or "remove"'))
  }
  if (!withId || withId === ownerId) {
    throw watchlistsHttpError(new Error('invalid share target'))
  }

  try {
    const data = action === 'add'
      ? await shareWatchlist(id, ownerId, withId)
      : await unshareWatchlist(id, ownerId, withId)
    if (!data) throw Object.assign(new Error(`watchlist not found: ${id}`), {
      statusCode: 404,
      statusMessage: 'watchlist_not_found'
    })
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})
