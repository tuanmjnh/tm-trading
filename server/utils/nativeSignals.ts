import { Types } from 'mongoose'
import type { NativeSignalAttribution, NativeSignalItem } from '../../types/signals'
import { engineModel } from './engineModel'

// =============================================================================
//  NATIVE SIGNALS (collection `signals`) — roadmap §61.17 Phase D.
//
//  Read-only surface over the signals the NATIVE engine produced
//  (engine/signalEngine.mjs + services/signalStore.mjs). This is the replacement
//  for depending on TradingView: the dashboard can show engine output without the
//  webhook. The legacy `alerts` read path (server/utils/signals.ts) is kept
//  unchanged for historical records.
//
//  Only rows with a durable `signalKey` are served — legacy webhook-translated
//  rows (no attribution) are intentionally excluded so this list is always
//  traceable. Tenancy (§61.3): the owner filter is mandatory.
// =============================================================================

export interface ListNativeSignalsQuery {
  limit: number
  ownerId: string
  cursor?: string
  symbol?: string
  method?: string
  strategyVersion?: string
}

export interface ListNativeSignalsResult {
  items: NativeSignalItem[]
  total: number
  mongo: 'up' | 'down'
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString()
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString()
}

function toItem(s: any): NativeSignalItem {
  const a = s.attribution && typeof s.attribution === 'object' ? s.attribution : null
  const attribution: NativeSignalAttribution | null = a
    ? {
        method: String(a.method ?? s.method ?? ''),
        methodVersion: String(a.methodVersion ?? ''),
        strategyVersion: String(a.strategyVersion ?? ''),
        engineVersion: String(a.engineVersion ?? ''),
        paramsHash: String(a.paramsHash ?? ''),
        indicatorRefs: Array.isArray(a.indicatorRefs)
          ? a.indicatorRefs.map((r: any) => ({ id: String(r?.id ?? ''), version: String(r?.version ?? '') }))
          : []
      }
    : null
  return {
    id: String(s._id),
    ts: toIso(s.ts),
    symbol: s.symbol ?? null,
    tf: s.tf ?? null,
    type: s.type ?? '',
    price: Number.isFinite(s.price) ? s.price : null,
    method: s.method ?? 'vsa',
    signalKey: s.signalKey ?? '',
    schemaVersion: s.schemaVersion ?? null,
    accountId: s.accountId ?? null,
    attribution,
    meta: s.meta && typeof s.meta === 'object' ? s.meta : null
  }
}

export async function listNativeSignals(q: ListNativeSignalsQuery): Promise<ListNativeSignalsResult> {
  const Signal = await engineModel('signal.mjs', 'Signal')
  if (!Signal) return { items: [], total: 0, mongo: 'down' }

  // signalKey only exists on native rows -> this is exactly the attributed set.
  const filter: Record<string, any> = { ownerId: q.ownerId, signalKey: { $type: 'string' } }
  if (q.symbol) filter.symbol = q.symbol
  if (q.method) filter.method = q.method
  if (q.strategyVersion) filter['attribution.strategyVersion'] = q.strategyVersion
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
    // +1 to compute nextCursor without a paginated count.
    const docs = await Signal.find(filter)
      .sort({ ts: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const total = await Signal.countDocuments(countFilter)
    return { items: docs.map(toItem), total, mongo: 'up' }
  } catch {
    // Connection lost mid-read -> fail-soft like the webhook path: no 500.
    return { items: [], total: 0, mongo: 'down' }
  }
}
