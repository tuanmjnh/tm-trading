import { Types } from 'mongoose'
import { createError } from 'h3'
import type {
  CancelOrderResult,
  PaperOrderItem,
  PaperOrderSide,
  PaperOrderType
} from '../../types/orders'
import { simulationOrder } from './engineModel'
import { engineModel } from './engineModel'

// =============================================================================
//  PAPER ORDERS FOR THE DASHBOARD — engine/models/order.mjs is the single
//  source of truth (D1) for the §17.2 order state machine on the LIVE paper
//  path. READ + CANCEL only: the executor owns every other transition.
//
//  Cancel is the ONE mutation the terminal may drive (D14), and it is guarded
//  at the alert level: only an intent still in 'received'/'working' (engine
//  has not opened a position) may be cancelled — Mongo does the compare-and-
//  swap so a race can never cancel an already-filling order.
// =============================================================================

function toIso(d: unknown): string | null {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString()
  if (d == null) return null
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const SIZEABLE: PaperOrderType[] = ['market', 'limit', 'stop']

// Fallback order states list when simulation/order.mjs has not loaded yet
const FALLBACK_ORDER_STATES = [
  'created', 'riskChecked', 'pending', 'partiallyFilled',
  'filled', 'cancelled', 'expired', 'rejected'
]
const ACTIVE_STATES = ['riskChecked', 'pending', 'partiallyFilled']

function toItem(p: any, states: readonly string[] = FALLBACK_ORDER_STATES): PaperOrderItem {
  const status = states.includes(p.status) ? p.status : 'created'
  return {
    id: String(p._id),
    orderId: p.orderId == null ? String(p._id) : String(p.orderId),
    clientOrderId: String(p.clientOrderId ?? ''),
    alertKey: p.alertKey == null ? null : String(p.alertKey),
    account: String(p.accountId ?? 'default'),
    source: String(p.source ?? 'paper'),
    symbol: String(p.symbol ?? ''),
    tf: p.tf == null ? null : String(p.tf),
    side: (p.side === 'SELL' ? 'SELL' : 'BUY') as PaperOrderSide,
    type: SIZEABLE.includes(p.type) ? p.type : 'market',
    qty: num(p.qty) ?? 0,
    price: num(p.price),
    sl: num(p.sl),
    tps: Array.isArray(p.tps) ? p.tps.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n)) : [],
    status,
    rejectReason: p.rejectReason == null ? null : String(p.rejectReason),
    cancelReason: p.cancelReason == null ? null : String(p.cancelReason),
    cancelBy: p.cancelBy == null ? null : String(p.cancelBy),
    riskCheckedAt: toIso(p.riskCheckedAt),
    submittedAt: toIso(p.submittedAt),
    filledAt: toIso(p.filledAt),
    cancelledAt: toIso(p.cancelledAt),
    expiredAt: toIso(p.expiredAt),
    fillPrice: num(p.fillPrice),
    filledQty: num(p.filledQty) ?? 0,
    fee: num(p.fee),
    slippageBps: num(p.slippageBps),
    createdAt: toIso(p.createdAt) ?? '',
    updatedAt: toIso(p.updatedAt) ?? '',
    cancelable: ACTIVE_STATES.includes(status)
  }
}

export interface ListOrdersQuery {
  limit: number
  cursor?: string
  status?: string
  symbol?: string
}

export interface ListOrdersResult {
  items: PaperOrderItem[]
  meta: {
    total: number
    live: number
    pending: number
    working: number
    partial: number
    filled: number
    cancelled: number
    expired: number
    rejected: number
  }
  mongo: 'up' | 'down'
}

export async function listPaperOrders(q: ListOrdersQuery): Promise<ListOrdersResult> {
  const [PaperOrder, orderSim] = await Promise.all([
    engineModel('order.mjs', 'PaperOrder'),
    simulationOrder(),
  ])
  const states = orderSim?.ORDER_STATES ?? FALLBACK_ORDER_STATES
  const empty = (): ListOrdersResult => ({
    items: [],
    meta: { total: 0, live: 0, pending: 0, working: 0, partial: 0, filled: 0, cancelled: 0, expired: 0, rejected: 0 },
    mongo: 'down'
  })
  if (!PaperOrder) return empty()

  const filter: Record<string, any> = {}
  if (q.status) filter.status = q.status
  if (q.symbol) filter.symbol = q.symbol.toUpperCase()
  if (q.cursor) {
    if (!Types.ObjectId.isValid(q.cursor)) {
      throw createError({ statusCode: 400, statusMessage: 'error.invalidCursor', message: 'cursor khong phai id hop le' })
    }
    filter._id = { $lt: new Types.ObjectId(q.cursor) }
  }
  const countFilter: Record<string, any> = Object.fromEntries(
    Object.entries(filter).filter(([k]) => k !== '_id')
  )

  try {
    const docs = await PaperOrder.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const total = await PaperOrder.countDocuments(countFilter)

    // Header stats are global (not per filter).
    const [live, pending, working, partial, filled, cancelled, expired, rejected] = await Promise.all([
      PaperOrder.countDocuments({ status: { $in: ['riskChecked', 'pending', 'partiallyFilled'] } }),
      PaperOrder.countDocuments({ status: 'pending' }),
      PaperOrder.countDocuments({ status: 'riskChecked' }),
      PaperOrder.countDocuments({ status: 'partiallyFilled' }),
      PaperOrder.countDocuments({ status: 'filled' }),
      PaperOrder.countDocuments({ status: 'cancelled' }),
      PaperOrder.countDocuments({ status: 'expired' }),
      PaperOrder.countDocuments({ status: 'rejected' })
    ])

    return {
      items: docs.map((doc: any) => toItem(doc, states)),
      meta: { total, live, pending, working, partial, filled, cancelled, expired, rejected },
      mongo: 'up'
    }
  } catch {
    return empty()
  }
}

export interface CancelOrderParams {
  alertKey: string
  by?: string
  reason?: string
}

export async function cancelPaperOrder(p: CancelOrderParams): Promise<CancelOrderResult> {
  const PaperOrder = await engineModel('order.mjs', 'PaperOrder')
  const Alert = await engineModel('alert.mjs', 'Alert')
  if (!PaperOrder || !Alert) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — cancel failed' })
  }

  const now = new Date()
  // Compare-and-swap on the ALERT: only intents the engine has not started to
  // execute may be cancelled. cancelledAt carries the by/reason (D14).
  const alerted = await Alert.updateOne(
    { alertKey: p.alertKey, status: { $in: ['received', 'working'] } },
    { $set: { status: 'cancelled', cancelBy: p.by ?? 'terminal', cancelReason: p.reason ?? 'manual' } }
  )
  if (!(alerted.modifiedCount > 0)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'order_not_cancelable',
      message: 'Order is already being filled or has finished — cannot cancel'
    })
  }

  // Mirror onto the order doc. Missing doc (pre-upsert) still counts: the
  // alert stop alone guarantees no fill happens from here on.
  await PaperOrder.updateOne(
    { alertKey: p.alertKey, status: { $in: ['created', 'riskChecked', 'pending', 'partiallyFilled'] } },
    { $set: { status: 'cancelled', cancelBy: p.by ?? 'terminal', cancelReason: p.reason ?? 'manual', cancelledAt: now, updatedAt: now } }
  )

  const order = await PaperOrder.findOne({ alertKey: p.alertKey }).lean().catch(() => null)
  return {
    success: true,
    status: order?.status ?? 'cancelled',
    alertStatus: 'cancelled'
  }
}

export { ACTIVE_STATES, FALLBACK_ORDER_STATES }