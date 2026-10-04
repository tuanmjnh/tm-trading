import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EngineRun, EngineRunSummary, EngineTrade } from '../../engine/store.mjs'
import type { EquityPoint, RunSeries, RunSeriesDetail, RunSummary, RunTrade, RunWarning } from '../../types/runs'

// =============================================================================
//  DOC KET QUA BACKTEST CHO DASHBOARD (roadmap Phase 7, D1)
//
//  Chi DOC reports/*.ndjson (khong ghi, khong chay engine). Tat ca so lieu qua
//  `summarizeRuns()` cua chinh engine - khong tinh lai cong thuc nao (D1).
//
//  Khoa series: engineVersion + paramsHash + symbol + tf + market - xem
//  giua `types/runs.ts` (paramsHash KHONG gom symbol, dung no don le se tron).
// =============================================================================

type EngineStore = typeof import('../../engine/store.mjs')

/**
 * Import `engine/store.mjs` tai RUNTIME.
 *
 * Tai sao khong `import ... from '../../engine/store.mjs'` nhu binh thuong:
 * Nitro dev ghi bundle thanh `.nuxt/dev/index.mjs` va TINH SAI do sau cua duong
 * dan tuong doi (thanh `../../../../../../engine/store.mjs` -> `D:\engine\...`)
 * vi file engine nam NGOAI thu muc `server/` -> moi request 500
 * `Cannot find module`. Import runtime dua duong dan tot (tu process.cwd())
 * vao Node truc tiep, khong qua rollup nen khong bi tinh lai.
 * (cung canh bao Windows ESM nhu `nitro.externals.inline: ['xlsx']` o nuxt.config)
 */
let engineStorePromise: Promise<EngineStore> | null = null
function engineStore(): Promise<EngineStore> {
  if (!engineStorePromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'store.mjs')).href
    engineStorePromise = import(/* @vite-ignore */ file) as Promise<EngineStore>
  }
  return engineStorePromise
}

/** reports/ giua cung thu muc goc project (env cho phep doi khi build/dock). */
export function reportsDir(): string {
  return process.env.REPORTS_DIR || join(process.cwd(), 'reports')
}

interface ReadReport<T> {
  rows: T[]
  missing: boolean
  skipped: number
}

async function readReport<T>(name: string): Promise<ReadReport<T>> {
  const file = join(reportsDir(), name)
  if (!existsSync(file)) return { rows: [], missing: true, skipped: 0 }
  const { readNdjson } = await engineStore()
  const { rows, skipped } = readNdjson<T>(file)
  return { rows, missing: false, skipped }
}

/** Khoa series - dung cho CA run va trade (trade cung co 4 truong nay). */
export function buildSeriesId(k: { engineVersion?: string, paramsHash?: string, symbol?: string, tf?: string }): string {
  return `${k.engineVersion ?? '?'}~${encodeURIComponent(k.symbol ?? '?')}~${k.tf ?? '?'}~${k.paramsHash ?? '?'}`
}

const seriesKey = buildSeriesId

export function parseSeriesId(id: string): { engineVersion: string, symbol: string, tf: string, paramsHash: string } | null {
  const parts = id.split('~')
  if (parts.length !== 4) return null
  const [engineVersion, symbol, tf, paramsHash] = parts as [string, string, string, string]
  if (!engineVersion || !symbol || !tf || !paramsHash) return null
  try {
    return { engineVersion, symbol: decodeURIComponent(symbol), tf, paramsHash }
  } catch {
    return null
  }
}

/** Khoa khui trung: truong nao anh huong ket qua lenh thi deu nam day. */
function tradeKey(t: EngineTrade): string {
  return JSON.stringify([
    t.entryTime, t.entryPrice, t.dir, t.result,
    t.exitTime ?? null, t.exitPrice ?? null, t.rMultiple ?? null
  ])
}

/** Engine tra profitFactor = Infinity (khong co lenh lo) -> JSON khong dua duoc, dat null. */
function toSummary(s: EngineRunSummary, runs: number): RunSummary {
  return {
    runs,
    trades: s.trades,
    open: s.open,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null,
    netPct: s.netPct,
    maxDrawdownPct: s.maxDrawdownPct,
    avgRr: s.avgRr,
    expectancy: s.expectancy,
    medianRr: s.medianRr,
    degenerateRisk: s.degenerateRisk
  }
}

/**
 * Equity tich luy % von - PHAI goi voi THU TU lenh nhu engine da ghi
 * (thu tu file = lenh dong tien vi backtest di lenh theo bar). Day chinh la
 * vong lap cua `summarizeRuns()` (engine/store.mjs ~dong 268) nhung tra ve
 * tung diem thay vi chi tinh dam. Cung ket qua: `eq[eq.length-1] === netPct`
 * va dam/tham cua day === maxDrawdownPct (co test khoa).
 *
 * Lenh OPEN bi bo qua - giong `closed` cua engine (khong tinh vao equity).
 */
export function equityFromTrades(trades: Array<Pick<EngineTrade, 'result' | 'pnlPct' | 'exitTime' | 'entryTime'>>): EquityPoint[] {
  const out: EquityPoint[] = []
  let eq = 0
  for (const t of trades) {
    if (t.result === 'OPEN') continue
    eq += t.pnlPct ?? 0
    out.push({ t: t.exitTime ?? t.entryTime, v: eq })
  }
  return out
}

export interface LoadRunsResult {
  series: RunSeriesDetail[]
  filesMissing: boolean
  skippedRuns: number
  skippedTrades: number
}

export async function loadRunSeries(): Promise<LoadRunsResult> {
  const [runsFile, tradesFile] = await Promise.all([
    readReport<EngineRun>('runs.ndjson'),
    readReport<EngineTrade>('trades.ndjson')
  ])
  const { summarizeRuns } = await engineStore()

  const tradesBySeries = new Map<string, EngineTrade[]>()
  for (const t of tradesFile.rows) {
    const key = seriesKey(t)
    const list = tradesBySeries.get(key)
    if (list) list.push(t)
    else tradesBySeries.set(key, [t])
  }

  const runsBySeries = new Map<string, EngineRun[]>()
  for (const r of runsFile.rows) {
    const key = seriesKey(r)
    const list = runsBySeries.get(key)
    if (list) list.push(r)
    else runsBySeries.set(key, [r])
  }

  const out: RunSeriesDetail[] = []
  for (const [id, group] of runsBySeries) {
    const rep = group[0]
    if (!rep) continue

    // Khui trung: nhieu lan chay cung tham so tren cache ghi lai cung mot lenh
    // nhieu lan. Lay mot bo unique - khong thi net%/WR bi nhan so lan chay.
    const rawTrades = tradesBySeries.get(id) ?? []
    const seen = new Set<string>()
    const trades: EngineTrade[] = []
    for (const t of rawTrades) {
      const k = tradeKey(t)
      if (seen.has(k)) continue
      seen.add(k)
      trades.push(t)
    }
    const duplicateTrades = rawTrades.length - trades.length

    const dataHashes = [...new Set(group.map(r => r.dataHash).filter(Boolean))]
    const gitRevs = [...new Set(group.map(r => r.gitRev).filter((v): v is string => !!v))]
    const times = group.map(r => r.createdAt).filter(Boolean).sort()

    const warnings: RunWarning[] = []
    if (group.length > 1) warnings.push('multipleRuns')
    if (duplicateTrades > 0) warnings.push('duplicatesRemoved')
    if (dataHashes.length > 1) warnings.push('multipleDataHashes')

    // 1 run dai dien + 1 bo trades da khui trung -> summarizeRuns khong the
    // tron the he nao duoc (chi 1 khoa), cong thuc van la cua engine.
    const summary = toSummary(summarizeRuns([{ ...rep, trades }], { label: 'dashboard' }), group.length)

    // Equity truoc khi sort hien thi (thu tu goc = thu tu engine ghi),
    // con `trades` duoi day se bi dao nguoc de hien thi moi nhat truoc.
    const equity = equityFromTrades(trades)

    out.push({
      id,
      engineVersion: rep.engineVersion,
      paramsHash: rep.paramsHash,
      symbol: rep.symbol,
      tf: rep.tf,
      market: rep.market ?? '',
      method: rep.method ?? '',
      preset: rep.preset ?? null,
      firstRunAt: times[0] ?? rep.createdAt,
      lastRunAt: times[times.length - 1] ?? rep.createdAt,
      dataHashCount: dataHashes.length,
      gitRev: gitRevs[0] ?? null,
      rawTrades: rawTrades.length,
      duplicateTrades,
      warnings,
      summary,
      params: rep.params ?? {},
      dataHashes,
      gitRevs,
      equity,
      trades: trades
        .map(t => sanitizeTrade(t))
        .sort((a, b) => (a.entryTime < b.entryTime ? 1 : a.entryTime > b.entryTime ? -1 : 0))
    })
  }

  out.sort((a, b) => (a.lastRunAt < b.lastRunAt ? 1 : a.lastRunAt > b.lastRunAt ? -1 : 0))

  return {
    series: out,
    filesMissing: runsFile.missing && tradesFile.missing,
    skippedRuns: runsFile.skipped,
    skippedTrades: tradesFile.skipped
  }
}

function sanitizeTrade(t: EngineTrade): RunTrade {
  return {
    dir: t.dir,
    entryTime: t.entryTime,
    entryPrice: t.entryPrice,
    exitTime: t.exitTime ?? null,
    exitPrice: t.exitPrice ?? null,
    sl: t.sl,
    tp: t.tp,
    result: t.result,
    barsHeld: t.barsHeld,
    pnlPct: t.pnlPct,
    rMultiple: t.rMultiple,
    resolvedBy1m: t.resolvedBy1m ?? null
  }
}

/** List chua thong tin tong quat - bo khoi canh (params/trades/equity co the rat lon). */
export function toSeriesListItem(s: RunSeriesDetail): RunSeries {
  const { params: _params, trades: _trades, dataHashes: _dataHashes, gitRevs: _gitRevs, equity: _equity, ...rest } = s
  return rest
}
