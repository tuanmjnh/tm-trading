import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INDICATORS,
  INDICATOR_MAP,
  calculateIndicator,
  resolveParams
} from '../app/utils/indicators'
import type { ChartBar } from '../app/utils/marketFeed'

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)

/** 60 synthetic bars with an up-drift so MAs/oscillators all have real values. */
const bars: ChartBar[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + i + (i % 7 === 0 ? -2 : 1)
  return {
    time: (T0 / 1000 + i * 60) as number,
    open: close - 1,
    high: close + 2,
    low: close - 3,
    close,
    volume: 10 + (i % 5)
  }
})

describe('indicator registry contract', () => {
  test('every definition is complete and unique', () => {
    const ids = new Set<string>()
    for (const def of INDICATORS) {
      assert.ok(def.id, 'id required')
      assert.ok(!ids.has(def.id), `duplicate id ${def.id}`)
      ids.add(def.id)
      assert.match(def.version, /^\d+$/, `${def.id}: version must be numeric string`)
      assert.ok(['overlay', 'pane', 'volume'].includes(def.kind), `${def.id}: bad kind`)
      assert.ok(Number.isInteger(def.warmup) && def.warmup >= 0, `${def.id}: warmup`)
      assert.ok(def.outputs.length > 0, `${def.id}: outputs required`)
      const keys = new Set<string>()
      for (const out of def.outputs) {
        assert.ok(!keys.has(out.key), `${def.id}: duplicate output key ${out.key}`)
        keys.add(out.key)
        assert.ok(['line', 'histogram'].includes(out.type), `${def.id}.${out.key}: type`)
        assert.match(out.color, /^#[0-9a-f]{6}$/i, `${def.id}.${out.key}: color`)
      }
      for (const [name, schema] of Object.entries(def.paramsSchema)) {
        assert.ok(schema.min <= schema.default && schema.default <= schema.max, `${def.id}.${name}: default out of range`)
      }
      assert.equal(typeof def.calculate, 'function', `${def.id}: calculate`)
    }
  })

  test('roadmap core indicators are all registered', () => {
    // docs roadmap §8 minimum Phase Indicator Core
    for (const id of ['sma', 'ema', 'rma', 'atr', 'rsi', 'vwap', 'macd', 'bb', 'volume', 'volma', 'obv', 'cmf', 'donchian']) {
      assert.ok(INDICATOR_MAP[id], `missing indicator ${id}`)
    }
  })
})

describe('resolveParams', () => {
  test('falls back to schema defaults and drops unknown keys', () => {
    const def = INDICATOR_MAP.sma!
    const p = resolveParams(def, { bogus: 99 })
    assert.deepEqual(p, { length: 20 })
  })

  test('clamps into [min, max]', () => {
    const def = INDICATOR_MAP.sma!
    assert.equal(resolveParams(def, { length: 99_999 }).length, 500)
    assert.equal(resolveParams(def, { length: 0 }).length, 2)
    assert.equal(resolveParams(def, { length: 7 }).length, 7)
  })
})

describe('calculateIndicator', () => {
  test('unknown id returns empty output', () => {
    assert.deepEqual(calculateIndicator('nope', bars), {})
  })

  test('all outputs are aligned to bars (null = Pine na warmup)', () => {
    for (const def of INDICATORS) {
      const out = calculateIndicator(def.id, bars)
      for (const output of def.outputs) {
        const series = out[output.key]
        assert.ok(series, `${def.id}.${output.key}: missing`)
        assert.equal(series.length, bars.length, `${def.id}.${output.key}: length`)
        assert.ok(series.some((v) => v !== null), `${def.id}.${output.key}: all null on 60 real bars`)
      }
    }
  })

  test('sma warmup: null until length bars, then rolling mean', () => {
    const out = calculateIndicator('sma', bars, { length: 20 })
    const sma = out.sma!
    assert.equal(sma[18], null)
    assert.ok(sma[19] !== null)
    let sum = 0
    for (let i = 0; i < 20; i++) sum += bars[i]!.close
    assert.ok(Math.abs(sma[19]! - sum / 20) < 1e-9, `sma[19] = ${sma[19]}`)
  })

  test('ema seeds from the first valid close (Pine src-seed)', () => {
    const out = calculateIndicator('ema', bars, { length: 20 })
    assert.equal(out.ema![0], bars[0]!.close)
  })

  test('macd returns 3 aligned outputs with hist = macd - signal', () => {
    const out = calculateIndicator('macd', bars)
    assert.deepEqual(Object.keys(out).sort(), ['hist', 'macd', 'signal'])
    for (let i = 0; i < bars.length; i++) {
      const m = out.macd![i]
      const s = out.signal![i]
      const h = out.hist![i]
      if (h !== null) {
        assert.ok(m !== null && s !== null)
        assert.ok(Math.abs(h - (m - s)) < 1e-9, `hist mismatch at ${i}`)
      }
    }
  })

  test('bollinger: upper >= mid >= lower wherever defined', () => {
    const out = calculateIndicator('bb', bars, { length: 20, mult: 2 })
    for (let i = 0; i < bars.length; i++) {
      const u = out.upper![i]
      const m = out.mid![i]
      const l = out.lower![i]
      if (u === null || m === null || l === null) continue
      assert.ok(u >= m && m >= l, `order violated at ${i}: ${u} / ${m} / ${l}`)
    }
  })

  test('volume output mirrors bar volumes', () => {
    const out = calculateIndicator('volume', bars)
    assert.deepEqual(out.volume, bars.map((b) => b.volume))
  })

  test('rsi stays within [0, 100] wherever defined', () => {
    const out = calculateIndicator('rsi', bars, { length: 14 })
    for (const v of out.rsi!) {
      if (v === null) continue
      assert.ok(v >= 0 && v <= 100, `rsi out of range: ${v}`)
    }
  })

  test('empty bars do not crash and return aligned empties', () => {
    for (const def of INDICATORS) {
      const out = calculateIndicator(def.id, [])
      for (const output of def.outputs) assert.deepEqual(out[output.key], [], `${def.id}.${output.key}`)
    }
  })
})
