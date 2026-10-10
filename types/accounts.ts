// =============================================================================
//  Accounts view for the dashboard (roadmap V2 Execution section).
//
//  Derived READ-ONLY from what the engine stores — no new source of truth:
//    positions  -> per-account activity (open/closed/cancelled, realized PnL,
//                  sources in use, first/last activity)
//    equity     -> latest snapshot per account IF a writer exists (today only
//                  tests write it — null means "no snapshot", never 0)
// =============================================================================

export interface AccountItem {
  account: string
  /** Execution sources seen for this account (paper|mt5|exchange|manual). */
  sources: string[]
  open: number
  closed: number
  cancelled: number
  /** Sum of pnlAbs over closed rows that HAVE a pnl — null = nothing to sum. */
  realizedPnlAbs: number | null
  /** ISO of the newest position activity (entry/exit), null = none. */
  lastActivityAt: string | null
  firstEntryAt: string | null
  /** Latest `equity` snapshot (null when the collection is empty — honest). */
  latestEquity: number | null
  latestEquityAt: string | null
}
