// =============================================================================
//  Hub 429 budget (F2/U1) — honoring Retry-After and surviving a hard reload.
//
//  All offline: the helpers take an injectable `now`, and `sessionStorage` is
//  stubbed so the "back-off survives a reload" behaviour is provable in Node
//  (where the real Web Storage API is absent unless a flag is passed).
// =============================================================================

import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearHubRateLimit,
  hubRateLimitRemainingMs,
  noteHubRateLimit,
  parseRetryAfterMs,
} from '../app/utils/hub'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  get length() { return this.map.size }
}

const T0 = 1_700_000_000_000

function withStorage(): MemoryStorage {
  const store = new MemoryStorage()
  ;(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = store as unknown as Storage
  return store
}

afterEach(() => {
  delete (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage
})

describe('parseRetryAfterMs', () => {
  test('delay-seconds form', () => {
    assert.equal(parseRetryAfterMs('5'), 5_000)
    assert.equal(parseRetryAfterMs('0'), 0)
  })

  test('HTTP-date form is relative to now', () => {
    const now = T0
    const date = new Date(now + 12_000).toUTCString()
    assert.equal(parseRetryAfterMs(date, now), 12_000)
  })

  test('a past HTTP-date clamps to 0, junk and negatives are null', () => {
    assert.equal(parseRetryAfterMs(new Date(T0 - 1_000).toUTCString(), T0), 0)
    assert.equal(parseRetryAfterMs('later'), null)
    assert.equal(parseRetryAfterMs('-5'), null)
    assert.equal(parseRetryAfterMs(null), null)
    assert.equal(parseRetryAfterMs(''), null)
  })
})

describe('hub rate-limit window', () => {
  test('recording a 429 opens a window that survives a new module read', () => {
    withStorage()
    const ms = noteHubRateLimit('20', T0)
    assert.equal(ms, 20_000)
    assert.equal(hubRateLimitRemainingMs(T0), 20_000)
    assert.equal(hubRateLimitRemainingMs(T0 + 5_000), 15_000)
    assert.equal(hubRateLimitRemainingMs(T0 + 25_000), 0, 'window closes on schedule')
  })

  test('a missing Retry-After falls back, and an absurd value is capped', () => {
    withStorage()
    assert.equal(noteHubRateLimit(null, T0), 30_000)
    assert.equal(noteHubRateLimit('100000', T0), 5 * 60_000)
    clearHubRateLimit()
    assert.equal(hubRateLimitRemainingMs(T0), 0)
  })

  test('no sessionStorage (server / Node) is a safe no-op', () => {
    assert.equal(hubRateLimitRemainingMs(T0), 0)
    assert.equal(noteHubRateLimit('10', T0), 10_000, 'duration is still reported')
    assert.equal(hubRateLimitRemainingMs(T0), 0)
    clearHubRateLimit()
  })
})
