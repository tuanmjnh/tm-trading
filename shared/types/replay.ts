// =============================================================================
//  Replay (Phase 7R2) — client mirror of server/utils/replaySessions.ts.
//  Keep shapes in sync with ReplaySummary / ReplayRead there.
// =============================================================================

export type ReplayMode = 'ready' | 'playing' | 'paused' | 'done'

export interface ReplaySummary {
  id: string
  symbol: string
  timeframe: string
  market: string
  interval: string
  total: number
  cursor: number
  mode: ReplayMode
  speed: number
  now: number
  createdAt: string
}

/** Canonical market.candle event — mirror of server/utils/marketRest.ts CandleEvent. */
export interface ReplayCandle {
  type: string
  source: string
  symbol: string
  timeframe: string
  state: 'forming' | 'closed'
  open: number
  high: number
  low: number
  close: number
  volume: number
  openTime: number
  closeTime: number
  eventTime: number
  ingestTime: number
}

export interface ReplayCreateInput {
  symbol?: string
  interval?: string
  limit?: number
  market?: 'spot' | 'futures'
}

// -----------------------------------------------------------------------------
//  Order book (7R2) — mirrors server/utils/replayBroker.ts.
//  The book is in-memory per session; `now`/timestamps are REPLAY-clock ms.
// -----------------------------------------------------------------------------

export type ReplayOrderStatus = 'working' | 'filled' | 'rejected'
export type ReplayOrderType = 'market' | 'limit' | 'stop'

export interface ReplayOrder {
  id: string
  side: 'BUY' | 'SELL'
  type: ReplayOrderType
  price: number
  sl: number
  tps: number[]
  qty: number
  status: ReplayOrderStatus
  rejectReason?: string
  createdAt: number
  filledAt?: number
  fillPrice?: number
  fee?: number
  positionId?: string
}

export interface ReplayPosition {
  id: string
  orderId: string
  account: string
  source: 'replay'
  symbol: string
  tf: string
  dir: 1 | -1
  qty: number
  entryPrice: number
  sl: number | null
  tps: number[]
  status: 'open' | 'closed'
  fees: number
  orderType: ReplayOrderType
  slippageBps: number | null
  alertKey: null
  externalId: string
  entryTime: number
  exitTime?: number
  exitPrice?: number
  exitReason?: string
  pnlAbs?: number
  pnlPct?: number
  lastScanMs: number
}

/** POST /api/v1/replay/sessions/:id/orders request body (validateTicket shape). */
export interface ReplayOrderInput {
  symbol?: string
  tf?: string
  side: 'BUY' | 'SELL'
  type?: ReplayOrderType
  price: number
  sl: number
  tps: number[]
  conf?: number
}

export interface ReplaySummaryResponse {
  success: boolean
  data: ReplaySummary
}

/** read() and step() return the session plus the NEWLY played events. */
export interface ReplayReadResponse {
  success: boolean
  data: {
    session: ReplaySummary
    events: ReplayCandle[]
    orders: ReplayOrder[]
    positions: ReplayPosition[]
  }
}

/** placeOrder() returns the queued/filled order and the fresh summary. */
export interface ReplayPlaceOrderResponse {
  success: boolean
  data: {
    order: ReplayOrder
    session: ReplaySummary
  }
}
