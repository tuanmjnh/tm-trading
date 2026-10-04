import type { EquityPoint, RunSeriesDetail, RunSummary } from '~~/types/runs'

// =============================================================================
//  Backtest series comparison (Phase 7) — 'THUAN' logic, no Vue/fetch, includes tests
//  (tests/compare.test.ts). Output to /runs/compare.
//
//  Key D1: Each column represents a DISTINCT series (parameter set x symbol x TF) —
//  they are placed side-by-side for comparison only; they are NEVER aggregated.
// =============================================================================

/** Comparison index + "better" direction (null = information index, no ranking). */
export const COMPARE_METRICS = [
  { key: 'trades', better: null },
  { key: 'winRate', better: 'higher' },
  { key: 'profitFactor', better: 'higher' },
  { key: 'net', better: 'higher' },
  { key: 'maxDD', better: 'lower' },
  { key: 'medianR', better: 'higher' },
  { key: 'expectancy', better: 'higher' }
] as const satisfies { key: string, better: 'higher' | 'lower' | null }[]

export type CompareMetricKey = (typeof COMPARE_METRICS)[number]['key']

export interface CompareRow {
  key: CompareMetricKey
  /** Value corresponding to the selected series order (null = no data; e.g., PF = ∞). */
  values: (number | null)[]
  /**
   * Best series index; null = no highlight (no ranking, or ALL series identical -> no one is "best").
   */
  best: number | null
}

function metricValue(summary: RunSummary, key: CompareMetricKey): number | null {
  switch (key) {
    case 'trades': return summary.trades
    case 'winRate': return summary.winRate
    case 'profitFactor': return summary.profitFactor // null = ∞
    case 'net': return summary.netPct
    case 'maxDD': return summary.maxDrawdownPct
    case 'medianR': return summary.medianRr
    case 'expectancy': return summary.expectancy
    default: return null
  }
}

/** Metric rows: rows as metrics x columns as selected series order. */
export function metricRows(details: RunSeriesDetail[]): CompareRow[] {
  return COMPARE_METRICS.map(({ key, better }) => {
    const values = details.map(d => metricValue(d.summary, key))
    let best: number | null = null
    if (better && values.every(v => v !== null)) {
      const nums = values as number[]
      let bi = 0
      for (let i = 1; i < nums.length; i++) {
        const cur = nums[i]!
        const b = nums[bi]!
        if (better === 'higher' ? cur > b : cur < b) bi = i
      }
      // Only highlight when there is a STRICTLY better value (equals -> no one is "best").
      const bestVal = nums[bi]!
      if (nums.some(v => v !== bestVal)) best = bi
    }
    return { key, values, best }
  })
}

// ---------------- Params diff (the "preset compare" part) ----------------

function stable(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'object') return JSON.stringify(sortJson(value))
  return `${typeof value}:${String(value)}`
}

/** JSON.stringify with sorted keys to compare objects ignoring key order. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)])
    )
  }
  return value
}

export interface ParamsDiff {
  /** All keys (union, sorted). */
  keys: string[]
  /** Keys where VALUES differ across series (this is where "preset" differences live). */
  diffKeys: string[]
  /** Number of keys that are identical. */
  sameCount: number
}

/**
 * Compare params across series. A series missing a key (not present in the
 * params set) still counts as ONE value (`__missing__`) -> different from
 * having a value (D1: never ignore differences).
 */
export function paramsDiff(paramsList: Record<string, unknown>[]): ParamsDiff {
  const keys = [...new Set(paramsList.flatMap(p => Object.keys(p)))].sort((a, b) => a.localeCompare(b))
  const diffKeys = keys.filter((k) => {
    const values = new Set(paramsList.map(p => (k in p ? stable(p[k]) : '__missing__')))
    return values.size > 1
  })
  return { keys, diffKeys, sameCount: keys.length - diffKeys.length }
}

/** Display a parameter value (object -> compact JSON, undefined -> em dash). */
export function paramsValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(sortJson(value))
  return String(value)
}

// ---------------- Equity overlay (multiple lines on one axis) ----------------

export interface OverlayLine {
  id: string
  /** Normalized SVG path within W x H viewBox. */
  d: string
}

export interface OverlayChart {
  lines: OverlayLine[]
  /** Y-coordinate (viewBox) of the 0% mark. */
  zeroY: number
  /** Combined time range (epoch ms) — shared X-axis. */
  minT: number
  maxT: number
  /** Overall min / max values (includes 0) — shared Y-axis. */
  minV: number
  maxV: number
}

/**
 * Draw multiple equity curves on the SAME axis (X = UTC time, Y = cumulative
 * PnL %). Each series starts from (first equity point, 0) — same start
 * position as the engine (equity 0 before the first trade). Return null if no
 * data.
 */
export function buildOverlay(
  series: { id: string, equity: EquityPoint[] }[],
  W = 1000,
  H = 100
): OverlayChart | null {
  const usable = series
    .map(s => ({
      id: s.id,
      points: [...s.equity]
        .map(p => ({ t: Date.parse(p.t), v: p.v }))
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t)
    }))
    .filter(s => s.points.length > 0)
  if (!usable.length) return null

  let minT = Infinity
  let maxT = -Infinity
  let minV = 0
  let maxV = 0
  for (const s of usable) {
    const firstPoint = s.points[0]!
    const lastPoint = s.points[s.points.length - 1]!
    minT = Math.min(minT, firstPoint.t)
    maxT = Math.max(maxT, lastPoint.t)
    for (const p of s.points) {
      minV = Math.min(minV, p.v)
      maxV = Math.max(maxV, p.v)
    }
  }
  if (maxV - minV < 1e-9) { maxV = 1; minV = -1 }

  const tSpan = maxT - minT
  const vSpan = maxV - minV
  const x = (t: number) => (tSpan <= 0 ? W / 2 : ((t - minT) / tSpan) * W)
  const y = (v: number) => H - ((v - minV) / vSpan) * H

  const lines: OverlayLine[] = usable.map((s) => {
    const firstP = s.points[0]!
    const coords = [
      // Start from 0 before the first trade (same as engine).
      { x: x(firstP.t), y: y(0) },
      ...s.points.map(p => ({ x: x(p.t), y: y(p.v) }))
    ]
    const d = coords
      .map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(' ')
    return { id: s.id, d }
  })

  return { lines, zeroY: y(0), minT, maxT, minV, maxV }
}
