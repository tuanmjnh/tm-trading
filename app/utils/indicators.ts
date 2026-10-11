// =============================================================================
//  Dashboard indicator facade (Phase 7I) — typed re-export of the CANONICAL
//  engine registry (engine/indicators.mjs, D1).
//
//  Single source of truth rule: every definition + every calculate() lives in
//  engine/indicators.mjs, which delegates to engine/ta.mjs (the SAME Pine-exact
//  primitives the backtest uses). This file only adds TypeScript types and the
//  chart bar shape — it never reimplements math. It is the layer TradeChart /
//  trade.vue / tests/indicators.test.ts already import, so their API surface is
//  unchanged.
//
//  Output contract: Record<outputKey, Array<number | null>> — same length as
//  `bars`, `null` = Pine `na` = whitespace point on the chart.
// =============================================================================
import {
  INDICATORS as engineIndicators,
  INDICATOR_MAP as engineMap,
  calculateIndicator as engineCalculate,
  resolveParams as engineResolveParams,
} from '../../engine/indicators.mjs'
import type { ChartBar } from './marketFeed'

// The engine registry is untyped .mjs (JS-inferred params collapse to
// `null | undefined`). Re-assert the real signatures here so the dashboard
// surface stays typed; the math itself is untouched (D1).
type EngineResolveParams = (
  def: unknown,
  partial?: Record<string, number> | null,
) => Record<string, number>
type EngineCalculate = (
  id: string,
  bars: ChartBar[],
  partial?: Record<string, number> | null,
) => Record<string, Array<number | null>>

const engineResolveParamsTyped = engineResolveParams as unknown as EngineResolveParams
const engineCalculateTyped = engineCalculate as unknown as EngineCalculate

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

/** One toggleable indicator on the chart (selection = id + optional params). */
export interface IndicatorSelection {
  id: string
  params?: Record<string, number>
}

export const INDICATORS: IndicatorDefinition[] = engineIndicators as unknown as IndicatorDefinition[]

export const INDICATOR_MAP: Record<string, IndicatorDefinition> = engineMap as unknown as Record<string, IndicatorDefinition>

/** Clamp a partial params object onto the schema defaults (unknown keys dropped). */
export function resolveParams(
  def: IndicatorDefinition,
  partial?: Record<string, number> | null
): Record<string, number> {
  return engineResolveParamsTyped(def, partial ?? null)
}

/** Compute one indicator with schema-resolved params (delegates to the engine). */
export function calculateIndicator(
  id: string,
  bars: ChartBar[],
  partialParams?: Record<string, number> | null
): Record<string, Array<number | null>> {
  return engineCalculateTyped(id, bars, partialParams ?? null)
}