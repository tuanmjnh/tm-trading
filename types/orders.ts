// types/orders.ts — paper ORDER docs (roadmap v3 §17.2/§26.4) for the API.

export type PaperOrderStatus =
  | 'created'
  | 'riskChecked'
  | 'pending'
  | 'partiallyFilled'
  | 'filled'
  | 'cancelled'
  | 'expired'
  | 'rejected'

export type PaperOrderType = 'market' | 'limit' | 'stop'
export type PaperOrderSide = 'BUY' | 'SELL'

export interface PaperOrderItem {
  id: string
  orderId: string
  clientOrderId: string
  alertKey: string | null
  account: string
  source: string
  symbol: string
  tf: string | null
  side: PaperOrderSide
  type: PaperOrderType
  qty: number
  price: number | null
  sl: number | null
  tps: number[]
  status: PaperOrderStatus
  rejectReason: string | null
  cancelReason: string | null
  cancelBy: string | null
  riskCheckedAt: string | null
  submittedAt: string | null
  filledAt: string | null
  cancelledAt: string | null
  expiredAt: string | null
  fillPrice: number | null
  filledQty: number
  fee: number | null
  slippageBps: number | null
  createdAt: string
  updatedAt: string
  /** true when the order can still be cancelled from the terminal (D14). */
  cancelable: boolean
}

export interface OrdersListMeta {
  total: number
  /** live orders = not yet terminal (riskChecked/pending/partiallyFilled). */
  live: number
  pending: number
  working: number
  partial: number
  filled: number
  cancelled: number
  expired: number
  rejected: number
}

export interface OrdersListResponse {
  success: boolean
  items: PaperOrderItem[]
  meta: OrdersListMeta
  mongo: 'up' | 'down'
}

export interface CancelOrderResult {
  success: boolean
  status: PaperOrderStatus
  alertStatus: string
}