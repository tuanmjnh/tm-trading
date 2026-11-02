// =============================================================================
//  Tin hieu webhook (collection `alerts` — dedupe ben vung D4).
//
//  Nguon: server/webhook.mjs `toAlertDoc()` map payload TradingView -> document.
//  Dashboard chi DOC (khong tinh lai), ts luon ISO-8601 UTC (D2).
// =============================================================================

export interface SignalItem {
  id: string
  /** ISO-8601 UTC — luc alert den (D2, khong gio dia phuong). */
  ts: string
  source: string
  symbol: string | null
  tf: string | null
  mode: string | null
  action: string | null
  level: number | null
  side: string | null
  price: number | null
  sl: number | null
  tps: number[]
  atr: number | null
  conf: number | null
  /** received | rejected | forwarded */
  status: string
  rejectReason: string
  /**
   * Lifecycle overlay (S8 chunk 4). Defaults to `active` for every stored
   * webhook row — the legacy `status` field is untouched. Read-only: the
   * transitions are enforced server-side (server/utils/signalLifecycle.ts).
   */
  lifecycleStatus: string
  /** ISO-8601 UTC — when the lifecycle last changed (empty string = never). */
  lifecycleAt: string
  /** Optional human-readable note for the last lifecycle transition. */
  lifecycleNote: string
  /**
   * ISO-8601 UTC — the signal's documented horizon (D2). A signal past this
   * timestamp is a candidate for `expired`; the field is immutable once written
   * (S8 chunk 5). null = no horizon could be derived (unknown tf).
   */
  expiresAt: string | null
  /** The hold window the horizon was computed from (Pine `tm_maxHoldBars`, default
   * 300). null = the alert predates the horizon rule. */
  maxHoldBars: number | null
}

/**
 * Lifecycle filter for `listSignals`. The overlay is additive over the legacy
 * `status` field, and legacy rows store `lifecycleStatus: null`, so filtering
 * `active` must match `{ $in: ['active', null] }` — see server/utils/signals.ts.
 */
export type SignalLifecycleFilter = 'all' | 'active' | 'intrabar' | 'closed' | 'expired'

/**
 * Mode filter for `listSignals`. `mode` is the TradingView chart mode field
 * (`closed` = only closed bars, `live` = realtime repaint). Default is
 * `closed` (CLOSE_ONLY) — the engine only trusts closed bars.
 */
export type SignalModeFilter = 'all' | 'closed' | 'live' | 'intrabar'

export interface SignalsListResponse {
  success: boolean
  data: SignalItem[]
  nextCursor: string | null
  meta: {
    /** So alert khop bo loc (khong phan trang). */
    total: number
    /** 'up' = Mongo san sang; 'down' = khong ket noi duoc (fail-soft, khong 500). */
    mongo: 'up' | 'down'
    /** S8 chunk 5: the chart-mode filter applied (default `closed` — CLOSE_ONLY). */
    mode?: SignalModeFilter
  }
}

// =============================================================================
//  Native signals (collection `signals` — roadmap §61.17 Phase D).
//
//  Produced by engine/signalEngine.mjs and persisted by services/signalStore.mjs
//  with full attribution. This is the REPLACEMENT read path for the TradingView
//  webhook (`alerts` above, kept for historical records). `ts` is ISO-8601 UTC.
// =============================================================================

export interface NativeSignalAttribution {
  method: string
  methodVersion: string
  strategyVersion: string
  engineVersion: string
  paramsHash: string
  indicatorRefs: { id: string, version: string }[]
}

export interface NativeSignalItem {
  id: string
  /** ISO-8601 UTC (D2). */
  ts: string
  symbol: string | null
  tf: string | null
  /** SV | BC | ST LONG | ST SHORT | NS | ND | EoM */
  type: string
  price: number | null
  method: string
  signalKey: string
  schemaVersion: string | null
  accountId: string | null
  /** Full attribution; null only on legacy rows (which this endpoint excludes). */
  attribution: NativeSignalAttribution | null
  meta: Record<string, unknown> | null
  /**
   * Lifecycle overlay (S8 chunk 4). Defaults to `active` for every stored
   * native row. Read-only: transitions are enforced server-side.
   */
  lifecycleStatus: string
  /** ISO-8601 UTC — when the lifecycle last changed (empty string = never). */
  lifecycleAt: string
  /** Optional note for the last lifecycle transition. */
  lifecycleNote: string
  /**
   * ISO-8601 UTC — the signal's horizon (D2). A signal past this timestamp is
   * a candidate for `expired`; the field is immutable once written.
   */
  expiresAt: string | null
}

export interface NativeSignalsListResponse {
  success: boolean
  data: NativeSignalItem[]
  nextCursor: string | null
  meta: {
    /** So tin hieu engine khop bo loc (khong phan trang). */
    total: number
    mongo: 'up' | 'down'
  }
}
