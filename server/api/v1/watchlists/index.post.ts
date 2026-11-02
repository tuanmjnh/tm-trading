import { readBody } from 'h3'
import { createWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  POST /api/v1/watchlists — create a named list for the owner.
//
//  Body: { name, symbols? }. The FIRST list ever created becomes the default
//  (the trading panel reads it). 400 on bad input, 409 on duplicate name or
//  when the owner has reached the list limit, 503 when the store is down.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw watchlistsHttpError(new Error('body must be an object'))
  }
  try {
    const data = await createWatchlist(requireOwnerId(event), {
      name: typeof body.name === 'string' ? body.name : '',
      symbols: Array.isArray(body.symbols) ? body.symbols : []
    })
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})