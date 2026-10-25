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
}

export interface SignalsListResponse {
  success: boolean
  data: SignalItem[]
  nextCursor: string | null
  meta: {
    /** So alert khop bo loc (khong phan trang). */
    total: number
    /** 'up' = Mongo san sang; 'down' = khong ket noi duoc (fail-soft, khong 500). */
    mongo: 'up' | 'down'
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
