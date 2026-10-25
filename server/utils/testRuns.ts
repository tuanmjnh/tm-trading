import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSeriesId } from './reports'
import type { TestRunResult } from '#shared/types/runs'

// =============================================================================
//  TEST RUN launcher (roadmap §58.9 Slice 3) — POST /api/v1/runs.
//
//  One source of truth (D1): the backtest is the engine's own `runOne`
//  (engine/run.mjs), which stamps the run (engineVersion/paramsHash/dataHash/
//  gitRev) and writes it to reports/*.ndjson + the `runs` collection. This file
//  only validates the request, normalizes it with the engine's OWN helpers
//  (normalizeSymbol/normalizeTf/buildParams — never a second parallel rule set)
//  and maps failures to HTTP. `runOne` is injectable so tests stay offline.
//
//  Engine modules live outside `server/`, so they are loaded at runtime from
//  process.cwd() (pathToFileURL) — Nitro mangles the relative depth of imports
//  escaping `server/` (docs/app-inheritance.md).
// =============================================================================

type RunModule = typeof import('../../engine/run.mjs')
type MethodsModule = { listMethods: () => string[] }

let runModP: Promise<RunModule> | null = null
let methodsModP: Promise<MethodsModule> | null = null

function load<T>(rel: string): Promise<T> {
  const file = pathToFileURL(join(process.cwd(), ...rel.split('/'))).href
  return import(/* @vite-ignore */ file) as Promise<T>
}

/** engine/run.mjs — runOne() + the normalization helpers. */
export function engineRunModule(): Promise<RunModule> {
  if (!runModP) runModP = load<RunModule>('engine/run.mjs')
  return runModP
}

/** engine/methods/index.mjs — the method registry (id validation). */
export function engineMethodsModule(): Promise<MethodsModule> {
  if (!methodsModP) methodsModP = load<MethodsModule>('engine/methods/index.mjs')
  return methodsModP
}

// -----------------------------------------------------------------------------
//  Errors — a TestRunError carries the HTTP intent through the thin route,
//  mirroring ReplayError/ResearchError.
// -----------------------------------------------------------------------------

export class TestRunError extends Error {
  statusCode: number
  statusMessage: string

  constructor(message: string, statusCode = 500, statusMessage = 'test_run_failed') {
    super(message)
    this.name = 'TestRunError'
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function testRunHttpError(err: unknown) {
  if (err instanceof TestRunError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'test_run_failed', message: e?.message || 'test run failed' })
}

// -----------------------------------------------------------------------------
//  startTestRun — validate → normalize → runOne → shape the manifest.
// -----------------------------------------------------------------------------

export interface StartTestRunDeps {
  /** Injected for tests — defaults to engine/run.mjs runOne with mongo 'auto'. */
  runOne?: (o: Record<string, unknown>) => Promise<unknown>
  /** Injected for tests — defaults to the engine method registry ids. */
  methods?: () => Promise<string[]>
}

const MARKETS = ['fapi', 'spot'] as const

export async function startTestRun(body: unknown, deps: StartTestRunDeps = {}, ownerId?: string | null): Promise<TestRunResult> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const symbolRaw = String(b.symbol ?? '').trim()
  if (!symbolRaw) throw new TestRunError('symbol is required', 400, 'invalid_field')

  const tfRaw = String(b.tf ?? '').trim()
  if (!tfRaw) throw new TestRunError('tf is required', 400, 'invalid_field')

  const method = String(b.method ?? 'vsa').trim() || 'vsa'
  const methods = deps.methods ? await deps.methods() : (await engineMethodsModule()).listMethods()
  if (!methods.includes(method)) {
    throw new TestRunError(`unknown method "${method}" (have: ${methods.join(', ')})`, 400, 'unknown_method')
  }

  const market = String(b.market ?? 'fapi').trim() || 'fapi'
  if (!(MARKETS as readonly string[]).includes(market)) {
    throw new TestRunError(`unsupported market "${market}" (fapi|spot)`, 400, 'invalid_market')
  }

  const limitRaw = b.limit === undefined || b.limit === null || b.limit === '' ? 5000 : Number(b.limit)
  if (!Number.isFinite(limitRaw) || limitRaw <= 0) {
    throw new TestRunError('limit must be a positive number', 400, 'invalid_field')
  }
  const limit = Math.min(Math.floor(limitRaw), 20000)

  const mod = await engineRunModule()
  let norm: { api: string; display: string }
  let tf: string
  let params: Record<string, unknown>
  try {
    norm = mod.normalizeSymbol(symbolRaw, market)
    tf = mod.normalizeTf(tfRaw)
    params = mod.buildParams({
      preset: b.preset ? String(b.preset) : undefined,
      paramsJson: b.params
    }) as Record<string, unknown>
  } catch (err) {
    throw new TestRunError((err as Error)?.message || 'invalid input', 400, 'invalid_field')
  }

  const runOne = deps.runOne ?? ((o: Record<string, unknown>) => mod.runOne({ ...o, mongo: 'auto' }))

  let r: Record<string, unknown>
  try {
    r = (await runOne({
      ...norm,
      tf,
      market,
      params,
      method,
      preset: b.preset ? String(b.preset) : null,
      limit,
      refresh: b.refresh === true,
      // Tenancy (roadmap §61.3): the engine stamps the run with the caller's id.
      ownerId: ownerId ?? null,
      dataDir: process.env.DATA_DIR || join(process.cwd(), 'data')
    })) as Record<string, unknown>
  } catch (err) {
    // The engine/network failure is reported as a bad gateway — the request was
    // well-formed, the upstream data source or engine rejected it (D12 honesty).
    throw new TestRunError((err as Error)?.message || 'backtest failed', 502, 'run_failed')
  }

  const summary = (r.summary ?? {}) as Record<string, unknown>
  const engineVersion = String(summary.engineVersion ?? '')
  const paramsHash = String(summary.paramsHash ?? '')
  const symbol = String(r.symbol ?? norm.display)
  const tfOut = String(r.tf ?? tf)

  return {
    symbol,
    tf: tfOut,
    market,
    method,
    preset: b.preset ? String(b.preset) : null,
    engineVersion,
    paramsHash,
    runId: r.runId ? String(r.runId) : null,
    bars: Number(r.bars ?? 0),
    source: String(r.source ?? ''),
    warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
    seriesId: buildSeriesId({ engineVersion, paramsHash, symbol, tf: tfOut }),
    stats: summary
  }
}
