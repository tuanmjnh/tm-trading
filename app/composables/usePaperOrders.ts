import type { CancelOrderResult, OrdersListMeta, PaperOrderItem } from '#shared/types/orders'

// =============================================================================
//  Paper order lifecycle (roadmap §17.2, §26.4, §58.5 /orders). READ + CANCEL
//  only: the executor owns every other transition (D1). Cancel is the ONE
//  mutation the terminal may drive, and it is guarded server-side at the alert
//  level so a race can never cancel an already-filling order (D14).
// =============================================================================

export interface PaperOrdersListResult {
  items: PaperOrderItem[]
  meta: OrdersListMeta
  mongo: 'up' | 'down'
  nextCursor: string | null
}

/** Result of the bulk sweep — same compare-and-swap as the single cancel (D14). */
export interface CancelAllResult {
  cancelled: string[]
  skipped: { id: string, reason: string }[]
  meta: { cancelled: number, skipped: number, capped: boolean }
}

export const usePaperOrders = () => {
  async function list(opts: { limit?: number, status?: string, symbol?: string, account?: string } = {}): Promise<PaperOrdersListResult> {
    const res = await $fetch<PaperOrdersListResult>('/api/v1/orders', {
      query: {
        limit: opts.limit ?? 50,
        status: opts.status || undefined,
        symbol: opts.symbol || undefined,
        account: opts.account || undefined
      }
    })
    return {
      items: res.items ?? [],
      meta: res.meta,
      mongo: res.mongo,
      nextCursor: res.nextCursor ?? null
    }
  }

  async function cancel(id: string, opts: { by?: string, reason?: string } = {}): Promise<CancelOrderResult> {
    return await $fetch<CancelOrderResult>(`/api/v1/orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: { by: opts.by ?? 'terminal', reason: opts.reason ?? undefined }
    })
  }

  /**
   * Panic sweep (roadmap §17.2/D14): cancels every CANCELABLE paper order.
   * Same guarded per-order path as cancel() — an order that already started
   * filling is reported as skipped, never forced. Capped at 100 rows per call
   * server-side; `meta.capped` says so when more remain.
   */
  async function cancelAll(opts: { by?: string, reason?: string } = {}): Promise<{ success: boolean, data: CancelAllResult }> {
    return await $fetch<{ success: boolean, data: CancelAllResult }>('/api/v1/orders/cancel-all', {
      method: 'POST',
      body: { by: opts.by ?? 'terminal', reason: opts.reason ?? 'cancel-all' }
    })
  }

  return { list, cancel, cancelAll }
}
