import type { CancelOrderResult, OrdersListMeta, PaperOrderItem } from '~~/types/orders'

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

export const usePaperOrders = () => {
  async function list(opts: { limit?: number, status?: string, symbol?: string } = {}): Promise<PaperOrdersListResult> {
    const res = await $fetch<PaperOrdersListResult>('/api/v1/orders', {
      query: {
        limit: opts.limit ?? 50,
        status: opts.status || undefined,
        symbol: opts.symbol || undefined
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

  return { list, cancel }
}
