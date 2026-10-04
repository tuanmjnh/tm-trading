import type { RunSeries, RunSeriesDetail, RunsListResponse } from '~~/types/runs'

// =============================================================================
// API documentation for backtesting from reports/*.ndjson (TM Trading's Nitro route).
// Unlike other modules here: it makes an INTERNAL call to `/api/v1/runs` (bypassing tm-hub),
// yet `auth.client` still attaches `X-App-Id` and `Bearer` tokens, allowing it to pass the D10 middleware.
// =============================================================================

export interface ListRunsOptions {
  limit?: number
  cursor?: string | null
  symbol?: string
  method?: string
  tf?: string
}

export const useRuns = () => {
  async function list(options: ListRunsOptions = {}): Promise<{
    items: RunSeries[]
    nextCursor: string | null
    meta: RunsListResponse['meta'] | null
  }> {
    const res = await $fetch<RunsListResponse>('/api/v1/runs', {
      params: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
        symbol: options.symbol,
        method: options.method,
        tf: options.tf
      }
    })
    return {
      items: res.data ?? [],
      nextCursor: res.nextCursor ?? null,
      meta: res.meta ?? null
    }
  }

  async function detail(id: string): Promise<RunSeriesDetail> {
    const res = await $fetch<{ success: boolean, data: RunSeriesDetail }>(
      `/api/v1/runs/${encodeURIComponent(id)}`
    )
    if (!res.data) throw new Error('runs.detailEmpty')
    return res.data
  }

  return { list, detail }
}
