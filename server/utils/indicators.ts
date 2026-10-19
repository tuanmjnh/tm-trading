import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  IndicatorMeta,
  IndicatorOutputDef,
  IndicatorParamDef,
  IndicatorRun
} from '../../types/indicators'
import { engineModel } from './engineModel'
import type { EngineBar } from './methods'

// =============================================================================
//  Indicator API for the dashboard (roadmap §30.3).
//
//  Single-source rule (D1): the indicator definitions + math live in
//  engine/indicators.mjs (which wraps engine/ta.mjs — the SAME Pine-exact
//  primitives the backtest uses). This util only:
//    - loads the registry through a pathToFileURL import (same trick as
//      methods.ts / intel.ts — a stray relative import into engine/ breaks
//      the Nitro bundle, see docs/app-inheritance.md),
//    - maps the registry to catalog meta,
//    - shapes a computation into a stored run (pure, testable),
//    - persists/reads runs through the engine model.
//
//  Engine or Mongo unavailable -> catalog [] / run null (fail-soft, never 500).
// =============================================================================

/** Engine registry module contract (only the shape Nitro needs). */
interface EngineIndicatorsMod {
  INDICATORS: EngineIndicatorDef[]
  INDICATOR_MAP: Record<string, EngineIndicatorDef>
  resolveParams: (def: EngineIndicatorDef, partial?: Record<string, number> | null) => Record<string, number>
  calculateIndicator: (
    id: string,
    bars: EngineBar[],
    partial?: Record<string, number> | null
  ) => Record<string, Array<number | null>>
}

/** Minimal engine definition shape needed here. */
export interface EngineIndicatorDef {
  id: string
  version: string
  kind: 'overlay' | 'pane' | 'volume'
  paramsSchema: Record<string, IndicatorParamDef>
  warmup: number
  outputs: Array<{ key: string; type: 'line' | 'histogram'; color: string }>
  calculate: (bars: EngineBar[], params: Record<string, number>) => Record<string, Array<number | null>>
}

let registryPromise: Promise<EngineIndicatorsMod | null> | null = null

function loadRegistry(): Promise<EngineIndicatorsMod | null> {
  if (!registryPromise) {
    registryPromise = (async () => {
      try {
        const file = pathToFileURL(join(process.cwd(), 'engine', 'indicators.mjs')).href
        return (await import(/* @vite-ignore */ file)) as EngineIndicatorsMod
      } catch {
        return null
      }
    })()
  }
  return registryPromise
}

/** Catalog meta for GET /api/v1/indicators. [] when engine is unavailable. */
export async function loadIndicatorCatalog(): Promise<IndicatorMeta[]> {
  const reg = await loadRegistry()
  if (!reg) return []
  return reg.INDICATORS
    .map((d): IndicatorMeta => ({
      id: d.id,
      version: String(d.version ?? ''),
      kind: d.kind,
      paramsSchema: d.paramsSchema ?? {},
      warmup: d.warmup ?? 0,
      outputs: Array.isArray(d.outputs)
        ? d.outputs.map((o): IndicatorOutputDef => ({ key: o.key, type: o.type, color: o.color }))
        : []
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** One definition for GET /api/v1/indicators/:id — null when unknown. */
export async function loadIndicator(id: string): Promise<EngineIndicatorDef | null> {
  const reg = await loadRegistry()
  if (!reg) return null
  return reg.INDICATOR_MAP[id] ?? null
}

// -----------------------------------------------------------------------------
//  Pure run shaping (node:test friendly — takes def + bars as arguments)
// -----------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const iso = (ms: number): string => (Number.isFinite(ms) ? new Date(ms).toISOString() : '')

/**
 * Shape a computation into the stored-run record (PURE).
 * Takes the engine's resolved params + aligned outputs and the bar window.
 * Every output series is padded to `bars.length` (null = Pine na).
 */
export function shapeIndicatorRun(o: {
  indicatorId: string
  version: string
  symbol: string
  tf: string
  market: string
  params: Record<string, number>
  bars: EngineBar[]
  outputs: Record<string, Array<number | null>>
}): Omit<IndicatorRun, 'id' | 'createdAt'> {
  const { bars } = o
  const count = bars.length
  const aligned: Record<string, Array<number | null>> = {}
  const lastPoints: Record<string, number | null> = {}

  for (const [key, series] of Object.entries(o.outputs ?? {})) {
    const list = Array.isArray(series) ? series : []
    aligned[key] = count > 0
      ? Array.from({ length: count }, (_, i) => {
          const v = list[i]
          return v === null || v === undefined || !Number.isFinite(v) ? null : num(v)
        })
      : []
    let last: number | null = null
    for (const v of aligned[key] as Array<number | null>) {
      if (v !== null) last = v
    }
    lastPoints[key] = last
  }

  return {
    indicatorId: o.indicatorId,
    version: o.version,
    symbol: o.symbol,
    tf: o.tf,
    market: o.market,
    params: o.params,
    bars: count,
    window: {
      from: bars[0] ? iso(num(bars[0]!.time)) : '',
      to: bars.length ? iso(num(bars[bars.length - 1]!.time)) : ''
    },
    outputs: aligned,
    lastPoints
  }
}

// -----------------------------------------------------------------------------
//  Compute orchestration (registry + bars in, shaped run out)
// -----------------------------------------------------------------------------

/**
 * Run one indicator over engine bars: resolve params through the CANONICAL
 * schema, compute through the CANONICAL calculate(), align outputs, shape the
 * run. null when the registry is unavailable (fail-soft). PURE wrt the bars.
 */
export async function runIndicator(o: {
  id: string
  bars: EngineBar[]
  rawParams?: Record<string, number> | null
  symbol: string
  tf: string
  market: 'spot' | 'futures'
}): Promise<Omit<IndicatorRun, 'id' | 'createdAt'> | null> {
  const reg = await loadRegistry()
  const def = reg?.INDICATOR_MAP[o.id]
  if (!reg || !def) return null

  let params: Record<string, number>
  try {
    params = reg.resolveParams(def, o.rawParams ?? null)
  } catch {
    return null
  }

  let outputs: Record<string, Array<number | null>>
  try {
    outputs = reg.calculateIndicator(o.id, o.bars, params)
  } catch {
    return null
  }

  return shapeIndicatorRun({
    indicatorId: o.id,
    version: String(def.version ?? ''),
    symbol: o.symbol,
    tf: o.tf,
    market: o.market,
    params,
    bars: o.bars,
    outputs
  })
}

// -----------------------------------------------------------------------------
//  Model (engineModel — fails to null when Mongo is down)
// -----------------------------------------------------------------------------

function mapRun(doc: Record<string, any>): IndicatorRun | null {
  if (!doc || !doc.indicatorId) return null
  const from = doc.window?.from ? new Date(doc.window.from).toISOString() : ''
  const to = doc.window?.to ? new Date(doc.window.to).toISOString() : ''
  return {
    id: String(doc._id),
    indicatorId: String(doc.indicatorId),
    version: String(doc.version ?? ''),
    symbol: String(doc.symbol ?? ''),
    tf: String(doc.tf ?? ''),
    market: String(doc.market ?? 'futures'),
    params: (doc.params as Record<string, number>) ?? {},
    bars: num(doc.bars),
    window: { from, to },
    outputs: (doc.outputs as Record<string, Array<number | null>>) ?? {},
    lastPoints: (doc.lastPoints as Record<string, number | null>) ?? {},
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : ''
  }
}

/** Persist a computed run. Returns null when Mongo is unavailable. */
export async function saveIndicatorRun(
  run: Omit<IndicatorRun, 'id' | 'createdAt'>,
  ownerId?: string | null
): Promise<string | null> {
  const IndicatorRun = await engineModel('indicatorRun.mjs', 'IndicatorRun')
  if (!IndicatorRun) return null
  try {
    const created = await IndicatorRun.create({
      // Tenancy (roadmap §61.3): a stored run belongs to its creator.
      ownerId: ownerId ?? null,
      indicatorId: run.indicatorId,
      version: run.version,
      symbol: run.symbol,
      tf: run.tf,
      market: run.market,
      params: run.params,
      bars: run.bars,
      window: run.window,
      outputs: run.outputs,
      lastPoints: run.lastPoints
    })
    return String(created._id)
  } catch {
    return null
  }
}

/** Read one stored run. null = not found OR mongo down (fail-soft). */
export async function loadIndicatorRun(
  id: string,
  ownerId?: string | null
): Promise<{ run: IndicatorRun | null; mongo: 'up' | 'down' }> {
  const IndicatorRun = await engineModel('indicatorRun.mjs', 'IndicatorRun')
  if (!IndicatorRun) return { run: null, mongo: 'down' }
  try {
    if (!/^[0-9a-f]{24}$/i.test(id)) return { run: null, mongo: 'up' }
    const doc = await IndicatorRun.findOne({ _id: id, ...(ownerId ? { ownerId } : {}) }).lean()
    return { run: mapRun(doc as Record<string, any>), mongo: 'up' }
  } catch {
    return { run: null, mongo: 'down' }
  }
}