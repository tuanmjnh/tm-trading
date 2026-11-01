import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOCK_SKEW_MS,
  FRESHNESS_THRESHOLDS_MS,
  freshnessOf,
  freshnessOfValue,
  isLive,
  numericOrNull,
  observationAgeMs,
  worstFreshness,
} from '#server/utils/provenance'
import type { DataProvenance, FreshnessState, ProvenancedValue } from '#shared/types/provenance'

// =============================================================================
//  V4.2 §4.2 data freshness contract.
//
//  The three rules this suite exists to protect:
//    1. stale data can never render as live;
//    2. a missing metric is never coerced to 0;
//    3. an unusable timestamp is UNKNOWN, never FRESH.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function prov(overrides: Partial<DataProvenance> = {}): DataProvenance {
  return {
    source: 'test',
    eventTime: NOW,
    ingestTime: NOW,
    asOf: NOW,
    quality: 'valid',
    ...overrides,
  }
}

const ALL_STATES: FreshnessState[] = ['FRESH', 'DELAYED', 'STALE', 'MISSING', 'UNKNOWN']

describe('freshnessOf — producer-declared quality', () => {
  test('no provenance is MISSING, never FRESH', () => {
    assert.equal(freshnessOf(null, { now: NOW }), 'MISSING')
    assert.equal(freshnessOf(undefined, { now: NOW }), 'MISSING')
  })

  test('quality unavailable is MISSING even with a current timestamp', () => {
    assert.equal(freshnessOf(prov({ quality: 'unavailable' }), { now: NOW }), 'MISSING')
  })

  test('quality stale is STALE even when the timestamp is now', () => {
    assert.equal(freshnessOf(prov({ quality: 'stale' }), { now: NOW }), 'STALE')
  })

  test('quality gap is never live', () => {
    const state = freshnessOf(prov({ quality: 'gap' }), { now: NOW })
    assert.equal(state, 'STALE')
    assert.equal(isLive(state), false)
  })

  test('quality delayed is capped at DELAYED even at age 0', () => {
    assert.equal(freshnessOf(prov({ quality: 'delayed' }), { now: NOW }), 'DELAYED')
  })

  test('quality estimated is never FRESH', () => {
    const state = freshnessOf(prov({ quality: 'estimated' }), { now: NOW })
    assert.equal(state, 'DELAYED')
    assert.equal(isLive(state), false)
  })

  test('quality valid at age 0 is FRESH', () => {
    assert.equal(freshnessOf(prov(), { now: NOW }), 'FRESH')
  })
})

describe('freshnessOf — age thresholds', () => {
  test('exactly at the threshold is still FRESH', () => {
    const p = prov({ asOf: NOW - FRESHNESS_THRESHOLDS_MS.quote })
    assert.equal(freshnessOf(p, { now: NOW }), 'FRESH')
  })

  test('one millisecond past the threshold is DELAYED', () => {
    const p = prov({ asOf: NOW - FRESHNESS_THRESHOLDS_MS.quote - 1 })
    assert.equal(freshnessOf(p, { now: NOW }), 'DELAYED')
  })

  test('exactly at 2x the threshold is still DELAYED', () => {
    const p = prov({ asOf: NOW - 2 * FRESHNESS_THRESHOLDS_MS.quote })
    assert.equal(freshnessOf(p, { now: NOW }), 'DELAYED')
  })

  test('past 2x the threshold is STALE', () => {
    const p = prov({ asOf: NOW - 2 * FRESHNESS_THRESHOLDS_MS.quote - 1 })
    assert.equal(freshnessOf(p, { now: NOW }), 'STALE')
  })

  test('an old observation is never reported as live', () => {
    const p = prov({ asOf: NOW - 60 * 60 * 1000 })
    const state = freshnessOf(p, { now: NOW })
    assert.equal(state, 'STALE')
    assert.equal(isLive(state), false)
  })

  test('kind selects the matching threshold', () => {
    const age = 5 * 60 * 1000 // 5 minutes
    const p = prov({ asOf: NOW - age })
    assert.equal(freshnessOf(p, { now: NOW, kind: 'quote' }), 'STALE')
    assert.equal(freshnessOf(p, { now: NOW, kind: 'funding' }), 'FRESH')
  })

  test('explicit maxAgeMs wins over kind', () => {
    const p = prov({ asOf: NOW - 60 * 60 * 1000 })
    assert.equal(freshnessOf(p, { now: NOW, kind: 'funding' }), 'STALE')
    assert.equal(freshnessOf(p, { now: NOW, kind: 'funding', maxAgeMs: 2 * 60 * 60 * 1000 }), 'FRESH')
  })

  test('an invalid threshold is UNKNOWN, not a guess', () => {
    assert.equal(freshnessOf(prov(), { now: NOW, maxAgeMs: 0 }), 'UNKNOWN')
    assert.equal(freshnessOf(prov(), { now: NOW, maxAgeMs: Number.NaN }), 'UNKNOWN')
  })
})

describe('freshnessOf — timestamp integrity', () => {
  test('a missing asOf is UNKNOWN', () => {
    const p = prov()
    // Simulate a payload that never carried the field.
    delete (p as { asOf?: number }).asOf
    assert.equal(freshnessOf(p, { now: NOW }), 'UNKNOWN')
  })

  test('a non-finite asOf is UNKNOWN', () => {
    assert.equal(freshnessOf(prov({ asOf: Number.NaN }), { now: NOW }), 'UNKNOWN')
    assert.equal(freshnessOf(prov({ asOf: Number.POSITIVE_INFINITY }), { now: NOW }), 'UNKNOWN')
  })

  test('a timestamp in the future beyond skew is UNKNOWN', () => {
    const p = prov({ asOf: NOW + CLOCK_SKEW_MS + 1 })
    assert.equal(freshnessOf(p, { now: NOW }), 'UNKNOWN')
  })

  test('a timestamp inside the clock-skew tolerance is FRESH', () => {
    const p = prov({ asOf: NOW + CLOCK_SKEW_MS })
    assert.equal(freshnessOf(p, { now: NOW }), 'FRESH')
  })

  test('an invalid now is UNKNOWN', () => {
    assert.equal(freshnessOf(prov(), { now: Number.NaN }), 'UNKNOWN')
  })
})

describe('numericOrNull — missing is not zero', () => {
  test('absent and blank inputs yield null', () => {
    for (const value of [null, undefined, '', '   ', Number.NaN, Number.POSITIVE_INFINITY, true, false, {}, [], () => 1]) {
      assert.equal(numericOrNull(value), null)
    }
  })

  test('a real zero survives as zero', () => {
    assert.equal(numericOrNull(0), 0)
    assert.equal(numericOrNull('0'), 0)
    assert.equal(numericOrNull(-0), -0)
  })

  test('numeric strings are parsed', () => {
    assert.equal(numericOrNull('1.5'), 1.5)
    assert.equal(numericOrNull(' -2 '), -2)
    assert.equal(numericOrNull('1e3'), 1000)
  })

  test('a non-numeric string is null, not 0', () => {
    assert.equal(numericOrNull('n/a'), null)
    assert.equal(numericOrNull('--'), null)
  })
})

describe('freshnessOfValue — absent metrics', () => {
  test('no observation is MISSING', () => {
    assert.equal(freshnessOfValue(null, { now: NOW }), 'MISSING')
    assert.equal(freshnessOfValue(undefined, { now: NOW }), 'MISSING')
  })

  test('a null value is MISSING even when provenance exists', () => {
    const observed: ProvenancedValue<number> = { value: null, provenance: prov() }
    assert.equal(freshnessOfValue(observed, { now: NOW }), 'MISSING')
  })

  test('a present value without provenance is UNKNOWN, never FRESH', () => {
    const observed: ProvenancedValue<number> = { value: 42, provenance: null }
    const state = freshnessOfValue(observed, { now: NOW })
    assert.equal(state, 'UNKNOWN')
    assert.equal(isLive(state), false)
  })

  test('a real zero with valid provenance is FRESH (zero is data)', () => {
    const observed: ProvenancedValue<number> = { value: 0, provenance: prov() }
    assert.equal(freshnessOfValue(observed, { now: NOW }), 'FRESH')
  })

  test('an old value is STALE regardless of the number', () => {
    const observed: ProvenancedValue<number> = { value: 0, provenance: prov({ asOf: NOW - 3600_000 }) }
    assert.equal(freshnessOfValue(observed, { now: NOW }), 'STALE')
  })
})

describe('isLive — only FRESH is live', () => {
  test('exactly one state is live', () => {
    const live = ALL_STATES.filter(isLive)
    assert.deepEqual(live, ['FRESH'])
  })

  test('every non-FRESH state is not live', () => {
    for (const state of ALL_STATES.filter(s => s !== 'FRESH')) {
      assert.equal(isLive(state), false, `${state} must not be live`)
    }
  })
})

describe('observationAgeMs', () => {
  test('returns the age for a usable timestamp', () => {
    assert.equal(observationAgeMs(prov({ asOf: NOW - 1234 }), NOW), 1234)
  })

  test('returns null when the timestamp is unusable', () => {
    assert.equal(observationAgeMs(null, NOW), null)
    assert.equal(observationAgeMs(prov({ asOf: Number.NaN }), NOW), null)
  })

  test('returns null when now is unusable', () => {
    assert.equal(observationAgeMs(prov(), Number.NaN), null)
  })
})

describe('worstFreshness — section summary', () => {
  test('an empty set is UNKNOWN, never FRESH', () => {
    assert.equal(worstFreshness([]), 'UNKNOWN')
  })

  test('all fresh stays fresh', () => {
    assert.equal(worstFreshness(['FRESH', 'FRESH']), 'FRESH')
  })

  test('stale outranks missing because stale looks real', () => {
    assert.equal(worstFreshness(['MISSING', 'STALE']), 'STALE')
    assert.equal(worstFreshness(['STALE', 'MISSING']), 'STALE')
  })

  test('missing outranks delayed', () => {
    assert.equal(worstFreshness(['DELAYED', 'MISSING']), 'MISSING')
  })

  test('unknown outranks delayed', () => {
    assert.equal(worstFreshness(['DELAYED', 'UNKNOWN']), 'UNKNOWN')
  })
})
