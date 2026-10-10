// types/fills.ts — paper FILL ledger docs (roadmap v3 §18.5/§18.6/§26.5) for the API.

export interface PaperFillItem {
  id: string
  fillId: string
  orderId: string
  alertKey: string | null
  account: string
  source: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'market' | 'limit' | 'stop'
  /** order intent qty at execution (audit context). */
  qty: number | null
  fillPrice: number | null
  fillQty: number
  feeRateBps: number | null
  feeAmount: number | null
  spreadAbs: number | null
  slippageBps: number | null
  latencyMs: number
  simLatencyMs: number
  signalTime: string | null
  decisionTime: string | null
  eventTime: string | null
  simulateOnly: boolean
  createdAt: string
}

export interface FillsListMeta {
  total: number
  fills: number
  simulated: number
}

export interface FillsListResponse {
  success: boolean
  items: PaperFillItem[]
  meta: FillsListMeta
  mongo: 'up' | 'down'
}