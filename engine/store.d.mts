/**
 * Khai bao types cho `engine/store.mjs` khi duoc import tu TypeScript (server/).
 *
 * TypeScript khong doc duoc file .mjs -> phai co .d.mts dung ten (TS tim
 * `store.d.mts` cho specifier `./store.mjs`). Chi khai nhung ham server GOI;
 * khi doi ham/return trong store.mjs, dong bo lai file nay.
 */

export interface EngineRun {
  params: Record<string, unknown>
  symbol: string
  tf: string
  market?: string
  source?: string
  fetchedAt?: string
  dataFromCache?: boolean
  variant?: string | null
  method?: string
  preset?: string | null
  sub1mUsed?: boolean
  engineVersion: string
  paramsHash: string
  dataHash: string
  universeSnapshot?: unknown
  gitRev?: string | null
  createdAt: string
}

export interface EngineTrade {
  symbol: string
  tf: string
  method?: string
  dir: number
  entryTime: string
  entryPrice: number
  exitTime?: string | null
  exitPrice?: number | null
  sl?: number
  tp?: number
  result: string
  barsHeld?: number
  pnlPct?: number
  rMultiple?: number
  resolvedBy1m?: boolean | null
  runId?: string | null
  paramsHash: string
  engineVersion: string
}

export interface EngineRunSummary {
  generations: string[]
  engineVersion: string
  paramsHash: string
  params: Record<string, unknown> | null
  runs: number
  trades: number
  open: number
  wins: number
  losses: number
  winRate: number
  /** Co the la Infinity (grossLoss = 0) - JSON khong dai dien duoc, phai sanitize truoc khi tra API. */
  profitFactor: number
  netPct: number
  maxDrawdownPct: number
  avgRr: number
  expectancy: number
  medianRr: number
  degenerateRisk: number
}

export declare const RUNS_FILE: string
export declare const TRADES_FILE: string

export declare function readNdjson<T = unknown>(file: string): { rows: T[], skipped: number }
export declare function generationKey(run: { engineVersion?: string, paramsHash?: string }): string
export declare function groupByGeneration<T extends { engineVersion?: string, paramsHash?: string }>(runs: T[]): Map<string, T[]>
export declare function summarizeRuns(
  runs: Array<{ engineVersion?: string, paramsHash?: string, params?: Record<string, unknown>, trades?: EngineTrade[] }>,
  opts?: { label?: string }
): EngineRunSummary
export declare function loadRuns(file?: string): EngineRun[]
