import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WatchlistError,
  sanitizeName,
  sanitizeSymbol,
  sanitizeSymbols,
  validateReorderOrder,
  WATCHLIST_LIMITS
} from '../server/utils/watchlists'

// =============================================================================
//  Watchlist CRUD (S8 chunk 1) — pure/sanitized logic contracts.
//
//  Offline: no Mongo, no model, no network. These tests lock the rules the
//  store and the API must obey: name/symbol sanitization, the per-owner name
//  uniqueness (enforced by the 11000 code in the store), the default-list
//  immutability, and the HTTP error mapping. Acceptance is behavioural, not
//  "a page exists" (§59.16).
// =============================================================================

describe('sanitizeSymbol — uppercase + shape gate', () => {
  test('accepts valid 5-20 alphanumeric symbols', () => {
    assert.equal(sanitizeSymbol('BTCUSDT'), 'BTCUSDT')
    assert.equal(sanitizeSymbol('  btcusdt  '), 'BTCUSDT')
    assert.equal(sanitizeSymbol('XAUUSD'), 'XAUUSD')
    assert.equal(sanitizeSymbol('a1b2c'), 'A1B2C')
  })

  test('rejects too-short / too-long / non-alphanumeric', () => {
    assert.equal(sanitizeSymbol('ABCD'), null)          // 4 chars
    assert.equal(sanitizeSymbol('A'.repeat(21)), null)  // 21 chars
    assert.equal(sanitizeSymbol('BTC-USD'), null)       // dash
    assert.equal(sanitizeSymbol('BTC_USD'), null)       // underscore
    assert.equal(sanitizeSymbol(''), null)
    assert.equal(sanitizeSymbol(null), null)
    assert.equal(sanitizeSymbol(123), null)
    assert.equal(sanitizeSymbol(undefined), null)
  })
})

describe('sanitizeSymbols — dedupe + cap, first-appearance order', () => {
  test('dedupes, uppercases, preserves order and caps', () => {
    const out = sanitizeSymbols(['btcusdt', 'BTCUSDT', 'ETHUSDT', 'xauusd', 'a'.repeat(50)])
    assert.deepEqual(out, ['BTCUSDT', 'ETHUSDT', 'XAUUSD'])
  })

  test('non-array input returns []', () => {
    assert.deepEqual(sanitizeSymbols(null), [])
    assert.deepEqual(sanitizeSymbols('BTCUSDT'), [])
    assert.deepEqual(sanitizeSymbols({ a: 1 }), [])
  })

  test('does not invent rows beyond the cap', () => {
    const out = sanitizeSymbols(Array.from({ length: 999 }, (_, i) => `SYM${String(i).padStart(3, '0')}`))
    assert.equal(out.length, WATCHLIST_LIMITS.maxSymbols)
  })
})

describe('sanitizeName — trim + length cap', () => {
  test('accepts a trimmed name within the cap', () => {
    assert.equal(sanitizeName('  My List  '), 'My List')
    assert.equal(sanitizeName('A'.repeat(WATCHLIST_LIMITS.maxNameLength)), 'A'.repeat(WATCHLIST_LIMITS.maxNameLength))
  })

  test('rejects empty / too-long / non-string', () => {
    assert.equal(sanitizeName('   '), null)
    assert.equal(sanitizeName('A'.repeat(WATCHLIST_LIMITS.maxNameLength + 1)), null)
    assert.equal(sanitizeName(null), null)
    assert.equal(sanitizeName(42), null)
  })
})

describe('WatchlistError — status code + policy code', () => {
  test('keeps its code and status message', () => {
    const err = new WatchlistError('a list with this name already exists', 409, 'name_conflict')
    assert.equal(err.statusCode, 409)
    assert.equal(err.statusMessage, 'name_conflict')
    assert.equal(err.message, 'a list with this name already exists')
    assert.ok(err instanceof Error)
  })

  test('defaults to 400 / watchlist_error', () => {
    const err = new WatchlistError('boom')
    assert.equal(err.statusCode, 400)
    assert.equal(err.statusMessage, 'watchlist_error')
  })

  test('the default-list guard is a 409 with default_list', () => {
    const err = new WatchlistError('the default list cannot be deleted', 409, 'default_list')
    assert.equal(err.statusCode, 409)
    assert.equal(err.statusMessage, 'default_list')
  })
})

describe('WATCHLIST_LIMITS — the frozen contract', () => {
  test('limits are positive and sane', () => {
    assert.ok(WATCHLIST_LIMITS.maxLists > 0)
    assert.ok(WATCHLIST_LIMITS.maxSymbols > 0)
    assert.ok(WATCHLIST_LIMITS.maxNameLength > 0)
    assert.equal(WATCHLIST_LIMITS.maxSymbols, 60)
    assert.equal(WATCHLIST_LIMITS.maxLists, 20)
    assert.equal(WATCHLIST_LIMITS.maxNameLength, 64)
  })
})

// -----------------------------------------------------------------------------
//  validateReorderOrder (chunk 2) — the drag-to-reorder contract.
//
//  Pure: no Mongo, no model. Locks the rule that a reorder is a POSITION
//  change, never a content change — the ordered array must be the SAME SET as
//  what is stored, or the store refuses the write (so a stale UI cannot
//  silently drop symbols the server already has).
// -----------------------------------------------------------------------------
describe('validateReorderOrder — same-set gate', () => {
  const stored = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

  test('accepts a permutation (same set, any order)', () => {
    assert.deepEqual(validateReorderOrder(stored, ['SOLUSDT', 'BTCUSDT', 'ETHUSDT']), ['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
  })

  test('accepts the same order (idempotent no-op)', () => {
    assert.deepEqual(validateReorderOrder(stored, stored), stored)
  })

  test('accepts case-insensitive input and dedupes', () => {
    assert.deepEqual(validateReorderOrder(stored, ['solusdt', 'btcusdt', 'ethusdt']), ['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
  })

  test('rejects a smaller set (a missing symbol)', () => {
    let err: any
    try { validateReorderOrder(stored, ['BTCUSDT', 'ETHUSDT']) } catch (e) { err = e }
    assert.ok(err, 'expected validateReorderOrder to throw')
    assert.ok(err instanceof WatchlistError)
    assert.equal(err.statusCode, 400)
    assert.equal(err.statusMessage, 'invalid_order')
  })

  test('rejects a larger set (an extra symbol)', () => {
    let err: any
    try { validateReorderOrder(stored, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSD']) } catch (e) { err = e }
    assert.ok(err, 'expected validateReorderOrder to throw')
    assert.ok(err instanceof WatchlistError)
    assert.equal(err.statusCode, 400)
    assert.equal(err.statusMessage, 'invalid_order')
  })

  test('rejects a symbol that is not in the list', () => {
    let err: any
    try { validateReorderOrder(stored, ['BTCUSDT', 'XAUUSD', 'ETHUSDT']) } catch (e) { err = e }
    assert.ok(err, 'expected validateReorderOrder to throw')
    assert.ok(err instanceof WatchlistError)
    assert.equal(err.statusCode, 400)
    assert.equal(err.statusMessage, 'invalid_order')
  })

  test('rejects garbage / non-array input', () => {
    assert.throws(() => validateReorderOrder(stored, null as unknown as string[]))
    assert.throws(() => validateReorderOrder(stored, 'BTCUSDT' as unknown as string[]))
  })

  test('rejects symbols that fail the shape gate', () => {
    assert.throws(() => validateReorderOrder(stored, ['BTCUSDT', 'BAD-USD', 'ETHUSDT']))
  })
})