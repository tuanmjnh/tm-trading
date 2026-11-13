// =============================================================================
//  useDashboardFeed — the V5.0 Dashboard READ MODEL.
//
//  One composable owns every Dashboard read so no panel re-implements fetching,
//  freshness math or dedupe (V5.0 §3, §5 "keep business logic out of Vue page
//  components"). It composes EXISTING domain APIs — it never recalculates a
//  value the services already produced (D1):
//
//    /api/v1/intel              market snapshot (movers/flows/funding/OI/regime)
//    /api/v1/signals/native     engine signals (paginated, owner-scoped)
//    /api/v1/watchlists         the operator's default list
//    /api/v1/news               durable news envelope
//    /api/v1/news/events        sourced market events
//    /api/v1/outlook            evidence-linked, rules-based horizons
//    /api/v1/operations/services service lifecycle + readiness
//    /api/v1/health             db + background service heartbeats
//
//  Every read is fail-soft: one failing panel degrades ITSELF and the Dashboard
//  keeps rendering (V5.0 §3 "one failing panel must not blank the whole page").
// =============================================================================

import type { IntelData, IntelMover } from '#shared/types/intel'
import type { NativeSignalItem } from '#shared/types/signals'
import type { NewsDeskItem, MarketEventPublic } from '#shared/types/news'
import type { WatchlistItem } from '#shared/types/watchlist'
import type { OperationsServiceRow, OperationsView } from '#shared/types/operations'
import type { SystemHealth } from '#shared/types/health'
import type { OutlookSnapshot } from '~/composables/useNewsDesk'
import { createSharedComposable } from '@vueuse/core'

/** Event categories the Signal Center can filter on (V5.0 §3.2). */
export type FeedCategory = 'indicator' | 'volatility' | 'volume' | 'funding' | 'oi' | 'news'

/** Freshness is DERIVED from an observation timestamp, never asserted. */
export type Freshness = 'fresh' | 'stale' | 'missing'

/** One row of the unified Signal Center table. */
export interface FeedEvent {
  /** Stable row key (also the overlay id). */
  key: string
  category: FeedCategory
  /** Asset symbol, or a group label for news/regime rows. */
  symbol: string
  /** Timeframe (`4h`, `1d`, or `—` for snapshots). */
  timeframe: string
  /** Human-readable context. Never a fabricated number. */
  context: string
  /** Deterministic quality/strength exactly as the producer stored it. */
  quality: number | null
  /** ISO-8601 UTC of the observation (D2). */
  detectedAt: string
  /** Producer: venue, engine method or news source. */
  source: string
  /** Producer method/version — the provenance anchor. */
  method: string
  /** Lifecycle/status label from the producer. */
  status: string
  price: number | null
  /** Underlying record id for the detail overlay (engine signal / news id). */
  recordId: string | null
}

/** How long each source may be considered current. */
export const FRESH_MS: Record<'intel' | 'news' | 'signals' | 'outlook', number> = {
  intel: 15 * 60_000,
  news: 6 * 60 * 60_000,
  signals: 24 * 60 * 60_000,
  outlook: 24 * 60 * 60_000
}

export function freshnessOf(iso: string | null | undefined, kind: keyof typeof FRESH_MS, now = Date.now()): Freshness {
  if (!iso) return 'missing'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'missing'
  return now - t > FRESH_MS[kind] ? 'stale' : 'fresh'
}

const SIGNAL_CATEGORY: Record<string, FeedCategory> = {
  SV: 'volume',
  BC: 'indicator',
  NS: 'indicator',
  ND: 'indicator',
  EoM: 'indicator'
}

function signalCategory(type: string): FeedCategory {
  const upper = type.toUpperCase()
  if (SIGNAL_CATEGORY[upper]) return SIGNAL_CATEGORY[upper]
  if (upper.startsWith('ST')) return 'indicator'
  return 'indicator'
}

/** Engine `meta.score`/`meta.strength` when the producer stored one. */
function qualityOf(meta: Record<string, unknown> | null): number | null {
  if (!meta) return null
  for (const key of ['score', 'strength', 'confidence']) {
    const raw = meta[key]
    const value = typeof raw === 'string' ? Number(raw) : raw
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function signalToEvent(s: NativeSignalItem): FeedEvent {
  const method = s.attribution?.method || s.method || 'engine'
  const version = s.attribution?.methodVersion || s.attribution?.engineVersion || ''
  return {
    key: `sig:${s.id}`,
    category: signalCategory(s.type),
    symbol: s.symbol ?? '—',
    timeframe: s.tf ?? '—',
    context: s.type || method,
    quality: qualityOf(s.meta),
    detectedAt: s.ts,
    source: method,
    method: version ? `${method} ${version}` : method,
    status: s.lifecycleStatus || 'active',
    price: s.price,
    recordId: s.id
  }
}

/** Snapshot rows: one per symbol per category, capped to keep the table scannable. */
function observationEvents(intel: IntelData | null, cap = 6): FeedEvent[] {
  if (!intel?.generatedAt) return []
  const at = intel.generatedAt
  const rows: FeedEvent[] = []

  const push = (
    category: FeedCategory,
    symbol: string,
    context: string,
    quality: number | null,
    price: number | null,
    timeframe = '—'
  ) => rows.push({
    key: `obs:${category}:${symbol}`,
    category,
    symbol,
    timeframe,
    context,
    quality,
    detectedAt: at,
    source: 'intel snapshot',
    method: 'services snapshot',
    status: 'observed',
    price,
    recordId: null
  })

  for (const m of (intel.movers ?? []).slice(0, cap) as IntelMover[]) {
    push('volatility', m.symbol, `24h ${m.pct24h.toFixed(1)}% · 4h ${m.chg4h.toFixed(1)}%`, null, m.lastPrice)
  }
  for (const v of (intel.volatility ?? []).slice(0, cap)) {
    push('volatility', v.symbol, `ATR ${v.atrPct.toFixed(1)}% · range ${v.rangePct.toFixed(1)}%`, v.score, null)
  }
  for (const f of (intel.flows ?? []).slice(0, cap)) {
    push('volume', f.symbol, `${f.dir} · vol ${f.volRatio.toFixed(1)}× · taker ${(f.takerRatio * 100).toFixed(0)}%`, f.score, null)
  }
  for (const a of (intel.accums ?? []).slice(0, cap)) {
    push('volume', a.symbol, `range ${a.rangePct.toFixed(1)}% · Δ48h ${a.priceChg48.toFixed(1)}%`, null, null)
  }
  for (const f of (intel.fundingOi ?? []).slice(0, cap)) {
    push('funding', f.symbol, `funding ${f.pct.toFixed(4)}%`, f.score, null)
    if (f.oiNotionalUsd != null) {
      push('oi', f.symbol, `OI $${(f.oiNotionalUsd / 1e6).toFixed(1)}M · funding ${f.pct.toFixed(4)}%`, null, null)
    }
  }
  return rows
}

function newsEvent(item: NewsDeskItem): FeedEvent {
  return {
    key: `news:${item.id}`,
    category: 'news',
    symbol: item.tags[0] || item.marketGroup || '—',
    timeframe: '—',
    context: item.title,
    quality: item.score,
    detectedAt: item.publishedAt || item.firstSeenAt || '',
    source: item.sourceId,
    method: `news · ${item.level}`,
    status: item.eventType || item.marketGroup,
    price: null,
    recordId: item.id
  }
}

function eventFromMarketEvent(e: MarketEventPublic): FeedEvent {
  const entity = e.entities?.[0]
  return {
    key: `mkt:${e.id}`,
    category: 'news',
    symbol: entity?.symbol || e.marketGroup || '—',
    timeframe: '—',
    context: e.title,
    // Corroboration is the honest quality signal for an event: independent sources.
    quality: e.independentSources,
    detectedAt: e.firstSeenAt || '',
    source: e.sourceIds?.[0] || e.marketGroup,
    method: `event · ${e.eventType ?? 'macro'}`,
    status: e.corroboration,
    price: null,
    recordId: e.id
  }
}

const EVENT_CAP = 120

const _useDashboardFeed = () => {
  const intelApi = useIntel()
  const signalsApi = useNativeSignals()
  const watchApi = useWatchlists()
  const desk = useNewsDesk()
  const healthApi = useSystemHealth()
  const operationsApi = useOperations()

  const intel = ref<IntelData | null>(null)
  const signals = ref<NativeSignalItem[]>([])
  const signalCursor = ref<string | null>(null)
  const signalTotal = ref(0)
  const watchlist = ref<WatchlistItem | null>(null)
  const news = ref<NewsDeskItem[]>([])
  const marketEvents = ref<MarketEventPublic[]>([])
  const outlook = ref<Record<string, OutlookSnapshot | null>>({})
  const operations = ref<OperationsView | null>(null)
  const health = ref<SystemHealth | null>(null)

  const loading = reactive({
    intel: true,
    signals: true,
    watchlist: true,
    news: true,
    outlook: true,
    services: true,
    health: true
  })
  const failed = reactive({
    intel: false,
    signals: false,
    watchlist: false,
    news: false,
    outlook: false,
    services: false,
    health: false
  })
  const readAt = reactive<Record<string, string | null>>({
    intel: null,
    signals: null,
    watchlist: null,
    news: null,
    outlook: null,
    services: null,
    health: null
  })

  function stamp(section: keyof typeof readAt) {
    readAt[section] = new Date().toISOString()
  }

  async function loadIntel() {
    loading.intel = true
    try {
      intel.value = await intelApi.get()
      failed.intel = false
      stamp('intel')
    } catch {
      intel.value = null
      failed.intel = true
    } finally {
      loading.intel = false
    }
  }

  async function loadSignals(append = false) {
    loading.signals = true
    try {
      const res = await signalsApi.list({ limit: 50, cursor: append ? signalCursor.value : null })
      signals.value = append ? [...signals.value, ...res.items] : res.items
      signalCursor.value = res.nextCursor
      signalTotal.value = res.meta?.total ?? signals.value.length
      failed.signals = res.meta?.mongo === 'down'
      stamp('signals')
    } catch {
      if (!append) signals.value = []
      failed.signals = true
    } finally {
      loading.signals = false
    }
  }

  async function loadWatchlist() {
    loading.watchlist = true
    try {
      await watchApi.fetchLists()
      watchlist.value = watchApi.defaultList.value
      failed.watchlist = false
      stamp('watchlist')
    } catch {
      failed.watchlist = true
    } finally {
      loading.watchlist = false
    }
  }

  async function loadNews() {
    loading.news = true
    try {
      const [snapshot, events] = await Promise.all([
        desk.load({ group: 'crypto', level: '', source: '', q: '' }, 30),
        desk.loadEvents('crypto', 15)
      ])
      news.value = snapshot.items
      marketEvents.value = events.events
      failed.news = snapshot.meta.mongo === 'down'
      stamp('news')
    } catch {
      failed.news = true
    } finally {
      loading.news = false
    }
  }

  async function loadOutlook() {
    loading.outlook = true
    try {
      const [shortTerm, swing, longTerm] = await Promise.all([
        desk.loadOutlook('crypto', 'short_term'),
        desk.loadOutlook('crypto', 'swing'),
        desk.loadOutlook('crypto', 'long_term')
      ])
      outlook.value = { short_term: shortTerm, swing, long_term: longTerm }
      failed.outlook = !shortTerm && !swing && !longTerm
      stamp('outlook')
    } catch {
      failed.outlook = true
    } finally {
      loading.outlook = false
    }
  }

  async function loadServices() {
    loading.services = true
    try {
      operations.value = await operationsApi.view()
      failed.services = false
      stamp('services')
    } catch {
      operations.value = null
      failed.services = true
    } finally {
      loading.services = false
    }
  }

  async function loadHealth() {
    loading.health = true
    try {
      health.value = (await healthApi.system()).data
      failed.health = false
      stamp('health')
    } catch {
      health.value = null
      failed.health = true
    } finally {
      loading.health = false
    }
  }

  /** Refresh everything (first paint, manual refresh, back-to-freshness). */
  async function refreshAll() {
    await Promise.all([
      loadIntel(),
      loadSignals(),
      loadWatchlist(),
      loadNews(),
      loadOutlook(),
      loadServices(),
      loadHealth()
    ])
  }

  /** Bounded poll: only the cheap, must-stay-current sections. */
  async function refreshLive() {
    await Promise.all([loadIntel(), loadServices(), loadHealth()])
  }

  const watchSymbols = computed(() => new Set((watchlist.value?.symbols ?? []).map(s => s.toUpperCase())))

  /** The unified Signal Center rows, newest first, deduped by row key. */
  const events = computed<FeedEvent[]>(() => {
    const list: FeedEvent[] = [
      ...signals.value.map(signalToEvent),
      ...observationEvents(intel.value),
      ...news.value.map(newsEvent),
      ...marketEvents.value.map(eventFromMarketEvent)
    ]
    const seen = new Set<string>()
    const unique = list.filter((row) => {
      if (seen.has(row.key)) return false
      seen.add(row.key)
      return true
    })
    // A news id could appear in both feeds under different keys; collapse on the
    // record id so the operator never sees the same headline twice.
    const byRecord = new Set<string>()
    return unique
      .filter((row) => {
        if (!row.recordId) return true
        const id = `${row.category}:${row.recordId}`
        if (byRecord.has(id)) return false
        byRecord.add(id)
        return true
      })
      .sort((a, b) => Date.parse(b.detectedAt || '') - Date.parse(a.detectedAt || ''))
      .slice(0, EVENT_CAP)
  })

  /** Latest observation time across the sections a panel cares about. */
  const intelFreshness = computed(() => freshnessOf(intel.value?.generatedAt, 'intel'))
  const newsFreshness = computed(() => freshnessOf(news.value[0]?.publishedAt || news.value[0]?.firstSeenAt, 'news'))

  const serviceSummary = computed(() => operations.value?.summary ?? null)
  const services = computed<OperationsServiceRow[]>(() => operations.value?.services ?? [])

  /** Watchlist rows enriched with observed price/change, never with invented ones. */
  const watchRows = computed(() => {
    const bySymbol = new Map<string, IntelMover>()
    for (const m of intel.value?.movers ?? []) bySymbol.set(m.symbol.toUpperCase(), m)
    return (watchlist.value?.symbols ?? []).map(symbol => {
      const quote = bySymbol.get(symbol.toUpperCase())
      const latest = events.value.find(e => e.symbol.toUpperCase() === symbol.toUpperCase())
      return {
        symbol,
        price: quote?.lastPrice ?? null,
        change24h: quote?.pct24h ?? null,
        change4h: quote?.chg4h ?? null,
        latest,
        freshness: intelFreshness.value
      }
    })
  })

  let poller: ReturnType<typeof setInterval> | null = null

  function startPolling(intervalMs = 60_000) {
    stopPolling()
    poller = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void refreshLive()
    }, intervalMs)
  }

  function stopPolling() {
    if (poller) clearInterval(poller)
    poller = null
  }

  return {
    intel,
    signals,
    signalCursor,
    signalTotal,
    watchlist,
    watchSymbols,
    news,
    marketEvents,
    outlook,
    operations,
    services,
    serviceSummary,
    health,
    loading,
    failed,
    readAt,
    events,
    watchRows,
    intelFreshness,
    newsFreshness,
    refreshAll,
    refreshLive,
    loadSignals,
    loadWatchlist,
    loadServices,
    startPolling,
    stopPolling
  }
}

export const useDashboardFeed = createSharedComposable(_useDashboardFeed)
