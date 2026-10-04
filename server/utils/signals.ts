import { Types } from 'mongoose'
import type { SignalItem } from '../../types/signals'
import { engineModel } from './engineModel'

// =============================================================================
//  DOC TIN HIEU WEBHOOK (collection `alerts`) CHO DASHBOARD — roadmap Phase 7.
//
//  Chi DOC, khong ghi. Model + ket noi la cua engine (D1: mot nguon suy ra) —
//  lay qua `engineModel()` chung voi risk.ts (memo + fail-soft nhu truoc).
// =============================================================================

export interface ListSignalsQuery {
  limit: number
  cursor?: string
  symbol?: string
  action?: string
  side?: string
  /** ISO-8601 hoac epoch ms — loc alert tu luc nay (inclusive). */
  since?: string
}

export interface ListSignalsResult {
  items: SignalItem[]
  /** Tong khop bo loc, khong tinh phan trang. */
  total: number
  mongo: 'up' | 'down'
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString()
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString()
}

function toItem(a: any): SignalItem {
  return {
    id: String(a._id),
    ts: toIso(a.ts),
    source: a.source ?? 'tradingview',
    symbol: a.symbol ?? null,
    tf: a.tf ?? null,
    mode: a.mode ?? null,
    action: a.action ?? null,
    level: Number.isFinite(a.level) ? a.level : null,
    side: a.side ?? null,
    price: Number.isFinite(a.price) ? a.price : null,
    sl: Number.isFinite(a.sl) ? a.sl : null,
    tps: Array.isArray(a.tps) ? a.tps.filter((n: unknown) => Number.isFinite(n)) : [],
    atr: Number.isFinite(a.atr) ? a.atr : null,
    conf: Number.isFinite(a.conf) ? a.conf : null,
    status: a.status ?? 'received',
    rejectReason: a.rejectReason ?? ''
  }
}

/** Throw 400 when `since` is not a valid timestamp. */
export function parseSince(since?: string): string | undefined {
  if (!since) return undefined
  const ms = Number(since)
  const t = Number.isFinite(ms) ? ms : Date.parse(since)
  if (Number.isNaN(t)) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidSince', message: `since khong hop le: ${since}` })
  }
  return new Date(t).toISOString()
}

export async function listSignals(q: ListSignalsQuery): Promise<ListSignalsResult> {
  const since = parseSince(q.since)

  const Alert = await engineModel('alert.mjs', 'Alert')
  if (!Alert) return { items: [], total: 0, mongo: 'down' }

  const filter: Record<string, any> = {}
  if (q.symbol) filter.symbol = q.symbol
  if (q.action) filter.action = q.action
  if (q.side) filter.side = q.side
  if (since) filter.ts = { $gte: new Date(since) }
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
    // +1 de tinh nextCursor ma khong can count phan trang.
    const docs = await Alert.find(filter)
      .sort({ ts: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const total = await Alert.countDocuments(countFilter)
    return { items: docs.map(toItem), total, mongo: 'up' }
  } catch {
    // Mat ket noi giua chung -> fail-soft giong webhook: khong 500, bao ro down.
    return { items: [], total: 0, mongo: 'down' }
  }
}
