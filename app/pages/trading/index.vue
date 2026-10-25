<script setup lang="ts">
// =============================================================================
//  Trade Terminal (route /trading, seed id `trade_terminal`) — S5.
//
//  Live desk built on the market plane: shared /ws/market stream
//  (useMarketStream singleton) + S4 REST history feeding lightweight-charts.
//  Panels: symbol/timeframe controls, candlestick chart, quote header,
//  recent-trades tape and stream/provider status.
//
//  Replay mode (Phase 7R2): attach a session -> the chart, quote header and
//  ticket switch to the replay clock (D17), symbol/tf lock, and a 1.5s poll
//  of read(id, cursor) feeds bars/orders/positions to the panels. Detach
//  returns every panel to the live plane.
// =============================================================================
import {
  formatPrice,
  formatQty,
  spreadOf,
  type CandleInput,
  type CandleMessage,
  type QuoteMessage
} from '../../utils/marketFeed'
import { INDICATORS, type IndicatorKind, type IndicatorSelection } from '../../utils/indicators'
import { fmtSigned } from '../../utils/terminal'
import { mergeNewsMarkers } from '../../utils/newsMarkers'
import type {
  IntelAccum,
  IntelData,
  IntelFlow,
  IntelFunding,
  IntelNewsItem,
  IntelRegime,
  IntelZone
} from '#shared/types/intel'
import type {
  ReplayCandle,
  ReplayOrder,
  ReplayPosition,
  ReplayReadResponse,
  ReplaySummary
} from '#shared/types/replay'
import type { ConfluenceDetail, MethodEvent } from '#shared/types/methods'
import type { Instrument } from '#shared/types/instruments'
import type { JournalEntry } from '#shared/types/journal'
import type { SymbolRow } from '~/components/trading/SymbolSearchModal.vue'
import type { UniverseRow } from '~/composables/useMarketCatalog'
import type { DeskTab } from '~/composables/useTerminalPrefs'
import { useStorage } from '@vueuse/core'
import { isAuthError } from '../../shared/utils/errors'

const { t } = useI18n()
const auth = useAuth()
const { prefs: termPrefs, reset: resetTerminalPrefs } = useTerminalPrefs()
const { title, description } = useAdminPageChrome({
  titleKey: 'trade.title',
  descKey: 'trade.desc'
})

const trail = computed(() => [{ label: t('nav.trading') }, { label: title.value }])

useHead({ title })

const feed = useMarketStream()
// Market Explorer deep-links (/trading?instrument=BTCUSDT — §57.4 B). The
// symbols watch below falls back to the first served symbol if invalid.
const route = useRoute()
// Full served scale first (query defaults below validate against it).
const ALL_TFS = [
  '1m', '3m', '4m', '5m', '10m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M'
] as const
const TF_LABEL: Record<string, string> = { '1d': '1D', '3d': '3D', '1w': '1W' }
const tfLabel = (tf: string): string => TF_LABEL[tf] ?? tf

const querySymbol = typeof route.query.instrument === 'string' && /^[A-Z0-9]{5,20}$/.test(route.query.instrument)
  ? route.query.instrument
  : (termPrefs.value.symbol ?? 'BTCUSDT')
const symbol = ref(querySymbol)
const queryTf = typeof route.query.tf === 'string' && (ALL_TFS as readonly string[]).includes(route.query.tf)
  ? route.query.tf
  : (termPrefs.value.timeframe && (ALL_TFS as readonly string[]).includes(termPrefs.value.timeframe) ? termPrefs.value.timeframe : '1m')
const timeframe = ref(queryTf)

// Workspace persistence (v3.4 §33/§54): symbol + timeframe ride the URL
// query (shareable links, survives reload) and are mirrored into the persisted
// workspace blob so opening /trading without a query resumes the last desk.
// Replace (no history spam); writes only on real change.
watch(symbol, (s) => {
  termPrefs.value.symbol = s
  if (route.query.instrument !== s) void navigateTo({ query: { ...route.query, instrument: s } }, { replace: true })
})
watch(timeframe, (tf) => {
  termPrefs.value.timeframe = tf
  if (route.query.tf !== tf) void navigateTo({ query: { ...route.query, tf } }, { replace: true })
})

onMounted(() => {
  feed.connect()
  void loadIntel()
  void loadJournal()
  void loadUniverse()
  startIntelPoll()
})

const symbols = computed(() =>
  feed.state.hello?.symbols?.length ? feed.state.hello.symbols : ['BTCUSDT']
)

// Session-served symbols: hello bootstrap + runtime subscribes (declared up
// here so the reset-watch below never snaps back a just-subscribed symbol).
const extraSymbols = ref<string[]>([])
const servedSymbols = computed(() => [...new Set([...symbols.value, ...extraSymbols.value])])

// -----------------------------------------------------------------------------
//  The LIVE plane only streams candle frames for the `liveTimeframes` subset
//  (whatever the WS hello advertises, default 1m/4m/10m). History-only picks
//  still render the full indicator stack over REST bars — just without a live
//  tail (modal badges say Live/History, never silent). The quick bar shows a
//  user-pinned subset (persisted); the modal lists all.
// -----------------------------------------------------------------------------
const DEFAULT_QUICK_TFS = ['1m', '5m', '15m', '1h', '4h']
const MAX_QUICK_TFS = 8
const quickTfs = useStorage<string[]>('trade-quick-tfs', [...DEFAULT_QUICK_TFS])
// Sanitize stored prefs (unknown/empty/overlong -> safe subset of ALL_TFS).
quickTfs.value = [...new Set(quickTfs.value.filter((t) => (ALL_TFS as readonly string[]).includes(t)))].slice(0, MAX_QUICK_TFS)
if (!quickTfs.value.length) quickTfs.value = [...DEFAULT_QUICK_TFS]

const tfPickerOpen = ref(false)
const toggleQuickTf = (tf: string): void => {
  const i = quickTfs.value.indexOf(tf)
  if (i >= 0) {
    if (quickTfs.value.length <= 1) return // keep at least one quick button
    quickTfs.value.splice(i, 1)
  } else if (quickTfs.value.length < MAX_QUICK_TFS) {
    const order = ALL_TFS as readonly string[]
    quickTfs.value = [...quickTfs.value, tf]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
}

/** Timeframes that receive live candle frames from the plane. */
const liveTimeframes = computed<ReadonlySet<string>>(() => {
  const list = feed.state.hello?.timeframes?.length ? feed.state.hello.timeframes : ['1m', '4m', '10m']
  return new Set(list)
})

const isLiveTf = (tf: string): boolean => liveTimeframes.value.has(tf)

// Keep the selection valid once the hello snapshot reveals the live subset
// (runtime-subscribed symbols count as served — never snap back mid-session).
// A deep-linked symbol is only replaced once the plane has actually spoken:
// before the hello arrives we hold the URL symbol instead of silently
// overriding it with the placeholder list (and we say so when it happens).
watch(servedSymbols, (list) => {
  if (!list.length || list.includes(symbol.value)) return
  if (!feed.state.hello?.symbols?.length) return
  const requested = symbol.value
  const fallback = list[0]!
  symbol.value = fallback
  toast.add({
    title: t('trade.symbolSearch'),
    description: t('trade.symbolNotServed', { symbol: requested, fallback }),
    icon: 'i-lucide-info',
    color: 'warning'
  })
}, { immediate: true })

// Dead-feed watchdog: some symbols never flow on some networks (venue
// filtering upstream). After 15s without any quote, say so explicitly with
// a way back — instead of "waiting" forever (D12).
const quoteWaitExpired = ref(false)
let quoteTimer: ReturnType<typeof setTimeout> | null = null
const armQuoteWatchdog = (): void => {
  quoteWaitExpired.value = false
  if (quoteTimer) clearTimeout(quoteTimer)
  quoteTimer = setTimeout(() => {
    quoteTimer = null
    if (!displayQuote.value) quoteWaitExpired.value = true
  }, 15_000)
}
watch(symbol, () => armQuoteWatchdog())
onMounted(() => armQuoteWatchdog())
onUnmounted(() => {
  if (quoteTimer) clearTimeout(quoteTimer)
})

const quote = computed(() => feed.state.quotes[symbol.value])
const tape = computed(() =>
  feed.state.trades.filter((trade) => trade.symbol === symbol.value).slice(0, 25)
)

// Instrument metadata from the canonical catalog (fail-soft to empty).
// NOTE: one engine symbol maps to SEVERAL catalog rows (BTCUSDT is both
// crypto:perp and crypto:spot) — never collapse to one map entry (last row
// used to win and the futures terminal read "spot"). instrumentType below
// picks the row served by the live feed instead.
const catalogList = ref<Instrument[]>([])
const catalogBase = ref<Record<string, string>>({})
const catalog = useMarketCatalog()
onMounted(async () => {
  const list = await catalog.instruments()
  catalogList.value = list
  const base: Record<string, string> = {}
  for (const inst of list) {
    const eng = inst.engineSymbol ?? inst.venues[0]?.native
    if (eng && inst.base && base[eng] === undefined) base[eng] = inst.base
  }
  catalogBase.value = base
})

// Indicator toggles (roadmap 7T: "indicator controls"). Selection = ids with
// schema default params; the chart mounts/unmounts series from this list.
// Persisted (workspace) + sanitized against the engine registry.
const DEFAULT_INDICATORS = ['ema', 'rsi']
const enabledIndicators = useStorage<string[]>('trade-indicators', [...DEFAULT_INDICATORS])
{
  const known = new Set(INDICATORS.map((i) => i.id))
  enabledIndicators.value = [...new Set(enabledIndicators.value.filter((id) => known.has(id)))]
}
const toggleIndicator = (id: string): void => {
  const idx = enabledIndicators.value.indexOf(id)
  if (idx >= 0) enabledIndicators.value.splice(idx, 1)
  else enabledIndicators.value.push(id)
}
const indicatorSelections = computed<IndicatorSelection[]>(() =>
  enabledIndicators.value.map((id) => ({ id }))
)

// Flat chip row (mockup OVERLAYS strip): indicators ordered by kind —
// overlays first, then panes (oscillators), then volume. Single ribbon, no
// nested groups; the active state drives the chart series via enabledIndicators.
const kindOrder: Record<IndicatorKind, number> = { overlay: 0, pane: 1, volume: 2 }
const orderedIndicators = computed(() =>
  [...INDICATORS].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
)

// Shared method selection (roadmap 7T): MethodControls picks a method id,
// PositionPanel filters its rows by it. '' = no filter.
const activeMethod = ref('')

// Trade ticket bumps this after a successful submit so SignalPanel refreshes
// immediately (its 15s poll keeps running regardless).
const signalsReload = ref(0)

// ── Symbol-change orchestrator (C2) ─────────────────────────────────────────
// A symbol change used to fan out several immediate requests (confluence,
// journal, news markers — on top of the chart's candles and the order book).
// Flicking through the watchlist or the picker queued every intermediate symbol,
// and a slow response could land AFTER a newer one and overwrite it.
//   * debounce: only the symbol that actually settles is loaded;
//   * epoch:     a response from a superseded symbol is dropped, never applied;
//   * abort:     the in-flight confluence fetch is cancelled outright.
const SYMBOL_SETTLE_MS = 200
let symbolSettleTimer: ReturnType<typeof setTimeout> | null = null
let symbolEpoch = 0
let confluenceAbort: AbortController | null = null

// ── Band 5 execution desk (mockup tab bar: Positions / Orders / Ticket /
// Signals / Risk). One visible panel at a time — v-show keeps every panel
// mounted, so polling and lifecycle are unchanged from the old grid (and the
// long mobile scroll collapses into tabs). The open tab is part of the
// persisted workspace (TerminalPrefs) so a reload lands on the same desk.
const deskTab = computed<DeskTab>({
  get: () => termPrefs.value.deskTab,
  set: (v) => {
    termPrefs.value.deskTab = v
  }
})
const deskTabs = computed<{ key: DeskTab; label: string; icon: string }[]>(() => [
  { key: 'positions', label: t('trade.desk.positions'), icon: 'i-lucide-layers' },
  { key: 'orders', label: t('trade.desk.orders'), icon: 'i-lucide-list-ordered' },
  { key: 'ticket', label: t('trade.desk.ticket'), icon: 'i-lucide-ticket' },
  { key: 'signals', label: t('trade.desk.signals'), icon: 'i-lucide-radio' },
  { key: 'risk', label: t('trade.desk.risk'), icon: 'i-lucide-shield' },
  { key: 'journal', label: t('trade.desk.journal'), icon: 'i-lucide-book-marked' }
])

// Journal Snapshot (mockup): latest executed trades for the ACTIVE symbol
// only — read-only, fail-soft; the full workspace lives at /data-research.
const journalApi = useJournal()
const journalRows = ref<JournalEntry[]>([])
const journalLoading = ref(false)

async function loadJournal(epoch?: number): Promise<void> {
  const stale = (): boolean => epoch !== undefined && epoch !== symbolEpoch
  journalLoading.value = true
  try {
    const res = await journalApi.list({ symbol: symbol.value, limit: 5 })
    if (stale()) return // superseded symbol — drop the response
    journalRows.value = res.items
  } catch {
    if (stale()) return
    journalRows.value = []
  } finally {
    if (!stale()) journalLoading.value = false
  }
}

const journalResultColor = (r: string): 'success' | 'error' | 'primary' | 'neutral' =>
  r === 'TP' ? 'success' : r === 'SL' ? 'error' : r === 'OPEN' ? 'primary' : 'neutral'
const fmtR = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}R` : '—')

// Mobile bottom-bar: jump straight to the ticket or back to positions.
const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-ticket', label: t('trade.desk.ticket'), onSelect: () => { deskTab.value = 'ticket' } },
  { icon: 'i-lucide-layers', label: t('trade.desk.positions'), onSelect: () => { deskTab.value = 'positions' } }
]))

// -----------------------------------------------------------------------------
//  Replay orchestration (7R2): attach -> seed -> poll -> controls -> detach.
//  The page owns session state; TradeChart/TradeTicket/ReplayPanel consume it.
// -----------------------------------------------------------------------------
const replayApi = useReplay()
const toast = useToast()

const replaySession = ref<ReplaySummary | null>(null)
const replaySeed = ref<CandleInput[] | null>(null)
const replayEvents = ref<ReplayCandle[]>([])
const replayOrders = ref<ReplayOrder[]>([])
const replayPositions = ref<ReplayPosition[]>([])
const replayBusy = ref(false)
const replayError = ref('')

const inReplay = computed(() => replaySession.value !== null)

let replayTimer: ReturnType<typeof setInterval> | null = null

const replayErrorMessage = (err: unknown): string =>
  (err as { data?: { message?: string } })?.data?.message ??
  (err instanceof Error ? err.message : String(err))

const stopReplayPoll = (): void => {
  if (replayTimer) {
    clearInterval(replayTimer)
    replayTimer = null
  }
}

const startReplayPoll = (): void => {
  if (replayTimer) return
  replayTimer = setInterval(() => { void pollReplay() }, 1500)
}

/** Merge a read/step response; events are deduped by openTime (race-safe). */
const applyReplayRead = (data: ReplayReadResponse['data']): void => {
  replaySession.value = data.session
  if (data.events.length) {
    const last = replayEvents.value.at(-1)?.openTime ?? Number.NEGATIVE_INFINITY
    const fresh = data.events.filter((e) => e.openTime > last)
    if (fresh.length) replayEvents.value = [...replayEvents.value, ...fresh]
  }
  replayOrders.value = data.orders
  replayPositions.value = data.positions
}

const pollReplay = async (): Promise<void> => {
  const session = replaySession.value
  if (!session || replayBusy.value) return // stale or mid-control-call
  try {
    const data = await replayApi.read(session.id, session.cursor)
    applyReplayRead(data)
    replayError.value = ''
    if (data.session.mode === 'done') stopReplayPoll()
  } catch (err) {
    replayError.value = replayErrorMessage(err)
  }
}

/**
 * Seed = history strictly BEFORE the replay window (session.now == first bar
 * openTime). Try a deep fetch first; composite intervals cap below 800, so
 * fall back to smaller limits before giving up.
 */
const fetchReplaySeed = async (session: ReplaySummary): Promise<CandleInput[]> => {
  for (const limit of [800, 300, 100]) {
    try {
      const res = await $fetch<{ success: boolean; data?: CandleMessage[] }>(
        `/api/v1/markets/${encodeURIComponent(session.symbol)}/candles`,
        { params: { interval: session.interval, limit } }
      )
      return (res.data ?? []).filter((c) => Number(c.closeTime) < session.now)
    } catch {
      // limit too high for this interval — try the next one
    }
  }
  return []
}

const startReplay = async (): Promise<void> => {
  if (replaySession.value || replayBusy.value) return
  replayBusy.value = true
  replayError.value = ''
  try {
    const session = await replayApi.create({
      symbol: symbol.value,
      interval: timeframe.value
    })
    const seed = await fetchReplaySeed(session)
    replaySeed.value = seed
    replayEvents.value = []
    replayOrders.value = []
    replayPositions.value = []
    replaySession.value = session // chart watch -> loadReplay()
    startReplayPoll()
    toast.add({
      title: t('trade.replayStarted'),
      icon: 'i-lucide-history',
      color: 'success'
    })
  } catch (err) {
    replayError.value = replayErrorMessage(err)
  } finally {
    replayBusy.value = false
  }
}

const replayPlay = async (speed: number): Promise<void> => {
  const session = replaySession.value
  if (!session || replayBusy.value) return
  replayBusy.value = true
  replayError.value = ''
  try {
    replaySession.value = await replayApi.play(session.id, speed)
    startReplayPoll()
  } catch (err) {
    replayError.value = replayErrorMessage(err)
  } finally {
    replayBusy.value = false
  }
}

const replayPause = async (): Promise<void> => {
  const session = replaySession.value
  if (!session || replayBusy.value) return
  replayBusy.value = true
  replayError.value = ''
  try {
    replaySession.value = await replayApi.pause(session.id)
    stopReplayPoll()
  } catch (err) {
    replayError.value = replayErrorMessage(err)
  } finally {
    replayBusy.value = false
  }
}

const replayStep = async (): Promise<void> => {
  const session = replaySession.value
  if (!session || replayBusy.value) return
  replayBusy.value = true
  replayError.value = ''
  try {
    const data = await replayApi.step(session.id, 1)
    applyReplayRead(data)
    if (data.session.mode === 'done') stopReplayPoll()
  } catch (err) {
    replayError.value = replayErrorMessage(err)
  } finally {
    replayBusy.value = false
  }
}

/** Leave the session running server-side only if paused; reset every panel. */
const replayDetach = (): void => {
  const session = replaySession.value
  if (!session) return
  stopReplayPoll()
  if (session.mode === 'playing') replayApi.pause(session.id).catch(() => {})
  replaySession.value = null // chart watch -> back to live loadHistory()
  replaySeed.value = null
  replayEvents.value = []
  replayOrders.value = []
  replayPositions.value = []
  replayError.value = ''
  toast.add({
    title: t('trade.replayStopped'),
    icon: 'i-lucide-log-out',
    color: 'neutral'
  })
}

onUnmounted(() => {
  stopReplayPoll()
  stopIntelPoll()
})

/**
 * Quote header: while attached, the replay clock owns the price — synthetic
 * quote from the last played close (seed fallback before the first bar).
 */
const displayQuote = computed<QuoteMessage | null>(() => {
  if (!inReplay.value) return quote.value ?? null
  const lastEvent = replayEvents.value.at(-1)
  const price = lastEvent?.close ?? replaySeed.value?.at(-1)?.close
  if (price === undefined) return null
  return {
    type: 'market.quote',
    source: 'replay',
    symbol: replaySession.value?.symbol ?? symbol.value,
    bid: price,
    ask: price,
    last: price,
    eventTime: lastEvent?.eventTime ?? replaySession.value?.now ?? Date.now(),
    ingestTime: Date.now()
  }
})

// Mark-price hero: live quote frames carry bid/ask but not always a `last` —
// fall back to the mid-price (the same honest pattern Watchlist uses), never
// a fabricated value. `formatPrice` renders '—' when all three are missing.
const markPrice = computed<number | null>(() => {
  const q = displayQuote.value
  if (!q) return null
  if (q.last !== undefined) return q.last
  if (q.bid !== undefined && q.ask !== undefined) return (q.bid + q.ask) / 2
  return null
})

// ── Band-1 24h telemetry (mockup subheader): the rolling window is
// EXCHANGE-COMPUTED (market.ticker24) — displayed, never derived locally.
// Hidden during replay: live-plane context must not leak onto the replay
// clock (D17). TICK is the only derivation: last-vs-previous trade delta.
// ─────────────────────────────────────────────────────────────────────────
const ticker = computed(() => feed.state.ticker24[symbol.value] ?? null)
const showTelemetry = computed(() => !inReplay.value && ticker.value !== null)

const changePct = computed(() => ticker.value?.priceChangePercent ?? null)
const changeColor = computed(() =>
  (changePct.value ?? 0) > 0 ? 'text-success' : (changePct.value ?? 0) < 0 ? 'text-error' : 'text-muted'
)
const changeText = computed(() =>
  changePct.value === null ? '—' : `${fmtSigned(changePct.value)}%`
)
const volText = computed(() => {
  const t = ticker.value
  if (!t) return '—'
  const base = catalogBase.value[symbol.value]
  const qty = formatQty(t.baseVolume)
  return base ? `${qty} ${base}` : qty
})
const tickDelta = computed<number | null>(() => {
  const list = tape.value
  if (list.length < 2) return null
  const a = list[0]?.price
  const b = list[1]?.price
  return typeof a === 'number' && typeof b === 'number' ? a - b : null
})
const tickColor = computed(() =>
  (tickDelta.value ?? 0) > 0 ? 'text-success' : (tickDelta.value ?? 0) < 0 ? 'text-error' : 'text-muted'
)

// ── Symbol search modal (TradingView-style): the modal filters + navigates
// by keyboard; the page only provides served rows and assigns the pick (the
// reset-watch guarantees every pick is served — no reload, no dead panels).
const pickerOpen = ref(false)

// Desk keyboard: "/" opens the symbol picker from anywhere (the standard
// terminal gesture). Ignored while a field owns focus or a modifier is held, so
// typing into price/qty inputs never triggers it. Ctrl/Cmd+Enter submits the
// ticket (handled inside TradeTicket, next to its own validation).
function onDeskHotkey(e: KeyboardEvent): void {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
  e.preventDefault()
  pickerOpen.value = true
}
onMounted(() => window.addEventListener('keydown', onDeskHotkey))
onUnmounted(() => window.removeEventListener('keydown', onDeskHotkey))

const universeRows = ref<UniverseRow[]>([])

/**
 * Client-side cap for the picker row set. The universe now unions many vendors
 * (perp + spot), so the cap must sit well above the live row count — dropping
 * rows here would silently hide searchable symbols (ranking runs client-side).
 */
const PICKER_MAX_ROWS = 12_000

/** symbol -> venue ids, preferring rows the ACTIVE feed market can serve. */
const watchVenues = computed<Record<string, string[]>>(() => {
  const out: Record<string, string[]> = {}
  for (const r of universeRows.value) {
    if (!r.venues?.length) continue
    const served = r.markets.includes(feedKind.value)
    if (!out[r.symbol] || served) out[r.symbol] = r.venues
  }
  return out
})

async function loadUniverse(): Promise<void> {
  try {
    const res = await catalog.universe()
    if (res) universeRows.value = res.rows
  } catch {
    universeRows.value = []
  }
}

// Feed exchange kind (hello provider market): only matching rows are
// switchable — index snapshots and foreign-market rows render disabled.
const feedKind = computed<'futures' | 'spot'>(() => {
  const m = (feed.state.hello?.provider as { market?: unknown } | null)?.market
  return m === 'spot' ? 'spot' : 'futures'
})

const pickerAllRows = computed<SymbolRow[]>(() => {
  if (universeRows.value.length) {
    return universeRows.value.slice(0, PICKER_MAX_ROWS).map((r) => {
      const selectable = r.type !== 'index' && r.markets.includes(feedKind.value)
      return {
        key: `${r.symbol}|${r.type}`,
        symbol: r.symbol,
        base: r.base,
        quote: r.quote,
        type: r.type,
        markets: r.markets,
        selectable,
        hint: selectable
          ? undefined
          : r.type === 'index'
            ? t('trade.indexNotChartable')
            : t('trade.spotNotServed'),
        value: r.value ?? null,
        unit: r.unit ?? null,
        source: r.source,
        venues: r.venues
      }
    })
  }
  // Fallback: served symbols only (universe unreachable).
  return symbols.value.slice(0, 100).map((sym) => {
    const matches = catalogList.value.filter(
      (i) => (i.engineSymbol ?? i.venues[0]?.native) === sym
    )
    const first = matches[0]
    const venues = [...new Set(matches.flatMap((i) => (i.venues ?? []).map((v) => v.venue)))]
    return {
      key: sym,
      symbol: sym,
      base: first?.base ?? '',
      quote: first?.quote ?? '',
      type: first?.type ?? '',
      markets: [...new Set(
        matches.flatMap((i) => (i.venues ?? []).map((v) => v.market).filter((m): m is 'spot' | 'futures' => !!m))
      )],
      selectable: true,
      source: venues[0] ?? null,
      venues
    }
  })
})

const subscribingSymbol = ref<string | null>(null)

const pickSymbol = async (eng: string): Promise<void> => {
  if (subscribingSymbol.value) return
  if (eng === symbol.value) {
    pickerOpen.value = false
    return
  }
  if (servedSymbols.value.includes(eng)) {
    symbol.value = eng
    pickerOpen.value = false
    return
  }
  // Runtime feed join: subscribe first — the symbol only becomes active
  // once the plane accepted it (stays on the current symbol otherwise).
  subscribingSymbol.value = eng
  try {
    const added = await feed.subscribe([eng])
    if (!added.includes(eng)) throw new Error('subscribe-not-accepted')
    if (!extraSymbols.value.includes(eng)) extraSymbols.value.push(eng)
    symbol.value = eng
    pickerOpen.value = false
  } catch (err) {
    toast.add({
      title: t('trade.symbolSearch'),
      description: getErrorMessage(err, (key) => t(key)),
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    subscribingSymbol.value = null
  }
}

// ── Pane visibility (Band 1 gear): heavy DOM (tape/method/confluence) is
// opt-in; the core desk (chart, ticket, positions) always renders. Persisted.
const DEFAULT_PANES = {
  watchlist: true,
  orderbook: false,
  tape: false,
  intel: false,
  methods: false
} as const
type PaneKey = keyof typeof DEFAULT_PANES
// v2 key: v1 defaults (book on, watchlist off) are superseded — a fresh key
// guarantees every client lands on the new core-minimal layout.
const panes = useStorage<Record<PaneKey, boolean>>('trade-panes-v2', { ...DEFAULT_PANES })
for (const k of Object.keys(DEFAULT_PANES) as PaneKey[]) {
  if (typeof panes.value[k] !== 'boolean') panes.value[k] = DEFAULT_PANES[k]
}
const layoutOpen = ref(false)
const setPane = (key: string, v: unknown): void => {
  if ((Object.keys(DEFAULT_PANES) as string[]).includes(key)) {
    panes.value[key as PaneKey] = v === true
  }
}

/** Restore the whole desk to defaults (persisted blob + the legacy keys). */
const resetWorkspace = (): void => {
  resetTerminalPrefs()
  quickTfs.value = [...DEFAULT_QUICK_TFS]
  enabledIndicators.value = [...DEFAULT_INDICATORS]
  panes.value = { ...DEFAULT_PANES }
  toast.add({
    title: t('trade.layout.label'),
    description: t('trade.layout.reset'),
    icon: 'i-lucide-rotate-ccw',
    color: 'neutral'
  })
}
const paneToggles = computed<{ key: PaneKey; label: string }[]>(() => [
  { key: 'watchlist', label: t('trade.watchlist') },
  { key: 'orderbook', label: t('trade.orderbook') },
  { key: 'tape', label: t('trade.tape') },
  { key: 'intel', label: t('trade.layout.intel') },
  { key: 'methods', label: t('trade.layout.methods') }
])

// Dock columns follow visibility (chart stretches when rails hide). The spans
// must always add up to 12: the watchlist rail is 3 and the right rail 3, so a
// chart of 10 next to a visible watchlist would wrap onto the next grid row and
// push the chart below the rail.
const showWatchlist = computed(() => panes.value.watchlist)
const showRight = computed(() => panes.value.orderbook || panes.value.tape)
const chartCol = computed(() =>
  !showWatchlist.value && !showRight.value
    ? 'lg:col-span-12'
    : !showWatchlist.value
      ? 'lg:col-span-9'
      : !showRight.value
        ? 'lg:col-span-9'
        : 'lg:col-span-6'
)

const connectionBadge = computed(() => {
  switch (feed.state.connection) {
    case 'open':
      return { color: 'success' as const, label: t('trade.connected') }
    case 'connecting':
      return { color: 'warning' as const, label: t('trade.connecting') }
    case 'error':
      return { color: 'error' as const, label: t('trade.error') }
    default:
      return { color: 'neutral' as const, label: t('trade.disconnected') }
  }
})

const providerState = computed(() =>
  feed.state.providerStatus?.state ??
  ((feed.state.hello?.provider as { state?: string } | null)?.state ?? null)
)

// -----------------------------------------------------------------------------
//  Intel overlays (Phase 8/9): the terminal taps the same read-only /api/v1/
//  intel payload as the intel page (D1 — nothing is recalculated here). The
//  chart gets liquidation zone price-lines + news markers; the TradeIntel
//  strip shows regime/funding/OI/flow/accum chips for the active symbol.
//  Everything is real-time context — hidden entirely during replay (D17).
// -----------------------------------------------------------------------------
const intelApi = useIntel()
const intel = ref<IntelData | null>(null)
let intelTimer: ReturnType<typeof setInterval> | null = null
// Session lost (401): polling is suspended until re-authentication. Retrying
// a lapsed token every 60s only produces console noise, and the chart already
// keeps rendering the last known snapshot (D1).
let intelHalted = false

const loadIntel = async (): Promise<void> => {
  if (intelHalted) return
  try {
    intel.value = await intelApi.get()
    intelHalted = false
  } catch (err) {
    // keep the previous snapshot — never blank the overlays on a transient miss
    if (isAuthError(err)) {
      intelHalted = true
      stopIntelPoll()
      return // don't chain the confluence fetch onto a known-dead session
    }
  }
  void loadConfluence()
  void loadEventNews()
}

const stopIntelPoll = (): void => {
  if (intelTimer) {
    clearInterval(intelTimer)
    intelTimer = null
  }
}

const startIntelPoll = (): void => {
  if (intelTimer) return
  intelTimer = setInterval(() => { void loadIntel() }, 60_000)
}

// Resume the intel + confluence poll once the user re-authenticates.
watch(() => auth.isAuthenticated.value, (authed) => {
  if (authed && intelHalted) {
    intelHalted = false
    startIntelPoll()
    void loadIntel()
  }
})

const intelFunding = computed<IntelFunding | null>(() =>
  intel.value?.funding.find((f) => f.symbol === symbol.value) ?? null
)
const intelFlow = computed<IntelFlow | null>(() =>
  intel.value?.flows.find((f) => f.symbol === symbol.value) ?? null
)
const intelAccum = computed<IntelAccum | null>(() =>
  intel.value?.accums.find((a) => a.symbol === symbol.value) ?? null
)
const intelZone = computed<IntelZone | null>(() =>
  intel.value?.zones.find((z) => z.symbol === symbol.value) ?? null
)
const intelNews = computed<IntelNewsItem[]>(() => intel.value?.news ?? [])
// Slice D: certain-linked, non-retracted MarketEvents for the active symbol
// merge into the chart markers (intel snapshot wins link ties, replay hides).
const eventNews = ref<IntelNewsItem[]>([])
const chartNews = computed<IntelNewsItem[]>(() => mergeNewsMarkers(intelNews.value, eventNews.value))
const newsDesk = useNewsDesk()
const loadEventNews = async (epoch?: number): Promise<void> => {
  try {
    const rows = await newsDesk.loadSymbolMarkers(symbol.value)
    if (epoch !== undefined && epoch !== symbolEpoch) return // superseded symbol
    eventNews.value = rows
  } catch {
    if (epoch !== undefined && epoch !== symbolEpoch) return
    eventNews.value = []
  }
}
const intelOiTrend = computed<number | null>(() =>
  intel.value?.regime?.sweep.find((s) => s.symbol === symbol.value)?.oiTrendPct ?? null
)
const intelRegime = computed<IntelRegime | null>(() => intel.value?.regime ?? null)

// -----------------------------------------------------------------------------
//  Phase 10 — method events + confluence explanation for the active symbol.
//  Both are READ-ONLY API views (D1): the events /api/v1/methods/events and
//  the weighted confluence /api/v1/intel/confluence/:symbol. Replay-owned
//  bars never carry live method context (D17) — the page blanks the props.
// -----------------------------------------------------------------------------
const {
  methods: methodMeta,
  league: methodLeague,
  enabled: enabledMethods,
  events: methodEvents,
  loading: methodLoading,
  error: methodError,
  toggle: toggleMethod,
  refresh: refreshMethods
} = useMethods(symbol, timeframe)

const selectedMethodEvent = ref<MethodEvent | null>(null)
const selectMethodEvent = (ev: MethodEvent): void => {
  selectedMethodEvent.value = ev
}

const clearMethods = (): void => {
  enabledMethods.value = []
  void refreshMethods()
}

const confluenceDetail = ref<ConfluenceDetail | null>(null)
const confluenceLoading = ref(false)

const loadConfluence = async (signal?: AbortSignal, epoch?: number): Promise<void> => {
  if (intelHalted) return // session known dead — don't re-probe
  confluenceLoading.value = true
  try {
    const res = await $fetch<{ success: boolean; data: ConfluenceDetail | null }>(
      `/api/v1/intel/confluence/${encodeURIComponent(symbol.value)}`,
      signal ? { signal } : undefined
    )
    if (epoch !== undefined && epoch !== symbolEpoch) return // superseded symbol
    confluenceDetail.value = res.data ?? null
  } catch {
    if (epoch !== undefined && epoch !== symbolEpoch) return
    confluenceDetail.value = null
  } finally {
    if (epoch === undefined || epoch === symbolEpoch) confluenceLoading.value = false
  }
}

/**
 * Load the per-symbol context exactly once, for the symbol that settled
 * (debounced + epoch-guarded). The chart candles and the order book keep their
 * own immediate watchers — this covers the secondary panels only.
 */
function loadSymbolContext(): void {
  confluenceAbort?.abort()
  const controller = new AbortController()
  confluenceAbort = controller
  const epoch = ++symbolEpoch
  void loadConfluence(controller.signal, epoch)
  void loadJournal(epoch)
  void loadEventNews(epoch)
}

watch(symbol, () => {
  selectedMethodEvent.value = null
  if (symbolSettleTimer) clearTimeout(symbolSettleTimer)
  symbolSettleTimer = setTimeout(() => {
    symbolSettleTimer = null
    loadSymbolContext()
  }, SYMBOL_SETTLE_MS)
})

onUnmounted(() => {
  if (symbolSettleTimer) clearTimeout(symbolSettleTimer)
  confluenceAbort?.abort()
})

const tapeTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-GB', { hour12: false })

const sideClass = (side?: string): string =>
  side === 'buy' ? 'text-success' : side === 'sell' ? 'text-error' : 'text-default'

// Canonical instrument type for the symbol chip in the stat header (PERP…).
// Prefers the catalog row served by the LIVE feed (quote.market) — the
// futures terminal must read PERP even though BTCUSDT also exists as spot.
const instrumentType = computed<string>(() => {
  const rows = catalogList.value.filter(
    (i) => (i.engineSymbol ?? i.venues[0]?.native) === symbol.value
  )
  if (!rows.length) return 'perp'
  const feedMarket = displayQuote.value?.market ?? quote.value?.market ?? 'futures'
  const exact = rows.find((i) => (i.venues ?? []).some((v) => v.market === feedMarket))
  return (exact ?? rows[0])!.type
})

// ─────────────────────────────────────────────────────────────────────────────
//  Band 3 + 4 (mockup): compact replay strip + method/confluence bar.
//  The mockup collapses the big ReplayPanel / MethodEventsPanel / ConfluenceCard
//  cards into two slim full-width bands so the dock + execution desk fit above
//  the fold on desktop. These helpers format the SAME real data (replaySession,
//  methodEvents, confluenceDetail) — no fabricated values.
// ─────────────────────────────────────────────────────────────────────────────
const replaySpeed = ref(1)
const setReplaySpeed = (s: number): void => { replaySpeed.value = s }
const startReplayAtSpeed = async (): Promise<void> => {
  await startReplay()
  if (inReplay.value && replaySession.value) await replayPlay(replaySpeed.value)
}

// Latest method event per method id (newest first) — drives the event chips.
const latestMethodEvents = computed<MethodEvent[]>(() => {
  const seen = new Set<string>()
  const out: MethodEvent[] = []
  for (const ev of [...methodEvents.value].sort((a, b) => b.time - a.time)) {
    if (seen.has(ev.method)) continue
    seen.add(ev.method)
    out.push(ev)
  }
  return out.slice(0, 4)
})

// Toned + formatted confluence parts for the bar (real values from the API).
const confParts = computed(() =>
  (confluenceDetail.value?.parts ?? []).map(p => ({
    key: p.key,
    label: p.label || p.key,
    text: fmtSigned(p.value, 2),
    positive: p.value > 0,
    negative: p.value < 0
  }))
)
const netConfluenceText = computed(() =>
  confluenceDetail.value ? fmtSigned(confluenceDetail.value.score, 2) : '—'
)
const netConfluenceTone = computed(() => {
  const s = confluenceDetail.value?.score
  return s == null ? 'text-muted' : s > 0 ? 'text-success' : s < 0 ? 'text-error' : 'text-muted'
})
const netConfluenceLabel = computed(() => {
  const s = confluenceDetail.value?.score
  if (s == null) return t('trade.confEmpty')
  return s >= 0.15 ? t('trade.bullish') : s <= -0.15 ? t('trade.bearish') : t('trade.neutral')
})
const netConfluenceFill = computed(() => {
  const s = confluenceDetail.value?.score ?? 0
  return `${Math.round(Math.min(Math.abs(s), 1) * 100)}%`
})
const eventToneClass = (score: number): string =>
  score > 0 ? 'bg-success' : score < 0 ? 'bg-error' : 'bg-info'
</script>

<template>
  <!-- Terminal workspace: title only, no description block (mockup has no page header) -->
  <BasePage id="trade" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('trade.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="inReplay" color="warning" variant="solid" size="sm">
          {{ t('trade.replayBadge') }}
        </UBadge>
        <UBadge :color="connectionBadge.color" variant="subtle" size="sm">
          {{ connectionBadge.label }}
        </UBadge>
        <UBadge v-if="providerState" color="info" variant="soft" size="sm">
          {{ providerState }}
        </UBadge>
      </div>
    </template>

    <div class="flex flex-col w-full gap-1 pb-24 lg:pb-1">
      <!-- ── Band 1: two slim rows, seamless with Band 2 ──
        Row 1: symbol picker · timeframe quick bar + all-list + display gear.
        Row 2: quote strip (left) · VOL/TICK telemetry (right). One connection
        badge only (header) — the provider duplicate is gone. -->
      <div class="flex flex-col gap-1 px-2 py-1.5 bg-muted/40 border border-default border-b-0">
        <div class="flex items-center gap-2 min-w-0">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-elevated/60 disabled:opacity-60 disabled:hover:bg-transparent shrink-0"
            :disabled="inReplay"
            :aria-expanded="pickerOpen"
            :aria-label="t('trade.pickerSearch')"
            data-testid="symbol-picker"
            @click="pickerOpen = !pickerOpen"
          >
            <span class="font-mono text-sm font-semibold text-highlighted">{{ symbol }}</span>
            <UBadge :label="instrumentType.toUpperCase()" color="neutral" variant="subtle" size="xs" />
            <UIcon :name="pickerOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5 text-dimmed shrink-0" />
          </button>
          <div class="flex-1 min-w-0" />
          <div class="flex items-center gap-1 overflow-x-auto" role="group" :aria-label="t('trade.tf')">
            <UButton
              v-for="tf in quickTfs"
              :key="tf"
              size="xs"
              :color="tf === timeframe ? 'primary' : 'neutral'"
              :variant="tf === timeframe ? 'soft' : 'ghost'"
              :disabled="inReplay"
              :title="isLiveTf(tf) ? tfLabel(tf) : `${tfLabel(tf)} — ${t('trade.tfHistoryHint')}`"
              :data-testid="`tf-${tf}`"
              class="shrink-0"
              @click="timeframe = tf"
            >
              {{ tfLabel(tf) }}
            </UButton>
            <UButton
              size="xs"
              :icon="tfPickerOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :color="tfPickerOpen ? 'primary' : 'neutral'"
              :variant="tfPickerOpen ? 'soft' : 'ghost'"
              :aria-expanded="tfPickerOpen"
              :aria-label="t('trade.tfAll')"
              :title="t('trade.tfAll')"
              data-testid="tf-all"
              class="shrink-0"
              @click="tfPickerOpen = true"
            />
          </div>
          <UButton
            size="xs"
            icon="i-lucide-sliders-horizontal"
            :color="layoutOpen ? 'primary' : 'neutral'"
            :variant="layoutOpen ? 'soft' : 'ghost'"
            :aria-expanded="layoutOpen"
            :aria-label="t('trade.layout.label')"
            :title="t('trade.layout.label')"
            data-testid="layout-toggle"
            class="shrink-0"
            @click="layoutOpen = !layoutOpen"
          />
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <div v-if="displayQuote" class="flex flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs min-w-0">
            <span class="flex items-baseline gap-1"><span class="text-[9px] uppercase tracking-wider text-dimmed">{{ t('trade.markPrice') }}</span><span class="font-semibold text-highlighted">{{ formatPrice(markPrice) }}</span></span>
            <span v-if="showTelemetry" class="flex items-baseline gap-1"><span class="text-[9px] uppercase tracking-wider text-dimmed">{{ t('trade.change24h') }}</span><span class="font-semibold" :class="changeColor">{{ changeText }}</span></span>
            <span class="flex items-baseline gap-1"><span class="text-[9px] uppercase tracking-wider text-dimmed">{{ t('trade.bid') }}</span><span class="font-semibold text-primary">{{ formatPrice(displayQuote.bid) }}</span></span>
            <span class="flex items-baseline gap-1"><span class="text-[9px] uppercase tracking-wider text-dimmed">{{ t('trade.ask') }}</span><span class="font-semibold text-error">{{ formatPrice(displayQuote.ask) }}</span></span>
            <span class="flex items-baseline gap-1"><span class="text-[9px] uppercase tracking-wider text-dimmed">{{ t('trade.spread') }}</span><span class="text-default">{{ formatPrice(spreadOf(displayQuote)) }}</span></span>
          </div>
          <span v-else-if="!quoteWaitExpired" class="flex-1 text-xs text-dimmed">{{ t('trade.waitingQuote') }}</span>
          <div v-else class="flex flex-1 items-center gap-2 min-w-0">
            <UIcon name="i-lucide-cloud-off" class="size-3.5 text-warning shrink-0" />
            <span class="text-[11px] text-muted truncate">{{ t('trade.noFeedHint') }}</span>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              class="shrink-0"
              @click="symbol = servedSymbols[0] ?? 'BTCUSDT'"
            >
              {{ t('trade.backTo', { symbol: servedSymbols[0] ?? 'BTCUSDT' }) }}
            </UButton>
          </div>
          <div v-if="showTelemetry" class="flex items-center gap-1.5 font-mono text-[11px] shrink-0">
            <span class="px-2 py-0.5 rounded bg-elevated text-secondary">{{ t('trade.vol24h') }}: {{ volText }}</span>
            <span v-if="tickDelta !== null" class="px-2 py-0.5 rounded bg-elevated" :class="tickColor">{{ t('trade.tick') }}: {{ fmtSigned(tickDelta) }}</span>
          </div>
        </div>
      </div>

      <!-- ── Overlays (no layout shift): symbol search, timeframe list, display ── -->
      <TradingSymbolSearchModal
        :open="pickerOpen"
        :rows="pickerAllRows"
        :pending-symbol="subscribingSymbol"
        @update:open="pickerOpen = $event"
        @select="pickSymbol"
      />
      <TradingTimeframeModal
        :open="tfPickerOpen"
        :current="timeframe"
        :quick="quickTfs"
        :all="ALL_TFS"
        :labels="TF_LABEL"
        :live="[...liveTimeframes]"
        @update:open="tfPickerOpen = $event"
        @select="timeframe = $event"
        @toggle-quick="toggleQuickTf"
      />
      <TradingDisplayModal
        :open="layoutOpen"
        :panes="{ items: paneToggles, values: panes }"
        @update:open="layoutOpen = $event"
        @toggle="setPane"
        @reset="resetWorkspace"
      />

      <!-- ── Band 2: indicator quick-toggles — right-aligned under VOL/TICK on mobile ── -->
      <div class="flex flex-wrap items-center justify-end lg:justify-start gap-1 px-3 py-1.5 bg-default border-x border-default" data-testid="indicator-toggles" role="group" :aria-label="t('trade.quickToggles')">
        <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-dimmed mr-1"><UIcon name="i-lucide-list-checks" class="size-3.5 text-primary" />{{ t('trade.quickToggles') }}</span>
        <UButton
          v-for="ind in orderedIndicators"
          :key="ind.id"
          size="xs"
          :color="enabledIndicators.includes(ind.id) ? 'primary' : 'neutral'"
          :variant="enabledIndicators.includes(ind.id) ? 'soft' : 'ghost'"
          :aria-pressed="enabledIndicators.includes(ind.id)"
          :data-testid="`ind-${ind.id}`"
          @click="toggleIndicator(ind.id)"
        >
          {{ t(`trade.ind.${ind.id}`) }}
        </UButton>
      </div>

      <!-- ── Band 3: per-symbol intel chips (Phase 8/9, hidden in replay, opt-in) ── -->
      <TradingTradeIntel v-if="!inReplay && panes.intel" :symbol="symbol" :funding="intelFunding" :flow="intelFlow" :accum="intelAccum" :regime="intelRegime" :oi-trend-pct="intelOiTrend" />

      <!-- ── Replay (mockup strip): one line when detached, full panel when attached ── -->
      <div v-if="!replaySession" class="flex items-center gap-2 px-3 py-1.5 rounded border border-default bg-default">
        <UIcon name="i-lucide-history" class="size-3.5 text-primary shrink-0" />
        <span class="text-[11px] text-muted truncate">{{ t('trade.replay') }}</span>
        <div class="flex-1" />
        <UButton
          size="xs"
          color="primary"
          variant="soft"
          icon="i-lucide-play"
          :loading="replayBusy"
          @click="startReplay"
        >
          {{ t('trade.replayStart') }}
        </UButton>
      </div>
      <TradingReplayPanel v-else :session="replaySession" :events="replayEvents" :orders="replayOrders" :positions="replayPositions" :seed="replaySeed" :active-method="activeMethod" :busy="replayBusy" :error="replayError" @start="startReplay" @play="replayPlay" @pause="replayPause" @step="replayStep" @detach="replayDetach" />
      <p v-if="replayError && !replaySession" class="text-[11px] text-error px-1">{{ replayError }}</p>

      <!-- ── THE DOCK (mockup: flush 12-col — watchlist 2 / chart 7 / order-book+trades 3) ── -->
      <div class="grid grid-cols-1 gap-1 lg:grid-cols-12 lg:items-stretch">
        <!-- Left rail: watchlist (opt-in — the Band-1 picker covers switching) -->
        <div v-if="panes.watchlist" class="lg:col-span-3 order-2 lg:order-1 flex flex-col rounded border border-default bg-default overflow-hidden">
          <TradingWatchlist :symbol="symbol" :venue-index="watchVenues" @select="symbol = $event" @add="pickerOpen = true" />
        </div>

        <!-- Chart (always on — stretches when rails hide) -->
        <div class="order-1 lg:order-2 flex flex-col rounded border border-default bg-default overflow-hidden" :class="chartCol">
          <TradingTradeChart
            :symbol="symbol"
            :timeframe="timeframe"
            :indicators="indicatorSelections"
            :replay="replaySession"
            :replay-seed="replaySeed"
            :replay-events="replayEvents"
            :zone="inReplay ? null : intelZone"
            :news="inReplay ? [] : chartNews"
            :method-events="inReplay ? [] : methodEvents"
            @select-method-event="selectMethodEvent"
          />
        </div>

        <!-- Right pane: order book + tape (both opt-in) -->
        <div v-if="panes.orderbook || panes.tape" class="lg:col-span-3 order-3 flex flex-col gap-1">
          <TradingOrderBook v-if="panes.orderbook" :symbol="symbol" />

          <!-- Stream errors only (status already lives in the header badges) -->
          <p v-if="feed.state.lastError" class="font-mono text-[11px] break-all text-error/80 px-1">{{ t('trade.lastError') }}: {{ feed.state.lastError }}</p>

          <!-- Recent trades tape (opt-in — heaviest DOM churn on the page) -->
          <div v-if="panes.tape" class="rounded border border-default bg-default p-3 flex flex-col gap-2 flex-1 min-h-40">
            <div class="flex items-baseline justify-between">
              <h3 class="text-sm font-semibold text-highlighted">{{ t('trade.tape') }}</h3>
              <span class="text-xs text-dimmed font-mono">{{ symbol }}</span>
            </div>
            <div v-if="tape.length" class="flex flex-col text-sm">
              <div class="grid grid-cols-3 gap-2 pb-1 text-[10px] uppercase tracking-wider text-dimmed border-b border-default">
                <span>{{ t('trade.time') }}</span><span class="text-right">{{ t('trade.price') }}</span><span class="text-right">{{ t('trade.qty') }}</span>
              </div>
              <div v-for="trade in tape" :key="trade.id ?? `${trade.eventTime}-${trade.ingestTime}`" class="grid grid-cols-3 gap-2 py-0.5 font-mono text-xs">
                <span class="text-dimmed">{{ tapeTime(trade.eventTime) }}</span>
                <span class="text-right" :class="sideClass(trade.side)">{{ formatPrice(trade.price) }}</span>
                <span class="text-right text-muted">{{ trade.quantity !== undefined ? trade.quantity : '—' }}</span>
              </div>
            </div>
            <p v-else class="py-6 text-center text-sm text-dimmed">{{ t('trade.tapeEmpty') }}</p>
          </div>
        </div>
      </div>

      <!-- ── Band 4: method events + confluence (Phase 10, hidden in replay, opt-in) ── -->
      <div v-if="!inReplay && panes.methods" class="grid grid-cols-1 gap-1 xl:grid-cols-2">
        <TradingMethodEventsPanel
          :symbol="symbol"
          :methods="methodMeta"
          :enabled="enabledMethods"
          :events="methodEvents"
          :loading="methodLoading"
          :error="methodError"
          :league="methodLeague"
          :selected="selectedMethodEvent"
          @toggle="toggleMethod"
          @clear="clearMethods"
        />
        <TradingConfluenceCard :symbol="symbol" :detail="confluenceDetail" :loading="confluenceLoading" />
      </div>

      <!-- ── Band 5: execution desk (mockup tab bar, roadmap §10) ── -->
      <div class="flex flex-col rounded border border-default bg-default overflow-hidden">
        <div class="flex items-center gap-1 overflow-x-auto px-2 py-1.5 border-b border-default" role="tablist" :aria-label="t('trade.desk.label')">
          <UButton
            v-for="tab in deskTabs"
            :key="tab.key"
            :icon="tab.icon"
            :label="tab.label"
            size="xs"
            :color="deskTab === tab.key ? 'primary' : 'neutral'"
            :variant="deskTab === tab.key ? 'soft' : 'ghost'"
            :aria-selected="deskTab === tab.key"
            role="tab"
            class="shrink-0"
            @click="deskTab = tab.key"
          />
        </div>
        <div class="flex flex-col gap-1 p-1.5" role="tabpanel">
          <div v-show="deskTab === 'positions'" class="flex flex-col gap-1">
            <TradingMethodControls v-model="activeMethod" />
            <TradingPositionPanel :method="activeMethod" @clear-method="activeMethod = ''" />
          </div>
          <div v-show="deskTab === 'orders'" class="flex flex-col gap-1">
            <TradingOrdersPanel :reload="signalsReload" />
            <TradingFillsPanel :reload="signalsReload" />
          </div>
          <div v-show="deskTab === 'ticket'">
            <TradingTradeTicket :symbol="symbol" :tf="timeframe" :quote="displayQuote" :replay-session-id="replaySession?.id ?? null" @placed="signalsReload++" />
          </div>
          <div v-show="deskTab === 'signals'">
            <TradingSignalPanel :symbol="symbol" :reload-key="signalsReload" />
          </div>
          <div v-show="deskTab === 'risk'">
            <TradingRiskPanel />
          </div>
          <div v-show="deskTab === 'journal'">
            <div class="flex flex-col gap-2 rounded bg-default ring ring-default p-3">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-semibold">{{ t('trade.desk.journalSnapshot') }}</h3>
                <UButton
                  icon="i-lucide-arrow-up-right"
                  :label="t('dashboard.viewAll')"
                  variant="ghost"
                  color="primary"
                  size="xs"
                  to="/data-research/journal"
                  :ui="{ label: 'hidden md:block' }"
                />
              </div>
              <div v-if="journalLoading && !journalRows.length" class="flex items-center gap-2 py-4 justify-center">
                <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" />
              </div>
              <div v-else-if="journalRows.length" class="flex flex-col">
                <div
                  v-for="j in journalRows"
                  :key="j.key"
                  class="flex items-center gap-2 py-1.5 min-w-0 border-t border-default/50 first:border-t-0"
                >
                  <UBadge :label="j.dir > 0 ? 'LONG' : 'SHORT'" :color="j.dir > 0 ? 'success' : 'error'" variant="subtle" size="xs" class="shrink-0 font-mono" />
                  <UBadge :label="j.result" :color="journalResultColor(j.result)" variant="subtle" size="xs" class="shrink-0 font-mono" />
                  <span class="flex-1 min-w-0 text-[11px] text-muted font-mono truncate">
                    {{ formatPrice(j.entryPrice) }} → {{ formatPrice(j.exitPrice) }}
                  </span>
                  <span class="text-[11px] font-mono shrink-0" :class="(j.rMultiple ?? 0) > 0 ? 'text-success' : (j.rMultiple ?? 0) < 0 ? 'text-error' : 'text-muted'">{{ fmtR(j.rMultiple) }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] text-dimmed py-2 text-center">{{ t('trade.desk.journalEmpty') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </BasePage>
</template>
