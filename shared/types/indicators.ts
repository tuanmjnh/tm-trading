// =============================================================================
//  Indicator API types for the dashboard (roadmap §30.3 Indicators).
//
//  Single source rule (D1): definitions + math live in engine/indicators.mjs
//  (wrapping engine/ta.mjs). These are just the shape of what the API emits.
//  Unavailable registry / Mongo fails soft to empty lists (never 500).
// =============================================================================

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

/** Catalog entry for GET /api/v1/indicators — meta only, no calculate(). */
export interface IndicatorMeta {
  id: string
  version: string
  kind: IndicatorKind
  paramsSchema: Record<string, IndicatorParamDef>
  warmup: number
  outputs: IndicatorOutputDef[]
}

/** One stored indicator computation (POST /api/v1/indicator-runs). */
export interface IndicatorRun {
  id: string
  indicatorId: string
  /** indicator def.version used (D1). */
  version: string
  symbol: string
  tf: string
  market: string
  /** canonicalized params, not raw input. */
  params: Record<string, number>
  bars: number
  /** window the computation ran over (UTC ISO — D2). */
  window: { from: string; to: string }
  /** aligned per-output series — Array<number|null> of length `bars`. */
  outputs: Record<string, Array<number | null>>
  /** last non-null value per output — cheap "current value". */
  lastPoints: Record<string, number | null>
  createdAt: string
}