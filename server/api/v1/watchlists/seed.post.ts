import { readBody } from 'h3'
import { seedDefaultWatchlist, watchlistsHttpError } from '../../../utils/watchlists'

// =============================================================================
//  POST /api/v1/watchlists/seed — seed the owner's default list from a legacy
//  symbol array (the old localStorage `watchlist` blob, S8 migration).
//
//  Idempotent: when the default list already exists it merges the seeds in
//  without dropping tracked symbols. 400 on bad input, 503 when the store is
//  down. This is the single migration entry point — the trading panel calls it
//  once on first load from the served plane symbols.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw watchlistsHttpError(new Error('body must be an object'))
  }
  const symbols = Array.isArray(body.symbols) ? body.symbols : []
  try {
    const data = await seedDefaultWatchlist(requireOwnerId(event), symbols)
    return { success: true, data }
  } catch (err) {
    throw watchlistsHttpError(err)
  }
})