import { createError } from 'h3'
import { watchlistsModel } from './engineModel'

// =============================================================================
//  Watchlists store (S8 chunk 1) — named, per-owner symbol lists.
//
//  Mirrors the aiAgents.ts pattern: reads are fail-soft (a down store returns
//  null/[] so the UI shows an empty state instead of a stack trace — D12),
//  writes THROW (a refused create/rename/delete must surface its code to the
//  operator; a silently lost list would lose the user's tracking).
//
//  Tenancy: every query is scoped by ownerId; the per-owner name index
//  (engine/models/watchlist.mjs) makes a duplicate name a 409, never a dup.
// =============================================================================

type AnyDoc = Record<string, any>

const MAX_LISTS_PER_OWNER = 20
const MAX_SYMBOLS_PER_LIST = 60
const MAX_NAME_LENGTH = 64
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/

/** Sanitize a raw symbol: uppercase + trim + shape check. Returns null if bad. */
export function sanitizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toUpperCase()
  return SYMBOL_RE.test(s) ? s : null
}

/**
 * Deduplicate + sanitize an untrusted symbol array, preserving first-appearance
 * order and dropping everything that does not match the symbol shape. Pure:
 * tested in tests/watchlists.test.ts without Mongo.
 */
export function sanitizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const s = sanitizeSymbol(item)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_SYMBOLS_PER_LIST) break
  }
  return out
}

/** Sanitize a list name: trim + length cap. Returns null when unusable. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > MAX_NAME_LENGTH) return null
  return s
}

export const WATCHLIST_LIMITS = {
  maxLists: MAX_LISTS_PER_OWNER,
  maxSymbols: MAX_SYMBOLS_PER_LIST,
  maxNameLength: MAX_NAME_LENGTH,
  symbolPattern: SYMBOL_RE
}

export class WatchlistError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'watchlist_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function watchlistsHttpError(err: unknown) {
  if (err instanceof WatchlistError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'watchlist_failed', message: e?.message || 'watchlist failed' })
}

/** All of the owner's lists, most recently updated first. Fail-soft -> []. */
export async function listWatchlists(ownerId: string): Promise<AnyDoc[]> {
  const Model = await watchlistsModel()
  if (!Model) return []
  try {
    return (await Model.find({ ownerId })
      .sort({ isDefault: -1, updatedAt: -1 })
      .limit(MAX_LISTS_PER_OWNER + 1)
      .lean()) as AnyDoc[]
  } catch {
    return []
  }
}

/** One of the owner's lists, or null (unknown id OR store down). */
export async function getWatchlist(id: string, ownerId: string): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) return null
  try {
    const found = await Model.findOne({ ownerId, _id: id }).lean()
    return (found ?? null) as AnyDoc | null
  } catch {
    return null
  }
}

/** The owner's default list (the trading panel reads this). Fail-soft -> null. */
export async function getDefaultWatchlist(ownerId: string): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) return null
  try {
    const found = await Model.findOne({ ownerId, isDefault: true }).sort({ updatedAt: -1 }).lean()
    return (found ?? null) as AnyDoc | null
  } catch {
    return null
  }
}

export interface CreateWatchlistInput {
  name?: string
  symbols?: string[]
}

export async function createWatchlist(ownerId: string, input: CreateWatchlistInput): Promise<AnyDoc> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const name = sanitizeName(input.name)
  if (!name) throw new WatchlistError('invalid list name', 400, 'invalid_name')
  const symbols = sanitizeSymbols(input.symbols)

  const existing = await listWatchlists(ownerId)
  if (existing.length >= MAX_LISTS_PER_OWNER) {
    throw new WatchlistError('list limit reached', 409, 'list_limit')
  }

  // First list ever becomes the default; there is exactly one default per owner.
  const isDefault = existing.length === 0

  let created: AnyDoc
  try {
    const doc = await Model.create({
      ownerId,
      name,
      symbols,
      isDefault
    })
    created = doc.toObject ? doc.toObject() : (doc as AnyDoc)
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) {
      throw new WatchlistError('a list with this name already exists', 409, 'name_conflict')
    }
    throw err
  }
  return created
}

export interface UpdateWatchlistInput {
  name?: string
  symbols?: string[]
}

export async function updateWatchlist(id: string, ownerId: string, patch: UpdateWatchlistInput): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const current = await getWatchlist(id, ownerId)
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const name = sanitizeName(patch.name)
    if (!name) throw new WatchlistError('invalid list name', 400, 'invalid_name')
    updates.name = name
  }
  if (patch.symbols !== undefined) {
    updates.symbols = sanitizeSymbols(patch.symbols)
  }
  if (!Object.keys(updates).length) return current

  try {
    const updated = await Model.findOneAndUpdate({ ownerId, _id: id }, { $set: updates }, { new: true }).lean()
    return (updated ?? null) as AnyDoc | null
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) {
      throw new WatchlistError('a list with this name already exists', 409, 'name_conflict')
    }
    throw err
  }
}

/**
 * Validate that `ordered` is a permutation of `stored` (same set, same size).
 * Returns the sanitized ordered array; throws WatchlistError(400, invalid_order)
 * on any mismatch. Pure: tested without Mongo in tests/watchlists.test.ts.
 */
export function validateReorderOrder(stored: readonly string[], ordered: readonly string[]): string[] {
  const sanitized = sanitizeSymbols(ordered)
  if (sanitized.length !== stored.length) {
    throw new WatchlistError(
      `order mismatch: expected ${stored.length} symbols, got ${sanitized.length}`,
      400,
      'invalid_order'
    )
  }
  const storedSet = new Set(stored)
  for (const s of sanitized) {
    if (!storedSet.has(s)) {
      throw new WatchlistError(`symbol ${s} is not in the list`, 400, 'invalid_order')
    }
  }
  return sanitized
}

/**
 * Reorder the symbols of one of the owner's lists in place. The caller sends
 * the full ordered array; the store validates that it is the SAME SET as what
 * is currently stored (no additions, no omissions) and only then writes it.
 * This keeps a stale UI from silently dropping symbols the server already has.
 *
 * Throws WatchlistError: 404 on unknown id, 503 on store down, 400 when the
 * ordered array is not a permutation of the stored set or the list is empty.
 * Idempotent: a no-op order returns the current doc without a write.
 */
export async function reorderSymbols(
  id: string,
  ownerId: string,
  orderedSymbols: readonly string[]
): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const current = await getWatchlist(id, ownerId)
  if (!current) throw new WatchlistError(`watchlist not found: ${id}`, 404, 'not_found')

  const stored = current.symbols ?? []
  if (stored.length === 0) throw new WatchlistError('cannot reorder an empty list', 400, 'empty_list')

  const sanitized = validateReorderOrder(stored, orderedSymbols)

  // Idempotent: same order, no write.
  if (sanitized.every((s, i) => stored[i] === s)) return current

  try {
    const updated = await Model.findOneAndUpdate(
      { ownerId, _id: id },
      { $set: { symbols: sanitized, order: sanitized.length - 1 } },
      { new: true }
    ).lean()
    return (updated ?? null) as AnyDoc | null
  } catch {
    throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')
  }
}

/**
 * Delete one of the owner's lists. The default list cannot be deleted (the
 * trading panel always needs a home list); it can be emptied and renamed.
 * Returns the deleted doc, or null when the id is unknown (store down too).
 */
export async function deleteWatchlist(id: string, ownerId: string): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const current = await getWatchlist(id, ownerId)
  if (!current) return null
  if (current.isDefault) throw new WatchlistError('the default list cannot be deleted', 409, 'default_list')

  try {
    const deleted = await Model.findOneAndDelete({ ownerId, _id: id }).lean()
    return (deleted ?? null) as AnyDoc | null
  } catch (err) {
    throw err
  }
}

/**
 * Set the owner's active default to this list (mutually exclusive with any
 * other default the owner has). Called from the Lists tab "switch" action.
 */
export async function setDefaultWatchlist(id: string, ownerId: string): Promise<AnyDoc> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const current = await getWatchlist(id, ownerId)
  if (!current) throw new WatchlistError(`watchlist not found: ${id}`, 404, 'not_found')

  await Model.updateMany({ ownerId, isDefault: true }, { $set: { isDefault: false } })
  const updated = await Model.findOneAndUpdate({ ownerId, _id: id }, { $set: { isDefault: true } }, { new: true }).lean()
  if (!updated) throw new WatchlistError(`watchlist not found: ${id}`, 404, 'not_found')
  return updated as AnyDoc
}

/**
 * Append one symbol to a list (idempotent, capped). Returns the updated doc,
 * or null when the id is unknown / store is down.
 */
export async function addSymbolToList(id: string, ownerId: string, symbol: string): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) return null
  const sym = sanitizeSymbol(symbol)
  if (!sym) return null
  try {
    const current = await getWatchlist(id, ownerId)
    if (!current) return null
    if ((current.symbols ?? []).includes(sym)) return current
    if ((current.symbols ?? []).length >= MAX_SYMBOLS_PER_LIST) {
      throw new WatchlistError('list is full', 409, 'list_full')
    }
    const updated = await Model.findOneAndUpdate(
      { ownerId, _id: id },
      { $addToSet: { symbols: sym } },
      { new: true }
    ).lean()
    return (updated ?? null) as AnyDoc | null
  } catch (err) {
    if (err instanceof WatchlistError) throw err
    return null
  }
}

/**
 * Remove one symbol from a list. Returns the updated doc, or null when the id
 * is unknown / store is down.
 */
export async function removeSymbolFromList(id: string, ownerId: string, symbol: string): Promise<AnyDoc | null> {
  const Model = await watchlistsModel()
  if (!Model) return null
  const sym = sanitizeSymbol(symbol)
  if (!sym) return null
  try {
    const updated = await Model.findOneAndUpdate(
      { ownerId, _id: id },
      { $pull: { symbols: sym } },
      { new: true }
    ).lean()
    return (updated ?? null) as AnyDoc | null
  } catch {
    return null
  }
}

/**
 * Seed the owner's default list with a legacy symbol array (the old
 * localStorage blob). Creates the default list when absent; when one exists,
 * merges the seeds in without dropping tracked symbols already in the list.
 * Returns the resulting default list.
 */
export async function seedDefaultWatchlist(ownerId: string, symbols: string[]): Promise<AnyDoc> {
  const Model = await watchlistsModel()
  if (!Model) throw new WatchlistError('watchlist store unavailable', 503, 'mongo_down')

  const existing = await getDefaultWatchlist(ownerId)
  if (existing) {
    const merged = sanitizeSymbols([...(existing.symbols ?? []), ...symbols])
    if (merged.length === (existing.symbols ?? []).length) return existing
    const updated = await Model.findOneAndUpdate(
      { ownerId, _id: existing._id },
      { $set: { symbols: merged } },
      { new: true }
    ).lean()
    return (updated ?? existing) as AnyDoc
  }

  try {
    const created = await createWatchlist(ownerId, { name: 'Default', symbols })
    return created
  } catch (err) {
    // The owner already has a list named "Default" (or hit the limit): fall
    // back to adopting their most recent list as the default and merging.
    if (err instanceof WatchlistError && err.statusMessage === 'name_conflict') {
      const all = await listWatchlists(ownerId)
      const first = all[0]
      if (!first) throw err
      const merged = sanitizeSymbols([...(first.symbols ?? []), ...symbols])
      const updated = await Model.findOneAndUpdate(
        { ownerId, _id: first._id },
        { $set: { isDefault: true, symbols: merged } },
        { new: true }
      ).lean()
      if (updated) return updated as AnyDoc
      throw err
    }
    throw err
  }
}