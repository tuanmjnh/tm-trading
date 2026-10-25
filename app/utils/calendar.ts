// =============================================================================
//  News Calendar projection (roadmap §58.5 /markets/calendar) — PURE functions.
//
//  Group the intel `news` stream into UTC-day buckets and apply the client-side
//  filters (level / source / free-text). No fetching, no re-scoring (D1): every
//  headline is exactly what services/news.mjs already stored.
// =============================================================================
import type { IntelNewsItem } from '#shared/types/intel'

export interface NewsDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string
  items: IntelNewsItem[]
}

export interface NewsFilter {
  level?: 'high' | 'med' | ''
  source?: string
  query?: string
}

/** UTC `YYYY-MM-DD` of a headline, or '' when the timestamp is unusable. */
export function newsDay(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** Client-side filter over headlines (level + source + free-text). Pure. */
export function filterNews(items: IntelNewsItem[], filter: NewsFilter = {}): IntelNewsItem[] {
  const q = (filter.query ?? '').trim().toLowerCase()
  return items.filter((n) => {
    if (filter.level && n.level !== filter.level) return false
    if (filter.source && n.source !== filter.source) return false
    if (q) {
      const hay = `${n.title} ${n.excerpt} ${n.source} ${n.tags.join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Group headlines into UTC-day buckets, newest day first; within a day keep the
 * newest headline first. Headlines without a usable timestamp are dropped.
 * Pure — safe to unit-test without a runtime (D1).
 */
export function groupNewsByDay(items: IntelNewsItem[]): NewsDay[] {
  const buckets = new Map<string, IntelNewsItem[]>()
  for (const n of items) {
    const day = newsDay(n.ts)
    if (!day) continue
    const bucket = buckets.get(day)
    if (bucket) bucket.push(n)
    else buckets.set(day, [n])
  }
  return [...buckets.entries()]
    .map(([day, list]) => ({
      day,
      items: [...list].sort((a, b) => b.ts.localeCompare(a.ts))
    }))
    .sort((a, b) => b.day.localeCompare(a.day))
}
