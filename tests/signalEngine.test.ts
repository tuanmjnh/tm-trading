import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { generateSignals, signalEngineFingerprint, SIGNAL_ENGINE_VERSION, EVENT_DIRECTION } from '../engine/signalEngine.mjs'

// =============================================================================
//  Native signal generator (roadmap §61.17 Phase D).
//
//  generateSignals() must turn a bar series into attributed, deterministic
//  signals using the same method contract as the backtester. Same bars -> same
//  events -> same docs (so the store can dedupe with $setOnInsert).
// =============================================================================

// Nondeterministic VSA math is neutralised with explicit loose thresholds so the
// controlled SV -> ST LONG path is the only thing under test here.
const LOOSE = { len: 5, pivLen: 3, lvFresh: 1000, lvTol: 1000, retestT: 1000, run: 5, atrLen: 5, entryMode: 'limit', tpMode: 'pivot' }

function mkBars(closes, volumes, wick = 0.5, baseTime = Date.UTC(2026, 0, 5, 0, 0, 0)) {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    const up = c >= o
    return { time: baseTime + i * 300000, open: o, high: up ? c + wick : o, low: up ? o : c - wick, close: c, volume: volumes[i] ?? 100 }
  })
}

function svBars() {
  const closes = []
  for (let i = 0; i < 16; i++) closes.push(110 - i)
  for (const c of [97, 99, 98.5, 97.8, 97.2, 96.4, 96.5, 96.8]) closes.push(c)
  const volumes = new Array(closes.length).fill(100)
  volumes[22] = 600
  return mkBars(closes, volumes)
}

const stub = {
  id: 'stub',
  name: 'Stub',
  defaults: {},
  analyze: (bars) => ({ events: [{ bar: 1, type: 'BC' }], scores: new Array(bars.length).fill(0), setups: [] }),
}

describe('generateSignals', () => {
  test('maps a controlled VSA fixture to attributed signals deterministically', () => {
    const bars = svBars()
    const a = generateSignals({ bars, method: 'vsa', params: LOOSE, symbol: 'XAUUSD', tf: '5m', ownerId: 'owner-alice' })
    assert.deepEqual(a.map((s) => s.type), ['SV', 'ST LONG'])
    assert.equal(a[0].meta.bar, 22)
    assert.equal(a[0].ts.getTime(), bars[22].time)
    assert.equal(a[1].meta.bar, 23)
    // Position plan is carried through when the method produced one.
    assert.equal(a[1].meta.dir, EVENT_DIRECTION['ST LONG'])
    assert.equal(typeof a[1].meta.entry, 'number')
    assert.equal(typeof a[1].meta.sl, 'number')
    assert.equal(typeof a[1].meta.tp, 'number')
    // Full traceability.
    assert.equal(a[0].attribution.method, 'vsa')
    assert.equal(a[0].attribution.methodVersion, '1')
    assert.equal(a[0].attribution.strategyVersion, 'vsa@1')
    assert.match(a[0].attribution.paramsHash, /^[0-9a-f]{64}$/)
    assert.equal(a[0].schemaVersion, '1')
  })

  test('is byte-identical on a second run (duplicate events do not duplicate the signal)', () => {
    const bars = svBars()
    const opts = { bars, method: 'vsa', params: LOOSE, symbol: 'XAUUSD', tf: '5m', ownerId: 'owner-alice' }
    assert.deepEqual(generateSignals(opts), generateSignals(opts))
  })

  test('owner scoping changes the key', () => {
    const bars = svBars()
    const base = { bars, method: 'vsa', params: LOOSE, symbol: 'XAUUSD', tf: '5m' }
    const withOwner = generateSignals({ ...base, ownerId: 'owner-alice' })
    const noOwner = generateSignals(base)
    assert.notEqual(withOwner[0].signalKey, noOwner[0].signalKey)
  })

  test('supports an explicit strategy/engine version and indicator refs', () => {
    const bars = svBars()
    const [s] = generateSignals({
      bars,
      method: 'vsa',
      params: LOOSE,
      symbol: 'XAUUSD',
      tf: '5m',
      strategyVersion: 'lab@7',
      engineVersion: '9.9.9',
      indicatorRefs: [{ id: 'atr', version: '1' }],
    })
    assert.equal(s.attribution.strategyVersion, 'lab@7')
    assert.equal(s.attribution.engineVersion, '9.9.9')
    assert.deepEqual(s.attribution.indicatorRefs, [{ id: 'atr', version: '1' }])
  })

  test('is method-agnostic (works with an inline plugin)', () => {
    const bars = mkBars([10, 11, 12], [])
    const out = generateSignals({ bars, method: stub, symbol: 'SYN', tf: '1m' })
    assert.equal(out.length, 1)
    assert.equal(out[0].type, 'BC')
    assert.equal(out[0].attribution.method, 'stub')
    assert.equal(out[0].attribution.strategyVersion, 'stub@1')
  })

  test('fails loudly on bad input', () => {
    assert.throws(() => generateSignals({ bars: [], method: 'vsa', symbol: 'X', tf: '1m' }), /bars must be/)
    assert.throws(() => generateSignals({ bars: mkBars([1, 2], []), method: 'nope', symbol: 'X', tf: '1m' }), /method/i)
    const badMethod = { id: 'bad', name: 'Bad', defaults: {}, analyze: () => ({ events: [{ bar: 0, type: 'WAT' }], scores: [], setups: [] }) }
    assert.throws(() => generateSignals({ bars: mkBars([1], []), method: badMethod, symbol: 'X', tf: '1m' }), /invalid event type/)
    const incomplete = { id: 'inc', name: 'Inc', defaults: {}, analyze: () => ({ events: [] }) }
    assert.throws(() => generateSignals({ bars: mkBars([1], []), method: incomplete, symbol: 'X', tf: '1m' }), /missing field/)
  })
})

describe('signalEngineFingerprint', () => {
  test('is a stable versioned string', () => {
    assert.equal(SIGNAL_ENGINE_VERSION, '1')
    const fp = signalEngineFingerprint()
    assert.match(fp, /^sigfp_[0-9a-f]{16}$/)
    assert.equal(fp, signalEngineFingerprint())
  })
})
