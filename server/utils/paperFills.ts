import { Types } from 'mongoose'
import type { PaperFillItem } from '../../types/fills'
import { engineModel } from './engineModel'

// =============================================================================
//  FILL LEDGER FOR THE DASHBOARD — engine/models/fill.mjs rows (v3 §26.5) are
//  append-only execution facts recorded by the executor. READ ONLY here (the
//  terminal is a viewer of execution quality — latency/spread/slippage/fee —
//  never the writer). Mongo down -> empty + mongo='down' (fail-soft).
// =============================================================================

function toIso(d: unknown): string | null {
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function toFillItem(f: any): PaperFillItem {
  const side = f.side === 'SELL' ? 'SELL' as const : 'BUY' as const
  const type = ['market', 'limit', 'stop'].includes(f.type)
    ? (f.type as PaperFillItem['type'])
    : 'market' as const
  return {
    id: String(f._id),
    fillId: String(f.fillId ?? ''),
    orderId: String(f.orderId ?? ''),
    alertKey: f.alertKey == null ? null : String(f.alertKey),
    sessionId: f.sessionId == null ? null : String(f.sessionId),
    account: String(f.accountId ?? 'default'),
    source: String(f.source ?? 'paper'),
    symbol: String(f.symbol ?? ''),
    side,
    type,
    qty: num(f.qty),
    fillPrice: num(f.fillPrice),
    fillQty: num(f.fillQty) ?? 0,
    feeRateBps: num(f.feeRateBps),
    feeAmount: num(f.feeAmount),
    spreadAbs: num(f.spreadAbs),
    slippageBps: num(f.slippageBps),
    latencyMs: num(f.latencyMs) ?? 0,
    simLatencyMs: num(f.simLatencyMs) ?? 0,
    signalTime: f.signalTime == null ? null : toIso(f.signalTime),
    decisionTime: f.decisionTime == null ? null : toIso(f.decisionTime),
    eventTime: f.eventTime == null ? null : toIso(f.eventTime),
    simulateOnly: f.simulateOnly === true,
    createdAt: toIso(f.createdAt) ?? ''
  }
}

export interface ListFillsQuery {
  limit: number
  /**
   * Tenancy (docs/web-app/user-tenancy-plan.md): hub user id (`sub`) that owns
   * the fills. Required — an unscoped read would leak another account's ledger.
   */
  ownerId: string
  cursor?: string
  symbol?: string
  orderId?: string
  sessionId?: string
  /** Narrow to one sub-book (account switcher, §61.17 Phase B). */
  account?: string
}

export interface ListFillsResult {
  items: PaperFillItem[]
  meta: { total: number; fills: number; simulated: number }
  mongo: 'up' | 'down'
}

export async function listPaperFills(q: ListFillsQuery): Promise<ListFillsResult> {
  const PaperFill = await engineModel('fill.mjs', 'PaperFill')
  const empty = (): ListFillsResult => ({
    items: [],
    meta: { total: 0, fills: 0, simulated: 0 },
    mongo: 'down'
  })
  if (!PaperFill) return empty()

  const filter: Record<string, any> = { ownerId: q.ownerId }
  if (q.symbol) filter.symbol = q.symbol.toUpperCase()
  if (q.orderId) filter.orderId = q.orderId
  if (q.sessionId) filter.sessionId = q.sessionId
  if (q.account) filter.accountId = q.account
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
    const docs = await PaperFill.find(filter)
      .sort({ eventTime: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const total = await PaperFill.countDocuments(countFilter)
    const [fills, simulated] = await Promise.all([
      PaperFill.countDocuments({ ownerId: q.ownerId }),
      PaperFill.countDocuments({ ownerId: q.ownerId, simulateOnly: true })
    ])
    return {
      items: docs.map(toFillItem),
      meta: { total, fills, simulated },
      mongo: 'up'
    }
  } catch {
    return empty()
  }
}