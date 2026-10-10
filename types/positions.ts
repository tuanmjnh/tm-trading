// =============================================================================
//  Live/executed positions (collection `positions`, engine/models/position.mjs)
//  — read model for the dashboard (roadmap V2 Execution section).
//
//  The engine owns the data (D1): the dashboard only READS and formats.
//  Mongo down -> empty list + meta.mongo='down' (fail-soft, never 500).
// =============================================================================

export interface PositionItem {
  id: string
  account: string
  /** paper | mt5 | exchange | manual. */
  source: string
  externalId: string | null
  symbol: string
  /** 1 = long, -1 = short. */
  dir: 1 | -1
  qty: number
  entryPrice: number
  /** ISO-8601 UTC (D2). */
  entryTime: string
  sl: number | null
  tps: number[]
  exitPrice: number | null
  exitTime: string | null
  /** open | closed | cancelled. */
  status: string
  pnlPct: number | null
  pnlAbs: number | null
  method: string | null
  signalKey: string | null
  tf: string | null
  exitReason: string | null
  /** null = unknown (never 0 by default). */
  fees: number | null
  /** Version stamp (docs/data-model.md §10.3): 'declared' | 'unknown'. */
  stampKind: string
  stampParamsHash: string | null
  stampEngineVersion: string | null
  updatedAt: string
  /**
   * Live numbers (roadmap v3 §19), server-computed off the current market
   * plane quote + the stored doc through the simulation core (D21/D25).
   * Present on OPEN rows; every field null when no usable quote exists —
   * never a fabricated number (D12).
   */
  live?: LivePositionFields | null
}

/**
 * Per-open-position live fields (v3 §19). All null = no quote / not computable:
 * LONG marks at the bid, SHORT at the ask (exit side of the book).
 */
export interface LivePositionFields {
  mark: number | null
  /** Net unrealized PnL (gross − entry fees), currency-agnostic. */
  unrealized: number | null
  unrealizedPct: number | null
  /** Isolated liquidation price (LONG below, SHORT above entry). */
  liqPrice: number | null
  /** Initial margin locked by this position. */
  marginUsed: number | null
  /** Implied leverage = 100 / initialMarginPct (e.g. 20% -> 5x). */
  leverage: number | null
}

/**
 * Account portrait (v3 §20) derived from the OPEN positions + live quotes:
 * locked initial margin, free margin, utilization, net unrealized, and the
 * maintenance floor (cross-style liquidation check).
 */
export interface LiveAccount {
  /** Declared/config equity seed from the risk gate (D12 baseline). */
  equity: number
  /** Sum of entry notional over usable open positions, or null. */
  notional: number | null
  marginUsed: number
  freeMargin: number
  utilizationPct: number
  /** Net unrealized over quoted open positions; null when none computable. */
  unrealized: number | null
  maintenance: number
  liquidated: boolean
  openPositions: number
  // ---- PERSISTENT PAPER ACCOUNT (roadmap v3 §20), server projection extras --
  accountId?: string
  mode?: 'LIVE_PAPER' | 'REPLAY'
  currency?: string
  /** Seed frozen by the executor at first activity. */
  initialBalance?: number
  /** initialBalance + realizedPnl (read-derived, not a second ledger). */
  balance?: number
  /** Sum of closed position pnlAbs (fee-NET), or null when nothing closed. */
  realizedPnl?: number | null
  /** Free margin (read-derived alias of freeMargin). */
  availableBalance?: number
  /** Realized on the current UTC business day (D2). */
  dailyPnl?: number
  /** Peak-to-trough of the REALIZED equity curve (exact, D12). */
  maxDrawdown?: number
  maxDrawdownPct?: number | null
  drawdownBasis?: 'realized'
  createdAt?: string | null
  updatedAt?: number
}

export interface PositionsListResponse {
  success: boolean
  data: PositionItem[]
  nextCursor: string | null
  meta: {
    /** Rows matching the filter (not paginated). */
    total: number
    /** Open positions across ALL accounts (header stat). */
    open: number
    closed: number
    /** Sum of pnlAbs over closed rows that HAVE a pnl (nulls excluded). */
    realizedPnlAbs: number | null
    mongo: 'up' | 'down'
    /** Account portrait (v3 §20) when a quote exists for at least one symbol. */
    account?: LiveAccount | null
  }
}
