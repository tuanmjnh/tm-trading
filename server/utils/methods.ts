import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MethodEvent, MethodLeague, MethodLeagueRow, MethodLeagueSummary, MethodMeta, ConfluenceDetail } from '../../types/methods'
import type { IntelConfluence } from '../../types/intel'

// =============================================================================
//  Method events + league + confluence explanation for the dashboard.
//
//  Single-source rule (D1): events are computed by the engine method plugins
//  (engine/methods/*) on bars already served to the chart — the dashboard
//  never reimplements analysis, it just maps analyze() output to markers.
//  The league is read from a snapshot file, never recomputed per request.
//  Every stored result keeps its version stamp (D1).
//
//  Pure helpers are exported for tests: they take the plugins / raw snapshot
//  as arguments so node:test never needs the engine modules.
// =============================================================================

/** minimal bar shape the engine methods consume. */
export interface EngineBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** plugin contract used by the pure mapper — shape of getMethod(id) + a version stamp. */
export interface MethodPluginLike {
  id: string
  name: string
  defaults: Record<string, unknown>
  version: string
  analyze(bars: EngineBar[]): { events: { bar: number; type: string }[]; scores: number[] }
}

/** Candle rows from /api/v1/markets/:sym/candles use openTime; engine bars use time. */
export function toEngineBars(candles: Array<{ openTime?: number; open?: number; high?: number; low?: number; close?: number; volume?: number }>): EngineBar[] {
  return (candles ?? [])
    .filter((c) => Number.isFinite(c?.openTime) && Number.isFinite(c?.open) && Number.isFinite(c?.high) && Number.isFinite(c?.low) && Number.isFinite(c?.close) && Number.isFinite(c?.volume))
    .map((c) => ({
      time: Number(c!.openTime),
      open: Number(c!.open),
      high: Number(c!.high),
      low: Number(c!.low),
      close: Number(c!.close),
      volume: Number(c!.volume)
    }))
}

export interface MethodEventsOptions {
  /** drop confirmation-only events (score 0, e.g. INSIDE) from markers. */
  skipNeutral?: boolean
  /** cap the returned list (default 200). */
  maxEvents?: number
}

export interface MethodEventsResult {
  events: MethodEvent[]
  /** methods that actually ran (registry misses are skipped). */
  ran: string[]
  /** window these events were computed over. */
  window: { from: string; to: string }
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * Run the requested methods over a bar window and map analyze() output to
 * chart-ready events carrying method/version/reasons/score/snapshot.
 * PURE: plugins + bars are arguments (node:test friendly).
 */
export function methodEventsFromBars(
  bars: EngineBar[],
  ids: string[],
  plugins: MethodPluginLike[],
  opts: MethodEventsOptions = {}
): MethodEventsResult {
  const skipNeutral = opts.skipNeutral ?? true
  const maxEvents = opts.maxEvents ?? 200
  const events: MethodEvent[] = []
  const ran: string[] = []

  for (const id of ids) {
    const plugin = plugins.find((p) => p.id === id)
    if (!plugin) continue
    ran.push(id)
    let result: { events: { bar: number; type: string }[]; scores: number[] }
    try {
      result = plugin.analyze(bars)
    } catch {
      continue // a plugin failing on a window must not kill the group
    }
    if (!Array.isArray(result?.events)) continue
    for (const de of result.events) {
      const bar = de?.bar
      if (!Number.isInteger(bar) || bar < 0 || bar >= bars.length) continue
      const score = num(result.scores?.[bar])
      if (skipNeutral && score === 0) continue
      const base = bars[bar]!
      events.push({
        method: plugin.id,
        version: plugin.version,
        bar,
        time: Math.floor(Number(base.time) / 1000),
        type: String(de?.type ?? ''),
        score: Math.max(-1, Math.min(1, score)),
        price: base.close,
        reasons: [String(de?.type ?? plugin.id)],
        snapshot: {
          time: new Date(base.time).toISOString(),
          open: base.open,
          high: base.high,
          low: base.low,
          close: base.close,
          volume: base.volume
        }
      })
    }
  }

  events.sort((a, b) => a.time - b.time || a.method.localeCompare(b.method))
  return {
    events: events.slice(0, maxEvents),
    ran,
    window: {
      from: bars[0] ? new Date(bars[0]!.time).toISOString() : '',
      to: bars.length ? new Date(bars[bars.length - 1]!.time).toISOString() : ''
    }
  }
}

// -----------------------------------------------------------------------------
//  Engine registry (dynamic import — same trick as intel.ts / engineModel.ts).
// -----------------------------------------------------------------------------

type EngineMethodsMod = {
  listMethods: () => string[]
  getMethod: (id: string) => { id: string; name: string; defaults: Record<string, unknown>; analyze: (bars: EngineBar[]) => unknown }
}
type EngineVersionMod = { hashOf: (o: unknown) => string }

let enginePromise: Promise<EngineMethodsMod | null> | null = null

async function engineMethods(): Promise<EngineMethodsMod | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const all = pathToFileURL(join(process.cwd(), 'engine', 'methods', 'all.mjs')).href
        const idx = pathToFileURL(join(process.cwd(), 'engine', 'methods', 'index.mjs')).href
        await import(/* @vite-ignore */ all)
        return (await import(/* @vite-ignore */ idx)) as EngineMethodsMod
      } catch {
        return null
      }
    })()
  }
  return enginePromise
}

async function engineVersion(): Promise<EngineVersionMod | null> {
  try {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'version.mjs')).href
    return (await import(/* @vite-ignore */ file)) as EngineVersionMod
  } catch {
    return null
  }
}

/**
 * Registry meta (id/name/defaults/version) for GET /api/v1/methods.
 * Engine not importable -> [] (fail-soft, dashboard shows methods list as empty).
 */
export async function loadMethodRegistry(): Promise<MethodMeta[]> {
  const eng = await engineMethods()
  if (!eng) return []
  const ver = await engineVersion()
  const out: MethodMeta[] = []
  for (const id of eng.listMethods()) {
    try {
      const m = eng.getMethod(id)
      out.push({
        id,
        name: String(m?.name ?? id),
        defaults: (m?.defaults as Record<string, number | boolean | string>) ?? {},
        version: ver?.hashOf?.({ method: id, params: m?.defaults }) ?? ''
      })
    } catch {
      // skip a method that fails to introspect
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Full plugins (incl. analyze) for the events endpoint. [] when engine is unavailable. */
export async function loadMethodPlugins(): Promise<MethodPluginLike[]> {
  const eng = await engineMethods()
  if (!eng) return []
  const ver = await engineVersion()
  const out: MethodPluginLike[] = []
  for (const id of eng.listMethods()) {
    try {
      const m = eng.getMethod(id)
      out.push({
        id,
        name: String(m?.name ?? id),
        defaults: (m?.defaults as Record<string, unknown>) ?? {},
        version: ver?.hashOf?.({ method: id, params: m?.defaults }) ?? '',
        analyze: m?.analyze as MethodPluginLike['analyze']
      })
    } catch {
      // skip a method that fails to introspect
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// -----------------------------------------------------------------------------
//  League snapshot (engine/league.mjs --out-json) — read-only, fail-soft.
// -----------------------------------------------------------------------------

function numRow(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function toRow(r: any): MethodLeagueRow | null {
  if (!r || typeof r !== 'object') return null
  const row = r?.row && typeof r.row === 'object' ? r.row : {}
  return {
    method: String(r?.method ?? ''),
    symbol: String(r?.symbol ?? ''),
    tf: String(r?.tf ?? ''),
    bars: numRow(r?.bars),
    trades: numRow(row.trades),
    closed: numRow(row.closed),
    winRate: numRow(row.winRate),
    profitFactor: numRow(row.profitFactor),
    netPct: numRow(row.netPct),
    maxDrawdownPct: numRow(row.maxDrawdownPct),
    noFill: numRow(row.noFill),
    replaced: numRow(row.replaced)
  }
}

function toSummary(s: any): MethodLeagueSummary | null {
  if (!s || typeof s !== 'object') return null
  return {
    id: String(s?.id ?? ''),
    name: String(s?.name ?? s?.id ?? ''),
    trades: numRow(s.trades),
    open: numRow(s.open),
    winRate: numRow(s.winRate),
    profitFactor: numRow(s.profitFactor),
    netPct: numRow(s.netPct),
    expectancy: numRow(s.expectancy)
  }
}

/**
 * Normalize a league snapshot file to the MethodLeague shape. Invalid input
 * returns null (fail-soft). PURE — used by the API and unit tests.
 */
export function summarizeLeague(rawList: {
  generatedAt?: string
  engineVersion?: string
  symbols?: string[]
  tfs?: string[]
  poolOut?: unknown[]
  rows?: unknown[]
}): MethodLeague {
  return {
    generatedAt: String(rawList?.generatedAt ?? ''),
    engineVersion: String(rawList?.engineVersion ?? ''),
    symbols: Array.isArray(rawList?.symbols) ? rawList!.symbols.map((s) => String(s)) : [],
    tfs: Array.isArray(rawList?.tfs) ? rawList!.tfs.map((t) => String(t)) : [],
    methods: (Array.isArray(rawList?.poolOut) ? rawList!.poolOut : [])
      .map(toSummary)
      .filter((s): s is MethodLeagueSummary => !!s),
    rows: (Array.isArray(rawList?.rows) ? rawList!.rows : [])
      .map(toRow)
      .filter((r): r is MethodLeagueRow => !!r)
  }
}

/** Read logs/method-league.json next to the repo — null when absent/corrupt. */
export async function loadLeagueSnapshot(): Promise<MethodLeague | null> {
  const file = join(process.cwd(), 'logs', 'method-league.json')
  try {
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof summarizeLeague>[0]
    return summarizeLeague(raw)
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
//  Confluence explanation (roadmap §13.3 — "Confluence must remain transparent").
// -----------------------------------------------------------------------------

export const CONFLUENCE_WEIGHTS = Object.freeze({ method: 0.4, regime: 0.2, funding: 0.2, zone: 0.2 } as const)
export type ConfluenceKey = keyof typeof CONFLUENCE_WEIGHTS

const partNote = (key: ConfluenceKey, value: number): string => {
  if (value > 0.05) {
    if (key === 'funding') return 'crowded short — contrarian bull tailwind'
    if (key === 'zone') return 'fuel above / crowded shorts'
    if (key === 'method') return 'buy-side pressure in the recency window'
    return 'season/contrarian tailwind'
  }
  if (value < -0.05) {
    if (key === 'funding') return 'crowded long — upside cost'
    if (key === 'zone') return 'long-liq cascade fuel below'
    if (key === 'method') return 'sell-side pressure in the recency window'
    return 'season/contrarian headwind'
  }
  return 'neutral'
}

/** Build a transparent part breakdown from an intel confluence doc. PURE. */
export function explainConfluence(c: IntelConfluence): ConfluenceDetail {
  const parts: ConfluenceDetail['parts'] = (['method', 'regime', 'funding', 'zone'] as const).map((key) => {
    const value = c?.parts?.[key] ?? 0
    const weight = CONFLUENCE_WEIGHTS[key]
    return {
      key,
      label: key,
      value,
      weight,
      contribution: Number((value * weight).toFixed(4)),
      note: partNote(key, value)
    }
  })
  return {
    symbol: c?.symbol ?? '',
    score: c?.score ?? 0,
    rank: c?.rank ?? 0,
    tf: c?.tf ?? '60',
    bars: c?.bars ?? 0,
    src: c?.src ?? '',
    ts: c?.ts ?? '',
    parts
  }
}