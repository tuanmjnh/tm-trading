// =============================================================================
//  useSessions — trading session client (V3.4 Slice C).
//
//  Reads are fail-soft (empty on a store blip). Writes (start/move) surface
//  failure so the UI can report it — state transitions stay server-guarded
//  (D25) and human-driven (D7).
// =============================================================================

export interface SessionTimelineEvent {
  t: number
  kind: string
  message: string
}

export interface TradingSession {
  _id: string
  sessionId: string
  kind: string
  strategyVersionId: string | null
  botProfileId: string | null
  accountId: string
  instruments: string[]
  timeframes: string[]
  state: string
  startedAt: number | null
  stoppedAt: number | null
  lastEventAt: number | null
  manifest: Record<string, unknown> | null
  timeline: SessionTimelineEvent[]
  timelineDropped: number
  counts: { orders: number; fills: number; positions: number }
  orderKeys: string[]
  positionIds: string[]
  journalKeys: string[]
  restartedFrom: string | null
  createdBy: string | null
  schemaVersion: string
}

/** Fail-soft result of the auto-freeze that runs when a session is sealed (§59.15). */
export interface SessionAutoFreeze {
  frozen: boolean
  created: boolean
  setId: string | null
  reason?: string
}

export interface MoveResult {
  session: TradingSession
  autoFreeze?: SessionAutoFreeze
}

import type { PaperOrderItem } from '#shared/types/orders'
import type { PaperFillItem } from '#shared/types/fills'
import type { PositionItem } from '#shared/types/positions'

export const useSessions = () => {
  async function list(options: { limit?: number; state?: string; kind?: string; accountId?: string } = {}): Promise<TradingSession[]> {
    try {
      const res = await $fetch<{ success: boolean; data: TradingSession[] }>('/api/v1/sessions', {
        params: {
          limit: options.limit ?? 50,
          state: options.state || undefined,
          kind: options.kind || undefined,
          accountId: options.accountId || undefined
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function detail(id: string): Promise<TradingSession | null> {
    try {
      const res = await $fetch<{ success: boolean; data: TradingSession | null }>(
        `/api/v1/sessions/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function start(input: Record<string, unknown>): Promise<TradingSession> {
    const res = await $fetch<{ success: boolean; data: TradingSession }>('/api/v1/sessions', {
      method: 'POST',
      body: input
    })
    if (!res.data) throw new Error('sessions.startEmpty')
    return res.data
  }

  async function move(id: string, to: string): Promise<MoveResult> {
    const res = await $fetch<{ success: boolean; data: TradingSession, autoFreeze?: SessionAutoFreeze }>(
      `/api/v1/sessions/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { to } }
    )
    if (!res.data) throw new Error('sessions.moveEmpty')
    return { session: res.data, autoFreeze: res.autoFreeze }
  }

  async function logEvent(id: string, kind: string, message: string): Promise<Record<string, unknown>> {
    const res = await $fetch<{ success: boolean; data: Record<string, unknown> }>(
      `/api/v1/sessions/${encodeURIComponent(id)}/events`,
      { method: 'POST', body: { kind, message } }
    )
    return res.data ?? {}
  }

  async function orders(sessionId: string, limit = 50): Promise<PaperOrderItem[]> {
    try {
      const res = await $fetch<{ success: boolean; items: PaperOrderItem[] }>('/api/v1/orders', {
        params: { sessionId, limit }
      })
      return res.items ?? []
    } catch {
      return []
    }
  }

  async function fills(sessionId: string, limit = 50): Promise<PaperFillItem[]> {
    try {
      const res = await $fetch<{ success: boolean; items: PaperFillItem[] }>('/api/v1/fills', {
        params: { sessionId, limit }
      })
      return res.items ?? []
    } catch {
      return []
    }
  }

  async function positions(sessionId: string, limit = 50): Promise<PositionItem[]> {
    try {
      const res = await $fetch<{ success: boolean; data: PositionItem[] }>('/api/v1/positions', {
        params: { sessionId, limit }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  return { list, detail, start, move, logEvent, orders, fills, positions }
}

