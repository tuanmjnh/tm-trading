import { Types } from 'mongoose'
import type { PositionItem } from '../../types/positions'
import { engineModel } from './engineModel'

// =============================================================================
//  DOC VI THE CHO DASHBOARD — engine/models/position.mjs la nguon chan ly ve
//  "dang giu gi" (D1). Chi DOC, khong ghi. Mongo khong san sang -> mang rong +
//  mongo='down' (fail-soft giong signals.ts).
// =============================================================================

export interface ListPositionsQuery {
  limit: number
  cursor?: string
  status?: string
  symbol?: string
  source?: string
  account?: string
}

export interface ListPositionsResult {
  items: PositionItem[]
  total: number
  open: number
  closed: number
  realizedPnlAbs: number | null
  mongo: 'up' | 'down'
}

function toIso(d: unknown): string | null {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString()
  if (d == null) return null
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function toItem(p: any): PositionItem {
  return {
    id: String(p._id),
    account: String(p.account ?? 'default'),
    source: String(p.source ?? 'paper'),
    externalId: p.externalId == null ? null : String(p.externalId),
    symbol: String(p.symbol ?? ''),
    dir: p.dir === -1 ? -1 : 1,
    qty: num(p.qty) ?? 0,
    entryPrice: num(p.entryPrice) ?? 0,
    entryTime: toIso(p.entryTime) ?? '',
    sl: num(p.sl),
    tps: Array.isArray(p.tps) ? p.tps.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n)) : [],
    exitPrice: num(p.exitPrice),
    exitTime: toIso(p.exitTime),
    status: String(p.status ?? 'open'),
    pnlPct: num(p.pnlPct),
    pnlAbs: num(p.pnlAbs),
    method: p.method == null ? null : String(p.method),
    signalKey: p.signalKey == null ? null : String(p.signalKey),
    tf: p.tf == null ? null : String(p.tf),
    exitReason: p.exitReason == null ? null : String(p.exitReason),
    fees: num(p.fees),
    stampKind: String(p.stamp?.kind ?? (p.stampUnknown ? 'unknown' : 'unknown')),
    stampParamsHash: p.stamp?.paramsHash == null ? null : String(p.stamp.paramsHash),
    stampEngineVersion: p.stamp?.engineVersion == null ? null : String(p.stamp.engineVersion),
    updatedAt: toIso(p.updatedAt) ?? ''
  }
}

export async function listPositions(q: ListPositionsQuery): Promise<ListPositionsResult> {
  const Position = await engineModel('position.mjs', 'Position')
  if (!Position) return { items: [], total: 0, open: 0, closed: 0, realizedPnlAbs: null, mongo: 'down' }

  const filter: Record<string, any> = {}
  if (q.status) filter.status = q.status
  if (q.symbol) filter.symbol = q.symbol.toUpperCase()
  if (q.source) filter.source = q.source
  if (q.account) filter.account = q.account
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
    const docs = await Position.find(filter)
      .sort({ entryTime: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const total = await Position.countDocuments(countFilter)

    // Header stats are global (not per filter): open / closed / realized.
    const [open, closed, pnlAgg] = await Promise.all([
      Position.countDocuments({ status: 'open' }),
      Position.countDocuments({ status: 'closed' }),
      Position.aggregate([
        { $match: { status: 'closed', pnlAbs: { $ne: null } } },
        { $group: { _id: null, sum: { $sum: '$pnlAbs' }, n: { $sum: 1 } } }
      ])
    ])
    const realizedPnlAbs = pnlAgg?.[0]?.n > 0 ? Number(pnlAgg[0].sum) : null

    return { items: docs.map(toItem), total, open, closed, realizedPnlAbs, mongo: 'up' }
  } catch {
    return { items: [], total: 0, open: 0, closed: 0, realizedPnlAbs: null, mongo: 'down' }
  }
}
