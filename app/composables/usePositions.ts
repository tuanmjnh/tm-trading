import type { PositionItem, PositionsListResponse } from '~~/types/positions'

// =============================================================================
//  Positions API (Nitro internal route — no tm-hub hop). Fail-soft: Mongo down
//  still returns 200 with an empty list + meta.mongo='down'.
// =============================================================================

export interface ListPositionsOptions {
  limit?: number
  cursor?: string | null
  status?: string
  symbol?: string
  source?: string
  account?: string
}

/** Phase 7P: what PATCH /positions/:id accepts (server validates transport, gate validates domain). */
export interface PositionModifyPatch {
  sl?: number
  tps?: number[]
}

/** Phase 7P: what POST /positions/:id/close accepts ({} = full close). */
export interface PositionCloseTarget {
  qty?: number
  pct?: number
}

export interface PositionActionResult {
  success: boolean
  data: {
    id: string
    status?: string
    sl?: number | null
    tps?: number[]
    rr?: number | null
    closedQty?: number
    remainingQty?: number
    remainingFees?: number | null
    childId?: string
    exitPrice?: number
    pnlAbs?: number
    exitReason?: string
  }
}

export const usePositions = () => {
  async function list(options: ListPositionsOptions = {}): Promise<{
    items: PositionItem[]
    nextCursor: string | null
    meta: PositionsListResponse['meta'] | null
  }> {
    const res = await $fetch<PositionsListResponse>('/api/v1/positions', {
      params: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
        status: options.status || undefined,
        symbol: options.symbol || undefined,
        source: options.source || undefined,
        account: options.account || undefined
      }
    })
    return {
      items: res.data ?? [],
      nextCursor: res.nextCursor ?? null,
      meta: res.meta ?? null
    }
  }

  /** Modify SL / TP ladder — the risk gate decides (400 modify_rejected surfaces as an $fetch error). */
  async function modify(id: string, patch: PositionModifyPatch): Promise<PositionActionResult> {
    return await $fetch<PositionActionResult>(`/api/v1/positions/${id}`, {
      method: 'PATCH',
      body: patch
    })
  }

  /** Close fully ({}) or partially ({ qty } / { pct }) — risk-gated + CAS on the server. */
  async function close(id: string, target: PositionCloseTarget = {}): Promise<PositionActionResult> {
    return await $fetch<PositionActionResult>(`/api/v1/positions/${id}/close`, {
      method: 'POST',
      body: target
    })
  }

  return { list, modify, close }
}
