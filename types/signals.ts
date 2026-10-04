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
