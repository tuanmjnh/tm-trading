// =============================================================================
//  Central trade journal (roadmap Phase 13) — read model for the dashboard.
//
//  Source of truth: engine/journal.mjs (Mongo `journal` collection when it is
//  reachable, NDJSON mirror reports/journal.ndjson otherwise). The dashboard
//  only READS and formats: no metric is recalculated in the UI (D1).
// =============================================================================

export type JournalResult = 'TP' | 'SL' | 'TIME' | 'OPEN' | 'unknown'

/** One executed-trade journal row (engine `normalizeEntry()` output). */
export interface JournalEntry {
  schema: number
  /** Journal identity derived from account + source + externalId/_id (D3/D4). */
  key: string
  source: string
  account: string
  sourceId: string | null
  symbol: string
  tf: string
  /** 1 = long, -1 = short. */
  dir: 1 | -1
  entryPrice: number | null
  exitPrice: number | null
  sl: number | null
  tps: number[]
  qty: number | null
  result: JournalResult
  rMultiple: number | null
  pnlAbs: number | null
  pnlPct: number | null
  /** null = unknown (never 0 by default — paper fills are fee-free BY DESIGN). */
  fees: number | null
  method: string
  regime: string
  engineVersion: string
  paramsHash: string
  status: string
  /** ISO-8601 UTC (D2). */
  entryTime: string
  exitTime: string | null
  recordedAt: string
  signalKey: string | null
  /** Tags that could not be derived — recorded as `unknown`, never guessed. */
  unknown: string[]
}

/** R-set metrics straight from engine `journalStats()` (D12 gate included). */
export interface JournalStats {
  n: number
  closed: number
  open: number
  /** Closed rows whose R could be derived. */
  rSamples: number
  rMissing: number
  wins: number
  losses: number
  flat: number
  winRate: number | null
  expectancyR: number | null
  medianR: number | null
  sumR: number | null
  /** Infinity (grossLoss = 0) becomes null after JSON. */
  profitFactorR: number | null
  unknownTagCounts: Record<string, number>
  minTrades: number
  /** true = below MIN_TRADES_FOR_EVIDENCE: an observation, not a verdict. */
  insufficient: boolean
  insufficientReason: string | null
}

export interface JournalListResponse {
  success: boolean
  data: JournalEntry[]
  nextCursor: string | null
  /** Metrics over the WHOLE filtered set, not just the current page. */
  stats: JournalStats
  meta: {
    total: number
    /** 'mongo' = live collection; 'ndjson' = file mirror (Mongo unreachable). */
    source: 'mongo' | 'ndjson' | 'none'
    warnings: string[]
    filters: Record<string, string>
  }
}
