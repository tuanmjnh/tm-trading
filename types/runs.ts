/**
 * Type chung cho dashboard Backtest Runs (roadmap Phase 7, D1 + D10).
 *
 * Nguon du lieu: `reports/runs.ndjson` + `reports/trades.ndjson` (engine ghi).
 * Dung boi ca server (Nitro /api/v1/runs) lan app (pages/runs, pages/index).
 *
 * ===========================================================================
 *  KHOA THE HE (quan trong - khong thieu chung se TRON du lieu):
 *
 *  `paramsHash` chi hash bo `params` (xem engine/version.mjs `paramsHash()`),
 *  KHONG gom symbol/tf/market. Trong reports/ hien tai ca 11 series deu co
 *  cung mot paramsHash `87ad386c...` -> khong the dung `paramsHash` (hay
 *  `generationKey()` cua engine) lam khoa hien thi.
 *
 *  => Khoa cua dashboard = `engineVersion + paramsHash + symbol + tf (+ market)`.
 *  Trades cung vay: ghi `paramsHash` + symbol/tf, phai gom theo day, khong
 *  dung `paramsHash` don le (se tron BTC voi ETH cung tham so).
 *
 *  NDJSON khong luu `runId` (store.mjs ghi `runId: null`) -> khong tach duoc
 *  trades cua tung lan chay. Nhieu lan chay cung bo tham so + cung cache =
 *  lenh TRUNG NHAU (Btc 15m: 626 dong - 121 lenh unique). Dashboard khui trung
 *  theo noi dung va canh bao, khong im lang cong (xem `duplicateTrades`).
 * ===========================================================================
 */

export type RunWarning =
  /** Nhieu lan chay cung bo tham so (binh thuong, chi la thong tin). */
  | 'multipleRuns'
  /** Co lenh trung noi dung da bi bo qua khi tong hop. */
  | 'duplicatesRemoved'
  /** Nhieu dataHash trong mot series -> trades co the la union nhieu phien ban du lieu. */
  | 'multipleDataHashes'

export interface RunSummary {
  runs: number
  trades: number
  open: number
  wins: number
  losses: number
  winRate: number
  /** `null` = Infinity (khong co lenh lo) - JSON khong co Infinity. */
  profitFactor: number | null
  /** TONG pnlPct cac lenh (khong compounding) - giong tieu de truong trong engine. */
  netPct: number
  maxDrawdownPct: number
  avgRr: number
  expectancy: number
  medianRr: number
  /** So lenh co risk/entry < 0.1% -> R qua nhay (canh bao, khong loai). */
  degenerateRisk: number
}

/** Mot "series" = mot bo tham so tren dung symbol x TF (xem khoa o dau file). */
export interface RunSeries {
  id: string
  engineVersion: string
  paramsHash: string
  symbol: string
  tf: string
  market: string
  method: string
  preset: string | null
  /** Lan chay dau tien / moi nhat (UTC ISO). */
  firstRunAt: string
  lastRunAt: string
  /** So dataHash khac nhau (1 = du lieu on dinh, >1 -> canh bao). */
  dataHashCount: number
  gitRev: string | null
  /** So dong trades trong file truoc khi khui trung. */
  rawTrades: number
  duplicateTrades: number
  warnings: RunWarning[]
  summary: RunSummary
}

export interface RunTrade {
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
}

/**
 * 1 diem tren duong equity (Phase 7).
 *
 * `t` = exitTime (thoi diem lenh dong -> equity cap nhat), `v` = pnlPct tich
 * lay DUOC SAU lenh nay (bat dau tu 0 truoc lenh dau tien). Vong lap GIONG
 * `summarizeRuns()` (engine/store.mjs) - chi khac o viec tra ve tung diem de
 * ve do. Co test khoa su nhat quan: diem cuoi == summary.netPct,
 * dam/tham cua curve == summary.maxDrawdownPct (tests/equity.test.ts).
 */
export interface EquityPoint {
  t: string
  v: number
}

export interface RunSeriesDetail extends RunSeries {
  /** Bo tham so day du (D1: chi ton tai cai khop paramsHash). */
  params: Record<string, unknown>
  dataHashes: string[]
  gitRevs: string[]
  /** Da khui trung, sap xep moi nhat truoc. */
  trades: RunTrade[]
  /** Duong equity tich luy theo thu tu lenh dong (chi co trong chi tiet). */
  equity: EquityPoint[]
}

export interface RunsListResponse {
  success: boolean
  data: RunSeries[]
  nextCursor: string | null
  meta: {
    total: number
    filesMissing: boolean
    skippedRuns: number
    skippedTrades: number
  }
}

// =============================================================================
//  Test Builder launch (roadmap §58.9 Slice 3) — POST /api/v1/runs.
//
//  Launches ONE engine backtest through `engine/run.mjs runOne`; that call
//  persists the run with the full D1 stamp (engineVersion/paramsHash/dataHash/
//  gitRev) into reports/*.ndjson (what Historical Runs reads) and, if Mongo is
//  up, the `runs` collection. The response echoes the identity so the UI can
//  deep-link straight into /test-center/runs/:seriesId — never a fabricated
//  result (D12).
// =============================================================================

export interface TestRunRequest {
  method?: string
  symbol: string
  tf: string
  market?: 'fapi' | 'spot'
  limit?: number
  preset?: string
  params?: Record<string, unknown>
  refresh?: boolean
}

export interface TestRunResult {
  symbol: string
  tf: string
  market: string
  method: string
  preset: string | null
  engineVersion: string
  paramsHash: string
  /** Mongo `_id` when the run was also persisted there; null for NDJSON-only. */
  runId: string | null
  bars: number
  source: string
  warnings: string[]
  /** Dashboard series key — pivot into /test-center/runs/:id. */
  seriesId: string
  /** Engine `summarizeBacktest()` block (trades/winRate/netPct/maxDrawdownPct...). */
  stats: Record<string, unknown>
}

export interface TestRunResponse {
  success: boolean
  data: TestRunResult
}
