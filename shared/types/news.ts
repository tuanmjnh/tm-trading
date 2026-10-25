// =============================================================================
//  News calendar read model (roadmap §58.5 /markets/calendar).
//
//  Read-only projection of the intel `news` event stream (services/news.mjs
//  writes it — a scored, de-duped list of headlines). The dashboard only reads;
//  it never re-scores a headline (D1: services are the single source).
//
//  LEGACY note: no `/api/v1/news` handler ever served this shape; live code
//  consumes NewsDeskResponse below (durable `news_items` envelope, §60 Slice B).
//  These interfaces stay for type-compat only.
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

/** Server-side allowlist projection of one `news_items` doc (§60 Slice B). */
export interface NewsDeskItem {
  id: string
  sourceId: string
  url: string
  title: string
  excerpt: string
  language: string
  publishedAt: string | null
  firstSeenAt: string | null
  marketGroup: string
  eventType: string | null
  tags: string[]
  level: 'high' | 'med'
  dir: 'pos' | 'neg' | 'flat'
  score: number
}

export interface NewsDeskMeta {
  mongo: 'up' | 'down'
  total: number
  generatedAt: string | null
  degradedSources: string[]
}

export interface NewsDeskResponse {
  items: NewsDeskItem[]
  meta: NewsDeskMeta
}

/** Registry + health row from GET /api/v1/news/sources (no secrets). */
export interface NewsSourceHealth {
  state: string
  lastFetchAt: string | null
  lastOkAt: string | null
  lastItemAt: string | null
  lastError: string | null
  consecutiveErrors: number
}

export interface NewsSourcePublic {
  sourceId: string
  name: string
  transport: string
  trustTier: string
  marketGroups: string[]
  languages: string[]
  licenseStatus: string
  enabled: boolean
  pollIntervalSec: number
  retentionDays: number
  health: NewsSourceHealth
}

/** Allowlist projection of one MarketEvent doc (§60 Slice C). */
export interface MarketEventEntity {
  symbol: string
  confidence: number
  uncertain: boolean
}

export interface MarketEventPublic {
  id: string
  title: string
  marketGroup: string
  eventType: string | null
  status: 'active' | 'corrected' | 'retracted'
  firstSeenAt: string | null
  lastSeenAt: string | null
  itemCount: number
  sourceIds: string[]
  corroboration: 'single_source' | 'multi_source' | 'contradicted'
  independentSources: number
  dirs: string[]
  entities: MarketEventEntity[]
  revisionCount: number
}
