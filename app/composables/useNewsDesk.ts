import type { NewsDeskItem, NewsDeskMeta, NewsDeskResponse, NewsSourcePublic } from '~~/types/news'
import type { MarketEventPublic } from '~~/types/news'
import type { IntelNewsItem } from '~~/types/intel'
import { baseAssetOf, eventToMarker } from '~/utils/newsMarkers'

// =============================================================================
//  useNewsDesk — /news reads (V3.5 §60 Slice B).
//
//  Consumes the durable `news_items` envelope (`/api/v1/news`) + the source
//  registry (`/api/v1/news/sources`). Read-only, no rescoring (D1). Fail-soft
//  to empty + degraded flags so the page always renders a state, never a crash.
// =============================================================================

export interface NewsDeskFilters {
  group: string
  level: '' | 'high' | 'med'
  source: string
  q: string
}

export interface NewsDeskSnapshot {
  items: NewsDeskItem[]
  meta: NewsDeskMeta
  sources: NewsSourcePublic[]
  sourcesMongo: 'up' | 'down'
}

const EMPTY_META: NewsDeskMeta = { mongo: 'down', total: 0, generatedAt: null, degradedSources: [] }

export const EMPTY_DESK: NewsDeskSnapshot = {
  items: [],
  meta: { ...EMPTY_META },
  sources: [],
  sourcesMongo: 'down'
}

export const useNewsDesk = () => {
  async function load(f: NewsDeskFilters, limit = 100): Promise<NewsDeskSnapshot> {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (f.group) params.set('group', f.group)
      if (f.level) params.set('level', f.level)
      if (f.source) params.set('source', f.source)
      if (f.q.trim()) params.set('q', f.q.trim())
      const [res, src] = await Promise.all([
        $fetch<NewsDeskResponse>(`/api/v1/news?${params.toString()}`),
        $fetch<{ sources: NewsSourcePublic[]; mongo: 'up' | 'down' }>('/api/v1/news/sources').catch(() => null)
      ])
      const sources = src?.sources ?? []
      const down = sources.filter((s) => s.health.state === 'down' || s.health.state === 'unknown').map((s) => s.sourceId)
      return {
        items: res.items ?? [],
        meta: { ...(res.meta ?? EMPTY_META), degradedSources: down },
        sources,
        sourcesMongo: src?.mongo ?? 'down'
      }
    } catch {
      return { items: [], meta: { ...EMPTY_META }, sources: [], sourcesMongo: 'down' }
    }
  }

  async function loadEvents(group = 'crypto', limit = 20): Promise<{ events: MarketEventPublic[]; total: number }> {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (group) params.set('group', group)
      const res = await $fetch<{ events: MarketEventPublic[]; meta: NewsDeskMeta }>(
        `/api/v1/news/events?${params.toString()}`
      )
      return { events: res.events ?? [], total: res.meta?.total ?? 0 }
    } catch {
      return { events: [], total: 0 }
    }
  }

  return { load, loadEvents, loadSymbolMarkers, loadOutlook, setSourceEnabled, validateSource, loadEventDetail }
}

export interface MarketEventDetail {
  event: MarketEventPublic
  items: NewsDeskItem[]
  revisions: Array<{ at: string | null; kind: string; itemId: string | null; note: string }>
}

/** Full event detail (evidence items + revision trail); null on failure. */
async function loadEventDetail(id: string): Promise<MarketEventDetail | null> {
  try {
    const res = await $fetch<MarketEventDetail>(`/api/v1/news/events/${id}?detail=full`)
    return res && res.event ? res : null
  } catch {
    return null
  }
}

export interface SourceValidation {
  sourceId: string
  reachable: boolean
  httpStatus?: number
  latencyMs?: number
  bytes?: number
  looksLikeFeed?: boolean
  reason: string
  hint?: string
}

/** Operator enable/disable (PATCH registry). Returns the updated row or null. */
async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<NewsSourcePublic | null> {
  try {
    return await $fetch<NewsSourcePublic>(`/api/v1/news/sources/${sourceId}`, {
      method: 'PATCH',
      body: { enabled },
    })
  } catch {
    return null
  }
}

/** Connectivity probe (POST validate). Never throws — null on transport failure. */
async function validateSource(sourceId: string): Promise<SourceValidation | null> {
  try {
    return await $fetch<SourceValidation>(`/api/v1/news/sources/${sourceId}/validate`, { method: 'POST' })
  } catch {
    return null
  }
}

export interface OutlookSnapshot {
  marketGroup: string
  horizon: string
  horizonDays: number
  state: string
  generatedAt: string | null
  expiresAt: string | null
  stale: boolean
  evidenceHash: string
  supporting: Array<{ kind: string; id: string; title: string; url: string | null; corroboration?: string | null; note?: string | null }>
  counterEvidence: Array<{ kind: string; id: string; title: string; url?: string | null; note?: string | null }>
  contradictionCount: number
  multiSourceCount: number
  singleSourceCount: number
  limitations: string[]
  invalidation: string
}

/** Horizon outlook for a group; null when the backend has no store (degraded). */
async function loadOutlook(group: string, horizon: string): Promise<OutlookSnapshot | null> {
  try {
    const params = new URLSearchParams({ group, horizon })
    const res = await $fetch<OutlookSnapshot>(`/api/v1/outlook?${params.toString()}`)
    return res && res.state ? res : null
  } catch {
    return null
  }
}

/**
 * Certain-linked, non-retracted events for a trading symbol, mapped to chart
 * markers. Empty when the symbol has no mappable base asset or the fetch
 * fails (fail-soft — the terminal keeps its intel markers).
 */
async function loadSymbolMarkers(symbol: string): Promise<IntelNewsItem[]> {
  try {
    const base = baseAssetOf(symbol)
    if (!base) return []
    const params = new URLSearchParams({ limit: '50', symbol: base })
    const res = await $fetch<{ events: MarketEventPublic[] }>(`/api/v1/news/events?${params.toString()}`)
    const out: IntelNewsItem[] = []
    for (const e of res.events ?? []) {
      const m = eventToMarker(e, base)
      if (m) out.push(m)
    }
    return out
  } catch {
    return []
  }
}
