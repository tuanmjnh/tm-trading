import type { SignalItem, SignalsListResponse } from '#shared/types/signals'

// =============================================================================
//  Webhook signal API (TM Trading's Nitro route — does NOT go to tm-hub).
//  Same pattern as useRuns: makes an INTERNAL call to `/api/v1/signals`, yet
//  `auth.client` still attaches `X-App-Id` and `Bearer` tokens, allowing it to
//  pass the D10 middleware.
// =============================================================================

export interface ListSignalsOptions {
  limit?: number
  cursor?: string | null
  symbol?: string
  action?: string
  side?: string
  /** ISO-8601 hoac epoch ms. */
  since?: string
}

export const useSignals = () => {
  async function list(options: ListSignalsOptions = {}): Promise<{
    items: SignalItem[]
    nextCursor: string | null
    meta: SignalsListResponse['meta'] | null
  }> {
    const res = await $fetch<SignalsListResponse>('/api/v1/signals', {
      params: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
        symbol: options.symbol,
        action: options.action,
        side: options.side,
        since: options.since
      }
    })
    return {
      items: res.data ?? [],
      nextCursor: res.nextCursor ?? null,
      meta: res.meta ?? null
    }
  }

  async function get(id: string): Promise<SignalItem> {
    const res = await $fetch<{ data: SignalItem }>(`/api/v1/signals/${id}`)
    return res.data
  }

  async function setLifecycle(id: string, status: string, note?: string): Promise<void> {
    await $fetch(`/api/v1/signals/${id}/lifecycle`, {
      method: 'PATCH',
      body: { status, note, at: new Date().toISOString() }
    })
  }

  return { list, get, setLifecycle }
}
