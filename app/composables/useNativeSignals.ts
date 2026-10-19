import type { NativeSignalItem, NativeSignalsListResponse } from '~~/types/signals'

// =============================================================================
//  Native (engine) signal API — TM Trading's Nitro route (does NOT go to tm-hub).
//  Same pattern as useSignals: an INTERNAL call to `/api/v1/signals/native`, yet
//  `auth.client` still attaches `X-App-Id` and `Bearer` tokens (D10 middleware).
//
//  This reads the signals the native engine wrote (attributed), so the dashboard
//  no longer depends on the TradingView webhook to display signals.
// =============================================================================

export interface ListNativeSignalsOptions {
  limit?: number
  cursor?: string | null
  symbol?: string
  method?: string
  strategyVersion?: string
}

export const useNativeSignals = () => {
  async function list(options: ListNativeSignalsOptions = {}): Promise<{
    items: NativeSignalItem[]
    nextCursor: string | null
    meta: NativeSignalsListResponse['meta'] | null
  }> {
    const res = await $fetch<NativeSignalsListResponse>('/api/v1/signals/native', {
      params: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
        symbol: options.symbol,
        method: options.method,
        strategyVersion: options.strategyVersion
      }
    })
    return {
      items: res.data ?? [],
      nextCursor: res.nextCursor ?? null,
      meta: res.meta ?? null
    }
  }

  return { list }
}
