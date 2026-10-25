// types/paper.ts — Paper Trading API types (roadmap §30.5)

export interface PaperAccountSummary {
  accountId: string
  currency: string
  mode: 'LIVE_PAPER' | 'REPLAY'
  initialBalance: number
  createdAt: string
  updatedAt: string
}

export interface PaperAccountDetail extends Omit<PaperAccountSummary, 'createdAt' | 'updatedAt'> {
  equity: number
  notional: number | null
  marginUsed: number
  freeMargin: number
  utilizationPct: number
  unrealized: number | null
  maintenance: number
  liquidated: boolean
  openPositions: number
  mode: 'LIVE_PAPER' | 'REPLAY'
  currency: string
  initialBalance: number
  balance: number
  realizedPnl: number | null
  availableBalance: number
  dailyPnl: number
  maxDrawdown: number
  maxDrawdownPct: number | null
  drawdownBasis: 'realized'
  createdAt: string | null
  updatedAt: number
}

export interface PaperAccountsListResponse {
  success: boolean
  data: PaperAccountSummary[]
  meta: { count: number; mongo: 'up' | 'down' }
}

export interface PaperAccountDetailResponse {
  success: boolean
  data: PaperAccountDetail | null
  meta: { mongo: 'up' | 'down' }
}

// Paper orders types are in types/orders.ts

// Paper positions types are in types/positions.ts

// Paper fills types are in types/fills.ts

export interface PaperPositionCloseRequest {
  reason?: string
}

export interface PaperPositionCloseResponse {
  success: boolean
  data?: { positionId: string; closed: boolean }
  error?: string
}

export interface PaperPositionRiskPatchRequest {
  sl?: number | null
  tps?: number[] | null
}

export interface PaperPositionRiskPatchResponse {
  success: boolean
  data?: { positionId: string; sl: number | null; tps: number[] }
  error?: string
}

export interface PaperOrderCreateRequest {
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'market' | 'limit' | 'stop'
  qty: number
  price?: number
  sl?: number | null
  tps?: number[] | null
  tf?: string | null
}

export interface PaperOrderCreateResponse {
  success: boolean
  data?: { orderId: string; clientOrderId: string }
  error?: string
}