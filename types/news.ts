// =============================================================================
//  News calendar read model (roadmap §58.5 /markets/calendar).
//
//  Read-only projection of the intel `news` event stream (services/news.mjs
//  writes it — a scored, de-duped list of headlines). The dashboard only reads;
//  it never re-scores a headline (D1: services are the single source).
// =============================================================================
import type { IntelNewsItem } from './intel'

export interface NewsListMeta {
  /** Rows returned in this page (after `limit`). */
  count: number
  /** Total `news` events stored (before `limit`). */
  total: number
  /** 'up' = Mongo reachable; 'down' = fail-soft empty page. */
  mongo: 'up' | 'down'
  /** ISO time of the newest stored headline; null when empty. */
  generatedAt: string | null
}

export interface NewsListResponse {
  success: boolean
  data: IntelNewsItem[]
  meta: NewsListMeta
}
