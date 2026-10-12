import type { IntelNewsItem, IntelRegime } from '~~/types/intel'
import type { NewsListResponse } from '~~/types/news'

// =============================================================================
//  useMarketCalendar — /markets/calendar reads (roadmap §58.5).
//
//  Consumes the intel `news` event stream via `/api/v1/news` (services/news.mjs
//  writes it) plus the token-unlock window from the SAME intel snapshot the
//  Market Intelligence page shows (`/api/v1/intel` -> regime.unlocks48h). No new
//  ingest, no recalculation (D1). Fail-soft to an empty calendar.
// =============================================================================

export interface CalendarSnapshot {
  mongo: 'up' | 'down'
  generatedAt: string | null
  total: number
  news: IntelNewsItem[]
  /** Token unlocks scheduled in the next 48h — regime context (§58.6). */
  unlocks: IntelRegime['unlocks48h']
}

const EMPTY: CalendarSnapshot = {
  mongo: 'down',
  generatedAt: null,
  total: 0,
  news: [],
  unlocks: []
}

export const useMarketCalendar = () => {
  const intelApi = useIntel()

  async function load(limit = 120): Promise<CalendarSnapshot> {
    try {
      const [res, intel] = await Promise.all([
        $fetch<NewsListResponse>(`/api/v1/news?limit=${limit}`),
        intelApi.get().catch(() => null)
      ])
      return {
        mongo: res.meta?.mongo ?? 'down',
        generatedAt: res.meta?.generatedAt ?? null,
        total: res.meta?.total ?? res.data?.length ?? 0,
        news: res.data ?? [],
        unlocks: intel?.regime?.unlocks48h ?? []
      }
    } catch {
      return { ...EMPTY }
    }
  }

  return { load }
}
