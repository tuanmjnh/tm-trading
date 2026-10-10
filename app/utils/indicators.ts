// =============================================================================
//  Indicator registry (Phase 7I) — versioned definitions + calculate().
//
//  Single source of truth rule (roadmap 7I acceptance "Indicator engine =
//  backtest implementation"): every calculation delegates to engine/ta.mjs,
//  the SAME Pine-exact primitives the backtest uses. This file only wires
//  bars -> ta.* -> per-output series aligned to the input bars.
//
//  Output contract: Record<outputKey, Array<number | null>> — same length as
//  `bars`, `null` = Pine `na` = whitespace point on the chart.
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
  sma,
  stdev,
  vwap
} from '../../engine/ta.mjs'
import type { ChartBar } from './marketFeed'

export type IndicatorKind = 'overlay' | 'pane' | 'volume'

export interface IndicatorParamDef {
  default: number
  min: number
  max: number
}

export interface IndicatorOutputDef {
  key: string
  type: 'line' | 'histogram'
  color: string
}

export interface IndicatorDefinition {
  id: string
  /** Definition schema version — bump when params/outputs change shape. */
  version: string
  kind: IndicatorKind
  paramsSchema: Record<string, IndicatorParamDef>
  /** Bars needed before output becomes non-null (informational). */
  warmup: number
  outputs: IndicatorOutputDef[]
  calculate(bars: ChartBar[], params: Record<string, number>): Record<string, Array<number | null>>
}

const closesOf = (bars: ChartBar[]): number[] => bars.map((b) => b.close)

/**
 * Params arrive schema-resolved (see resolveParams); this defeats
 * noUncheckedIndexedAccess without re-validating on every calculate call.
 */
const num = (p: Record<string, number>, key: string): number => p[key] as number

/** One toggleable indicator on the chart (selection = id + optional params). */
export interface IndicatorSelection {
  id: string
  params?: Record<string, number>
}

/** Clamp a partial params object onto the schema defaults (unknown keys dropped). */
export function resolveParams(
  def: IndicatorDefinition,
  partial?: Record<string, number> | null
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, schema] of Object.entries(def.paramsSchema)) {
    const fromPartial = partial?.[key]
    const raw = fromPartial !== undefined && Number.isFinite(fromPartial) ? fromPartial : schema.default
    out[key] = Math.min(schema.max, Math.max(schema.min, raw))
  }
  return out
}

const line = (key: string, color: string): IndicatorOutputDef => ({ key, type: 'line', color })
const hist = (key: string, color: string): IndicatorOutputDef => ({ key, type: 'histogram', color })

export const INDICATORS: IndicatorDefinition[] = [
  {
    id: 'sma',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('sma', '#3b82f6')],
    calculate: (bars, p) => ({ sma: sma(closesOf(bars), num(p, 'length')) })
  },
  {
    id: 'ema',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 1,
    outputs: [line('ema', '#f59e0b')],
    calculate: (bars, p) => ({ ema: ema(closesOf(bars), num(p, 'length')) })
  },
  {
    id: 'rma',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 14,
    outputs: [line('rma', '#ec4899')],
    calculate: (bars, p) => ({ rma: rma(closesOf(bars), num(p, 'length')) })
  },
  {
    id: 'vwap',
    version: '1',
    kind: 'overlay',
    paramsSchema: {},
    warmup: 1,
    outputs: [line('vwap', '#06b6d4')],
    calculate: (bars) => ({ vwap: vwap(bars) })
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
    }
  },
  {
    id: 'donchian',
    version: '1',
    kind: 'overlay',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('upper', '#f43f5e'), line('middle', '#64748b'), line('lower', '#10b981')],
    calculate: (bars, p) => donchian(bars, num(p, 'length'))
  },
  {
    id: 'volume',
    version: '1',
    kind: 'volume',
    paramsSchema: {},
    warmup: 0,
    outputs: [hist('volume', '#3b82f6')],
    calculate: (bars) => ({ volume: bars.map((b) => b.volume) })
  },
  {
    id: 'volma',
    version: '1',
    kind: 'volume',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('volma', '#f59e0b')],
    calculate: (bars, p) => ({ volma: sma(bars.map((b) => b.volume), num(p, 'length')) })
  },
  {
    id: 'atr',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 14,
    outputs: [line('atr', '#f97316')],
    calculate: (bars, p) => ({ atr: atr(bars, num(p, 'length')) })
  },
  {
    id: 'rsi',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 14, min: 2, max: 500 } },
    warmup: 15,
    outputs: [line('rsi', '#10b981')],
    calculate: (bars, p) => ({ rsi: rsi(closesOf(bars), num(p, 'length')) })
  },
  {
    id: 'macd',
    version: '1',
    kind: 'pane',
    paramsSchema: { fast: { default: 12, min: 2, max: 200 }, slow: { default: 26, min: 3, max: 400 }, signal: { default: 9, min: 2, max: 200 } },
    warmup: 26,
    outputs: [line('macd', '#3b82f6'), line('signal', '#f59e0b'), hist('hist', '#64748b')],
    calculate: (bars, p) => macd(closesOf(bars), num(p, 'fast'), num(p, 'slow'), num(p, 'signal'))
  },
  {
    id: 'obv',
    version: '1',
    kind: 'pane',
    paramsSchema: {},
    warmup: 1,
    outputs: [line('obv', '#8b5cf6')],
    calculate: (bars) => ({ obv: obv(bars) })
  },
  {
    id: 'cmf',
    version: '1',
    kind: 'pane',
    paramsSchema: { length: { default: 20, min: 2, max: 500 } },
    warmup: 20,
    outputs: [line('cmf', '#14b8a6')],
    calculate: (bars, p) => ({ cmf: cmf(bars, num(p, 'length')) })
  }
]

export const INDICATOR_MAP: Record<string, IndicatorDefinition> = Object.fromEntries(
  INDICATORS.map((d) => [d.id, d])
)

/** Compute one indicator with schema-resolved params. */
export function calculateIndicator(
  id: string,
  bars: ChartBar[],
  partialParams?: Record<string, number> | null
): Record<string, Array<number | null>> {
  const def = INDICATOR_MAP[id]
  if (!def) return {}
  const params = resolveParams(def, partialParams)
  const out = def.calculate(bars, params)
  const aligned: Record<string, Array<number | null>> = {}
  for (const o of def.outputs) {
    const series = out[o.key]
    aligned[o.key] = series && series.length === bars.length ? series : new Array(bars.length).fill(null)
  }
  return aligned
}
