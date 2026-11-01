import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALERT_CATEGORIES,
  POLICY_VERSION,
  applyPolicyState,
  categoryForEvent,
  categorySettings,
  evaluatePolicy,
  inQuietWindow,
  localMinutes,
  meetsFloor,
  normaliseSettings,
  parseHhMm,
  quietWindowEnd,
  symbolInScope,
} from '../notify/policy.mjs'

// =============================================================================
//  §7.2 user controls. Every control must produce a DISTINCT reason: a user has
//  to be able to tell "I turned this off" from "the pipeline is broken", and a
//  risk halt has to survive quiet hours.
// =============================================================================

const AT = Date.UTC(2026, 10, 1, 12, 0, 0) // 12:00 UTC

describe('notify policy — defaults and helpers', () => {
  test('the §7.1 category list is complete and stable', () => {
    assert.equal(ALERT_CATEGORIES.length, 10)
    for (const id of ['volatility', 'funding', 'openInterest', 'signal', 'onchain', 'liquidation']) {
      assert.ok(ALERT_CATEGORIES.includes(id), `${id} missing`)
    }
    assert.equal(POLICY_VERSION, 'notify-policy.v1')
  })

  test('priority ladder is inclusive and refuses unknown values', () => {
    assert.equal(meetsFloor('critical', 'critical'), true)
    assert.equal(meetsFloor('important', 'normal'), true)
    assert.equal(meetsFloor('info', 'normal'), false)
    assert.equal(meetsFloor('urgent', 'critical'), false)
  })

  test('wall-clock parsing and local minutes', () => {
    assert.equal(parseHhMm('22:30'), 1350)
    assert.equal(parseHhMm('07:00'), 420)
    assert.equal(parseHhMm('24:00'), null)
    assert.equal(parseHhMm('7:5'), null)
    assert.equal(localMinutes(AT, 0), 12 * 60)
    assert.equal(localMinutes(AT, 420), (12 * 60 + 420) % 1440) // UTC+7 -> 19:00
    assert.equal(localMinutes(AT, -12 * 60), 0)
  })

  test('quiet window handles wrapping and empty windows', () => {
    assert.equal(inQuietWindow(23 * 60, 22 * 60, 7 * 60), true)
    assert.equal(inQuietWindow(3 * 60, 22 * 60, 7 * 60), true)
    assert.equal(inQuietWindow(12 * 60, 22 * 60, 7 * 60), false)
    assert.equal(inQuietWindow(420, 420, 420), false, 'start === end is empty, not always-on')
    assert.equal(inQuietWindow(13 * 60, 12 * 60, 14 * 60), true)
  })

  test('quiet window end is strictly in the future', () => {
    // 23:00 UTC inside a 22:00-07:00 window -> ends 07:00 the next day.
    const at = Date.UTC(2026, 10, 1, 23, 0, 0)
    const end = quietWindowEnd(at, { endMin: 7 * 60, tzOffsetMin: 0 })
    assert.equal(end - at, 8 * 3600 * 1000)
    // 03:00 -> ends the same morning.
    const at2 = Date.UTC(2026, 10, 1, 3, 0, 0)
    assert.equal(quietWindowEnd(at2, { endMin: 7 * 60, tzOffsetMin: 0 }) - at2, 4 * 3600 * 1000)
  })

  test('normaliseSettings fills defaults, clamps unknown modes and counts', () => {
    const cfg = normaliseSettings({ symbols: { mode: 'nonsense' }, maxPerWindow: { count: -5 } })
    assert.equal(cfg.symbols.mode, 'all')
    assert.equal(cfg.maxPerWindow.count, 0)
    assert.equal(cfg.quietHours.bypassAtOrAbove, 'critical')
    assert.equal(cfg.quietHours.enabled, false)
    // Overrides merge per category, leaving the others at their defaults.
    const cats = categorySettings({ categories: { funding: { enabled: false } } }, 'funding')
    assert.equal(cats.enabled, false)
    assert.equal(cats.instant, true)
  })
})

describe('notify policy — event to category mapping', () => {
  test('presets/names win; kind is the fallback', () => {
    assert.equal(categoryForEvent({ preset: 'risk.halted' }), 'signal')
    assert.equal(categoryForEvent({ name: 'funding.extreme' }), 'funding')
    assert.equal(categoryForEvent({ name: 'liquidation.burst' }), 'liquidation')
    assert.equal(categoryForEvent({ name: 'oi.divergence' }), 'openInterest')
    assert.equal(categoryForEvent({ name: 'weekly.recap' }), 'digest')
    assert.equal(categoryForEvent({ kind: 'market' }), 'volatility')
    assert.equal(categoryForEvent({ kind: 'signal' }), 'signal')
    assert.equal(categoryForEvent({}), 'news')
  })
})

describe('notify policy — evaluatePolicy', () => {
  const base = { event: { name: 'funding.extreme' }, at: AT }
  const allow = (input) => evaluatePolicy({ ...base, settings: {}, ...input })

  test('a plain event in an instant, enabled category is allowed', () => {
    const d = allow({})
    assert.equal(d.allow, true)
    assert.equal(d.reason, 'allowed')
    assert.equal(d.category, 'funding')
    assert.equal(d.cooldownKey, 'funding:*')
  })

  test('per-category disable is reported by name', () => {
    const d = allow({ settings: { categories: { funding: { enabled: false } } } })
    assert.equal(d.allow, false)
    assert.equal(d.reason, 'category-disabled')
  })

  test('symbol scope: include list and exclude list', () => {
    assert.equal(allow({ symbol: 'ETHUSDT', settings: { symbols: { mode: 'include', include: ['BTCUSDT'] } } }).reason, 'symbol-out-of-scope')
    assert.equal(allow({ symbol: 'btcusdt', settings: { symbols: { mode: 'include', include: ['BTCUSDT'] } } }).allow, true)
    assert.equal(allow({ symbol: 'BTCUSDT', settings: { symbols: { mode: 'exclude', exclude: ['BTCUSDT'] } } }).reason, 'symbol-out-of-scope')
    // A blank symbol is account-wide and always in scope for 'all'.
    assert.equal(allow({ symbol: '', settings: { symbols: { mode: 'include', include: ['BTCUSDT'] } } }).allow, true)
  })

  test('severity floor is per category', () => {
    const d = allow({ settings: { categories: { funding: { minPriority: 'important' } } }, priority: 'normal' })
    assert.equal(d.allow, false)
    assert.match(d.reason, /^below-severity-floor:important$/)
    const ok = allow({ settings: { categories: { funding: { minPriority: 'important' } } }, priority: 'important' })
    assert.equal(ok.allow, true)
  })

  test('quiet hours silence normal traffic and defer it to the window end', () => {
    const at = Date.UTC(2026, 10, 1, 23, 0, 0)
    const d = evaluatePolicy({
      event: { name: 'funding.extreme' },
      at,
      priority: 'important',
      settings: { quietHours: { enabled: true, startMin: 22 * 60, endMin: 7 * 60 } },
    })
    assert.equal(d.allow, false)
    assert.equal(d.reason, 'quiet-hours')
    assert.equal(d.deferUntil - at, 8 * 3600 * 1000)
  })

  test('a critical halt bypasses quiet hours (never silenced)', () => {
    const at = Date.UTC(2026, 10, 1, 23, 0, 0)
    const d = evaluatePolicy({
      event: { preset: 'risk.halted' },
      at,
      priority: 'critical',
      settings: { quietHours: { enabled: true, startMin: 22 * 60, endMin: 7 * 60 } },
    })
    assert.equal(d.allow, true)
  })

  test('quiet hours respect the recipient timezone', () => {
    // 12:00 UTC == 19:00 UTC+7 (not quiet) == 23:00 in a +12 window? Use -12 -> 00:00.
    const settings = { quietHours: { enabled: true, startMin: 22 * 60, endMin: 7 * 60, tzOffsetMin: -12 * 60 } }
    assert.equal(evaluatePolicy({ event: { name: 'funding.x' }, at: AT, settings }).reason, 'quiet-hours')
    const settings2 = { quietHours: { enabled: true, startMin: 22 * 60, endMin: 7 * 60, tzOffsetMin: 7 * 60 } }
    assert.equal(evaluatePolicy({ event: { name: 'funding.x' }, at: AT, settings: settings2 }).allow, true)
  })

  test('cooldown suppresses a repeat within the window and clears after', () => {
    const settings = { cooldownMs: 15 * 60 * 1000 }
    const state = { lastSentAt: { 'funding:BTCUSDT': AT - 5 * 60 * 1000 } }
    const d = evaluatePolicy({ event: { name: 'funding.x' }, symbol: 'BTCUSDT', at: AT, settings, state })
    assert.equal(d.reason, 'cooldown')
    assert.equal(d.deferUntil, AT - 5 * 60 * 1000 + 15 * 60 * 1000)
    const clear = evaluatePolicy({
      event: { name: 'funding.x' },
      symbol: 'BTCUSDT',
      at: AT,
      settings,
      state: { lastSentAt: { 'funding:BTCUSDT': AT - 20 * 60 * 1000 } },
    })
    assert.equal(clear.allow, true)
  })

  test('the rolling window cap reports the reset time', () => {
    const settings = { maxPerWindow: { count: 2, windowMs: 3600_000 } }
    const state = { window: { count: 2, startAt: AT - 10 * 60_000 } }
    const d = evaluatePolicy({ event: { name: 'funding.x' }, at: AT, settings, state })
    assert.equal(d.reason, 'rate-limited')
    assert.equal(d.deferUntil, AT - 10 * 60_000 + 3600_000)
    // A stale window resets the count.
    const reset = evaluatePolicy({
      event: { name: 'funding.x' },
      at: AT,
      settings,
      state: { window: { count: 2, startAt: AT - 2 * 3600_000 } },
    })
    assert.equal(reset.allow, true)
  })

  test('a non-instant category is aggregated, not dropped', () => {
    const d = allow({ settings: { categories: { funding: { instant: false } } } })
    assert.equal(d.allow, false)
    assert.equal(d.reason, 'digest-only')
    assert.equal(d.digest, true)
  })

  test('applyPolicyState records the cooldown and advances the window', () => {
    const decision = evaluatePolicy({ event: { name: 'funding.x' }, at: AT, settings: {} })
    const s1 = applyPolicyState({ state: {}, decision, at: AT })
    assert.equal(s1.lastSentAt['funding:*'], AT)
    assert.deepEqual(s1.window, { count: 1, startAt: AT })
    const s2 = applyPolicyState({ state: s1, decision, at: AT + 60_000 })
    assert.equal(s2.window.count, 2)
    assert.equal(s2.window.startAt, AT)
  })
})
