import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadIndicatorCatalog,
  loadIndicator,
  runIndicator,
  shapeIndicatorRun
} from '../server/utils/indicators'
import type { EngineBar } from '../server/utils/methods'

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)

/** 60 synthetic engine bars with an up-drift (time = epoch ms, UTC). */
const bars: EngineBar[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + i + (i % 7 === 0 ? -2 : 1)
  return {
    time: T0 + i * 60_000,
    open: close - 1,
    high: close + 2,
    low: close - 3,
    close,
    volume: 10 + (i % 5)
  }
})

describe('loadIndicatorCatalog (D1: engine is the single source)', () => {
  test('reflects the engine registry with meta + version stamps', async () => {
    const cat = await loadIndicatorCatalog()
    assert.ok(cat.length >= 13, `expected >= 13 indicators, got ${cat.length}`)
    const ids = new Set(cat.map((c) => c.id))
    assert.equal(ids.size, cat.length, 'duplicate ids')
    for (const def of cat) {
      assert.match(def.version, /^\d+$/, `${def.id}: version`)
      assert.ok(['overlay', 'pane', 'volume'].includes(def.kind), `${def.id}: kind`)
      assert.ok(def.outputs.length > 0, `${def.id}: outputs`)
      for (const [name, schema] of Object.entries(def.paramsSchema)) {
        assert.ok(schema.min <= schema.default && schema.default <= schema.max, `${def.id}.${name}`)
      }
    }
    assert.ok(cat.some((c) => c.id === 'sma'))
    assert.ok(cat.some((c) => c.id === 'donchian'))
  })

  test('single lookup returns the same meta', async () => {
    const def = await loadIndicator('rsi')
    assert.ok(def)
    assert.equal(def.id, 'rsi')
    assert.equal(def.kind, 'pane')
    assert.ok((await loadIndicator('nope')) === null)
  })
})

describe('runIndicator (pure relative to bars — no mongo, no network)', () => {
  test('resolves params onto the canonical schema and shapes a run', async () => {
    const run = await runIndicator({ id: 'sma', bars, rawParams: { length: 7 }, symbol: 'BTCUSDT', tf: '1m', market: 'futures' })
    assert.ok(run)
    assert.equal(run.indicatorId, 'sma')
    assert.equal(run.params.length, 7, 'schema clamp keeps in-range value')
    assert.equal(run.symbol, 'BTCUSDT')
    assert.equal(run.tf, '1m')
    assert.equal(run.bars, bars.length)
    assert.equal(run.window.from, new Date(T0).toISOString())
    assert.equal(run.window.to, new Date(T0 + 59 * 60_000).toISOString())
    assert.equal(run.outputs.sma?.length, bars.length, 'aligned to bars')
    assert.ok(run.lastPoints.sma !== null)
  })

  test('clamps params beyond the schema range', async () => {
    const run = await runIndicator({ id: 'sma', bars, rawParams: { length: 99_999 }, symbol: 'BTCUSDT', tf: '1m', market: 'futures' })
    assert.ok(run)
    assert.equal(run.params.length, 500, 'clamped to schema max')
  })

  test('aligns every output to bars.length and tracks last non-null', async () => {
    const run = await runIndicator({ id: 'macd', bars, symbol: 'ETHUSDT', tf: '15m', market: 'spot' })
    assert.ok(run)
    for (const key of ['macd', 'signal', 'hist'] as const) {
      assert.equal(run!.outputs[key]?.length, bars.length, `${key} length`)
    }
    assert.ok(run!.lastPoints.macd !== null)
  })

  test('unknown indicator returns null (fail-soft)', async () => {
    const run = await runIndicator({ id: 'nope', bars, symbol: 'BTCUSDT', tf: '1m', market: 'futures' })
    assert.equal(run, null)
  })
})

describe('shapeIndicatorRun (pure)', () => {
  test('pads short series to bars with null and computes lastPoints', () => {
    const run = shapeIndicatorRun({
      indicatorId: 'x',
      version: '1',
      symbol: 'BTCUSDT',
      tf: '1m',
      market: 'futures',
      params: { length: 5 },
      bars,
      outputs: { v: [1, null, 3] } // shorter than bars — padded
    })
    assert.equal(run.bars, bars.length)
    assert.equal(run.outputs.v?.length, bars.length)
    assert.equal(run.outputs.v![3], null, 'pad with null')
    assert.equal(run.lastPoints.v, 3, 'last non-null')
  })

  test('non-finite values become null (Pine na)', () => {
    const run = shapeIndicatorRun({
      indicatorId: 'x',
      version: '1',
      symbol: 'BTCUSDT',
      tf: '1m',
      market: 'futures',
      params: {},
      bars: bars.slice(0, 3),
      outputs: { v: ['7', Number.NaN, 1.5] }
    })
    assert.deepEqual(run.outputs.v, [null, null, 1.5])
    assert.equal(run.lastPoints.v, 1.5)
  })

  test('empty bars produce aligned empty series and empty window', () => {
    const run = shapeIndicatorRun({
      indicatorId: 'x',
      version: '1',
      symbol: 'BTCUSDT',
      tf: '1m',
      market: 'futures',
      params: {},
      bars: [],
      outputs: { v: [1, 2] }
    })
    assert.equal(run.bars, 0)
    assert.deepEqual(run.outputs.v, [])
    assert.deepEqual(run.window, { from: '', to: '' })
  })
})