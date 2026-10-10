import type { JournalEntry, JournalListResponse, JournalStats } from '~~/types/journal'

// =============================================================================
//  Central journal API (Nitro internal route — Phase 13). Fail-soft: Mongo and
//  NDJSON both unavailable still return 200 with source 'none' + empty list.
// =============================================================================

export interface ListJournalOptions {
  limit?: number
  cursor?: string | null
  source?: string
  method?: string
  regime?: string
  result?: string
  symbol?: string
  tf?: string
  account?: string
  /** ISO-8601 or epoch ms. */
  from?: string
  to?: string
}

export const useJournal = () => {
  async function list(options: ListJournalOptions = {}): Promise<{
    items: JournalEntry[]
    nextCursor: string | null
    stats: JournalStats | null
    meta: JournalListResponse['meta'] | null
  }> {
    const res = await $fetch<JournalListResponse>('/api/v1/journal', {
      params: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
        source: options.source || undefined,
        method: options.method || undefined,
        regime: options.regime || undefined,
        result: options.result || undefined,
        symbol: options.symbol || undefined,
        tf: options.tf || undefined,
        account: options.account || undefined,
        from: options.from || undefined,
        to: options.to || undefined
      }
    })
    return {
      items: res.data ?? [],
      nextCursor: res.nextCursor ?? null,
      stats: res.stats ?? null,
      meta: res.meta ?? null
    }
  }

  return { list }
}
