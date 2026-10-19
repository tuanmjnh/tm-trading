import type { IntelNewsItem, IntelRegime } from '~~/types/intel'
import type { NewsDeskItem, NewsDeskResponse } from '~~/types/news'

// =============================================================================
//  useMarketCalendar — /markets/calendar reads (roadmap §58.5, store §60 Slice B).
//
//  Consumes the DURABLE `news_items` envelope via `/api/v1/news` (Slice B;
//  idempotent, TTL-retained, license-gated server-side) plus the token-unlock
//  window from the SAME intel snapshot the Market Intelligence page shows
//  (`/api/v1/intel` -> regime.unlocks48h). No new ingest, no recalculation (D1).
//  Fail-soft to an empty calendar.
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
        $fetch<NewsDeskResponse>(`/api/v1/news?limit=${limit}`),
        intelApi.get().catch(() => null)
      ])
      const news: IntelNewsItem[] = (res.items ?? []).map((n: NewsDeskItem) => ({
        title: n.title,
        link: n.url,
        source: n.sourceId,
        level: n.level === 'high' ? 'high' : 'med',
        dir: n.dir,
        tags: n.tags ?? [],
        score: n.score ?? 0,
        ts: n.publishedAt ?? n.firstSeenAt ?? '',
        excerpt: n.excerpt ?? ''
      }))
      return {
        mongo: res.meta?.mongo ?? 'down',
        generatedAt: res.meta?.generatedAt ?? null,
        total: res.meta?.total ?? news.length,
        news,
        unlocks: intel?.regime?.unlocks48h ?? []
      }
    } catch {
      return { ...EMPTY }
    }
  }

  return { load }
}
