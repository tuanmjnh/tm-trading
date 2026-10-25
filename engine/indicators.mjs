// =============================================================================
//  TM TRADING — ENGINE INDICATOR REGISTRY (roadmap Phase 7C / 7I, §11, §30.3).
//
//  CANONICAL registry (D1). The dashboard NEVER reimplements an indicator:
//  app/utils/indicators.ts re-exports these definitions, and the Nitro server
//  (server/utils/indicators.ts) loads them through a pathToFileURL import —
//  engine/ta.mjs is the ONLY math (Pine-exact primitives).
//
//  Every definition carries:
//    id            stable identifier (also the API path segment)
//    version       numeric definition-stamp — bump when params/outputs change
//    kind          overlay | pane | volume (where the series render)
//    paramsSchema  { name: {default,min,max} } — validators + warmup defaults
//    warmup        informational bars before output is non-null
//    outputs       [{ key, type: line|histogram, color }]
//    calculate(bars, params) -> { [outputKey]: Array<number|null> } aligned
//                   to `bars.length` (null = Pine na = chart whitespace).
//
//  Contract identical to the earlier app-side registry this module replaces.
// =============================================================================

import {
  atr,
  cmf,
  donchian,
  ema,
  macd,
  obv,
  rma,
  rsi,
  sar,
  sma,
  stdev,
  vwap,
} from './ta.mjs'

/** Minimal bar shape the math consumes (time is optional for indicators). */
const closesOf = (bars) => bars.map((b) => b.close)

/** Params arrive schema-resolved; safe accessor for noUncheckedIndexedAccess. */
const num = (p, key) => p[key]

/** Clamp a partial params object onto the schema defaults (unknown keys dropped). */
export function resolveParams(def, partial = null) {
  const out = {}
  for (const [key, schema] of Object.entries(def.paramsSchema)) {
    const fromPartial = partial?.[key]
    const raw = fromPartial !== undefined && Number.isFinite(fromPartial) ? fromPartial : schema.default
    out[key] = Math.min(schema.max, Math.max(schema.min, raw))
  }
  return out
}

const line = (key, color) => ({ key, type: 'line', color })
const hist = (key, color) => ({ key, type: 'histogram', color })

export const INDICATORS = [
  {
    id: 'sma',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('sma', '#3b82f6')],
    calculate: (bars, p) => ({ sma: sma(closesOf(bars), num(p, 'length')) }),
  },
  {
    id: 'ema',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 1,
    outputs: [line('ema', '#f59e0b')],
    calculate: (bars, p) => ({ ema: ema(closesOf(bars), num(p, 'length')) }),
  },
  {
    id: 'rma',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 14,
    outputs: [line('rma', '#ec4899')],
    calculate: (bars, p) => ({ rma: rma(closesOf(bars), num(p, 'length')) }),
  },
  {
    id: 'vwap',
    version: '1',
    kind: 'overlay',
    paramsSchema: {},
    warmup: 1,
    outputs: [line('vwap', '#06b6d4')],
    calculate: (bars) => ({ vwap: vwap(bars) }),
  },
  {
    id: 'bb',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 }, mult: { default: 2, min: 0.5, max: 6 } },
    warmup: 20,
    outputs: [line('upper', '#a78bfa'), line('mid', '#64748b'), line('lower', '#a78bfa')],
    calculate: (bars, p) => {
      const length = num(p, 'length')
      const mult = num(p, 'mult')
      const mid = sma(closesOf(bars), length)
      const sd = stdev(closesOf(bars), length)
      const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + mult * sd[i]))
      const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - mult * sd[i]))
      return { upper, mid, lower }
    },
  },
  {
    id: 'donchian',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('upper', '#f43f5e'), line('middle', '#64748b'), line('lower', '#10b981')],
    calculate: (bars, p) => donchian(bars, num(p, 'length')),
  },
  {
    id: 'volume',
    version: '1',
    kind: 'volume',
    paramsSchema: {},
    warmup: 0,
    outputs: [hist('volume', '#3b82f6')],
    calculate: (bars) => ({ volume: bars.map((b) => b.volume) }),
  },
  {
    id: 'volma',
    version: '1',
    kind: 'volume',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('volma', '#f59e0b')],
    calculate: (bars, p) => ({ volma: sma(bars.map((b) => b.volume), num(p, 'length')) }),
  },
  {
    id: 'atr',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 14,
    outputs: [line('atr', '#f97316')],
    calculate: (bars, p) => ({ atr: atr(bars, num(p, 'length')) }),
  },
  {
    id: 'rsi',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 15,
    outputs: [line('rsi', '#10b981')],
    calculate: (bars, p) => ({ rsi: rsi(closesOf(bars), num(p, 'length')) }),
  },
  {
    id: 'macd',
    version: '1',
    kind: 'pane',
    paramsSchema: { fast: { default: 12, min: 2, max: 200 }, slow: { default: 26, min: 3, max: 400 }, signal: { default: 9, min: 2, max: 200 } },
    warmup: 26,
    outputs: [line('macd', '#3b82f6'), line('signal', '#f59e0b'), hist('hist', '#64748b')],
    calculate: (bars, p) => macd(closesOf(bars), num(p, 'fast'), num(p, 'slow'), num(p, 'signal')),
  },
  {
    id: 'obv',
    version: '1',
    kind: 'pane',
    paramsSchema: {},
    warmup: 1,
    outputs: [line('obv', '#8b5cf6')],
    calculate: (bars) => ({ obv: obv(bars) }),
  },
  {
    id: 'cmf',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('cmf', '#14b8a6')],
    calculate: (bars, p) => ({ cmf: cmf(bars, num(p, 'length')) }),
  },
  {
    id: 'psar',
    version: '1',
    kind: 'overlay',
    paramsSchema: {
      start: { default: 0.02, min: 0.001, max: 0.1 },
      inc: { default: 0.02, min: 0.001, max: 0.1 },
      max: { default: 0.2, min: 0.01, max: 1.0 },
    },
    warmup: 2,
    outputs: [line('psar', '#d946ef')],
    calculate: (bars, p) => ({ psar: sar(bars, num(p, 'start'), num(p, 'inc'), num(p, 'max')) }),
  },
]

export const INDICATOR_MAP = Object.fromEntries(INDICATORS.map((d) => [d.id, d]))

/**
 * Compute one indicator with schema-resolved params.
 * Returns { [outputKey]: Array<number|null> } aligned to `bars.length`
 * (null = Pine `na` = whitespace point). Unknown id -> {} (fail-soft).
 */
export function calculateIndicator(id, bars, partial = null) {
  const def = INDICATOR_MAP[id]
  if (!def) return {}
  const params = resolveParams(def, partial)
  const out = def.calculate(bars, params)
  const aligned = {}
  for (const o of def.outputs) {
    const series = out[o.key]
    aligned[o.key] = series && series.length === bars.length
      ? series
      : new Array(bars.length).fill(null)
  }
  return aligned
}