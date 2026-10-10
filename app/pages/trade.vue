<script setup lang="ts">
// =============================================================================
//  Trade Terminal (route /trade, seed id `trade_terminal`) — S5.
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
  spreadOf,
  type CandleInput,
  type CandleMessage,
  type QuoteMessage
} from '../utils/marketFeed'
import { INDICATORS, type IndicatorSelection } from '../utils/indicators'
import type {
  IntelAccum,
  IntelData,
  IntelFlow,
  IntelFunding,
  IntelNewsItem,
  IntelRegime,
  IntelZone
} from '~~/types/intel'
import type {
  ReplayCandle,
  ReplayOrder,
  ReplayPosition,
  ReplayReadResponse,
  ReplaySummary
} from '~~/types/replay'
import type { ConfluenceDetail, MethodEvent } from '~~/types/methods'

const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'trade.title',
  descKey: 'trade.desc'
})

useHead({ title })

const feed = useMarketStream()
const symbol = ref('BTCUSDT')
const timeframe = ref('1m')

onMounted(() => {
  feed.connect()
  void loadIntel()
  startIntelPoll()
})

const symbols = computed(() =>
  feed.state.hello?.symbols?.length ? feed.state.hello.symbols : ['BTCUSDT']
)
const timeframes = computed(() =>
  feed.state.hello?.timeframes?.length ? feed.state.hello.timeframes : ['1m', '4m', '10m']
)

// Keep the selection valid once the hello snapshot reveals the real lists.
watch(symbols, (list) => {
  if (list.length && !list.includes(symbol.value)) symbol.value = list[0]!
}, { immediate: true })
watch(timeframes, (list) => {
  if (list.length && !list.includes(timeframe.value)) timeframe.value = list[0]!
}, { immediate: true })

const quote = computed(() => feed.state.quotes[symbol.value])
const tape = computed(() =>
  feed.state.trades.filter((trade) => trade.symbol === symbol.value).slice(0, 25)
)

// Indicator toggles (roadmap 7T: "indicator controls"). Selection = ids with
// schema default params; the chart mounts/unmounts series from this list.
const enabledIndicators = ref<string[]>(['ema', 'rsi'])
const toggleIndicator = (id: string): void => {
  const idx = enabledIndicators.value.indexOf(id)
  if (idx >= 0) enabledIndicators.value.splice(idx, 1)
  else enabledIndicators.value.push(id)
}
const indicatorSelections = computed<IndicatorSelection[]>(() =>
  enabledIndicators.value.map((id) => ({ id }))
)

// Shared method selection (roadmap 7T): MethodControls picks a method id,
// PositionPanel filters its rows by it. '' = no filter.
const activeMethod = ref('')

// Trade ticket bumps this after a successful submit so SignalPanel refreshes
// immediately (its 15s poll keeps running regardless).
const signalsReload = ref(0)

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
  if (intelTimer) {
    clearInterval(intelTimer)
    intelTimer = null
  }
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

const loadIntel = async (): Promise<void> => {
  try {
    intel.value = await intelApi.get()
  } catch {
    // keep the previous snapshot — never blank the overlays on a transient miss
  }
  void loadConfluence()
}

const startIntelPoll = (): void => {
  if (intelTimer) return
  intelTimer = setInterval(() => { void loadIntel() }, 60_000)
}

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

const loadConfluence = async (): Promise<void> => {
  confluenceLoading.value = true
  try {
    const res = await $fetch<{ success: boolean; data: ConfluenceDetail | null }>(
      `/api/v1/intel/confluence/${encodeURIComponent(symbol.value)}`
    )
    confluenceDetail.value = res.data ?? null
  } catch {
    confluenceDetail.value = null
  } finally {
    confluenceLoading.value = false
  }
}

watch(symbol, () => {
  selectedMethodEvent.value = null
  void loadConfluence()
})

const tapeTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-GB', { hour12: false })

const sideClass = (side?: string): string =>
  side === 'buy' ? 'text-success' : side === 'sell' ? 'text-error' : 'text-default'
</script>

<template>
  <BasePage id="trade" :title="title" :description="description">
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

    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <!-- Controls: symbol, timeframe, live quote header -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-default ring ring-default p-3">
        <USelect
          v-model="symbol"
          :items="symbols"
          size="sm"
          class="w-40"
          :disabled="inReplay"
          :aria-label="t('trade.symbol')"
        />

        <div class="flex items-center gap-1" role="group" :aria-label="t('trade.tf')">
          <UButton
            v-for="tf in timeframes"
            :key="tf"
            size="xs"
            :color="tf === timeframe ? 'primary' : 'neutral'"
            :variant="tf === timeframe ? 'soft' : 'ghost'"
            :disabled="inReplay"
            @click="timeframe = tf"
          >
            {{ tf }}
          </UButton>
        </div>

        <div v-if="displayQuote" class="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span class="flex items-baseline gap-1.5">
            <span class="text-xs text-muted">{{ t('trade.bid') }}</span>
            <span class="font-mono">{{ formatPrice(displayQuote.bid) }}</span>
          </span>
          <span class="flex items-baseline gap-1.5">
            <span class="text-xs text-muted">{{ t('trade.ask') }}</span>
            <span class="font-mono">{{ formatPrice(displayQuote.ask) }}</span>
          </span>
          <span class="flex items-baseline gap-1.5">
            <span class="text-xs text-muted">{{ t('trade.spread') }}</span>
            <span class="font-mono">{{ formatPrice(spreadOf(displayQuote)) }}</span>
          </span>
        </div>
        <span v-else class="ml-auto text-xs text-muted">{{ t('trade.waitingQuote') }}</span>
      </div>

      <!-- Indicator toggles -->
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-default ring ring-default p-3"
        role="group"
        :aria-label="t('trade.indicators')"
      >
        <span class="text-xs font-medium tracking-wide text-muted uppercase">
          {{ t('trade.indicators') }}
        </span>
        <UButton
          v-for="ind in INDICATORS"
          :key="ind.id"
          size="xs"
          :color="enabledIndicators.includes(ind.id) ? 'primary' : 'neutral'"
          :variant="enabledIndicators.includes(ind.id) ? 'soft' : 'ghost'"
          :aria-pressed="enabledIndicators.includes(ind.id)"
          @click="toggleIndicator(ind.id)"
        >
          {{ t(`trade.ind.${ind.id}`) }}
        </UButton>
      </div>

      <!-- Per-symbol intel chips (Phase 8/9) — hidden while a replay session owns the terminal -->
      <TradeIntel
        v-if="!inReplay"
        :symbol="symbol"
        :funding="intelFunding"
        :flow="intelFlow"
        :accum="intelAccum"
        :regime="intelRegime"
        :oi-trend-pct="intelOiTrend"
      />

      <!-- Phase 10: method event inspector + confluence explanation (hidden in replay) -->
      <div v-if="!inReplay" class="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <MethodEventsPanel
          class="xl:col-span-2"
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
        <ConfluenceCard
          class="xl:col-span-2"
          :symbol="symbol"
          :detail="confluenceDetail"
          :loading="confluenceLoading"
        />
      </div>

      <!-- Replay controls + session book (7R2) — start CTA when detached -->
      <ReplayPanel
        :session="replaySession"
        :events="replayEvents"
        :orders="replayOrders"
        :positions="replayPositions"
        :seed="replaySeed"
        :active-method="activeMethod"
        :busy="replayBusy"
        :error="replayError"
        @start="startReplay"
        @play="replayPlay"
        @pause="replayPause"
        @step="replayStep"
        @detach="replayDetach"
      />

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <!-- Watchlist -->
        <Watchlist :symbol="symbol" @select="symbol = $event" />

        <!-- Chart -->
        <div class="p-3 rounded-lg bg-default ring ring-default xl:col-span-2">
          <TradeChart
            :symbol="symbol"
            :timeframe="timeframe"
            :indicators="indicatorSelections"
            :replay="replaySession"
            :replay-seed="replaySeed"
            :replay-events="replayEvents"
            :zone="inReplay ? null : intelZone"
            :news="inReplay ? [] : intelNews"
            :method-events="inReplay ? [] : methodEvents"
            @select-method-event="selectMethodEvent"
          />
        </div>

        <!-- Right column: orderbook + stream status + trade tape -->
        <div class="flex flex-col gap-4">
          <OrderBook :symbol="symbol" />

          <!-- Stream / provider status -->
          <div class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3">
            <h3 class="text-sm font-semibold">{{ t('trade.stream') }}</h3>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ t('trade.provider') }}</span>
              <UBadge :color="connectionBadge.color" variant="subtle" size="sm">
                {{ providerState ?? '—' }}
              </UBadge>
            </div>
            <p v-if="feed.state.lastError" class="font-mono text-xs break-all text-error/80">
              {{ t('trade.lastError') }}: {{ feed.state.lastError }}
            </p>
          </div>

          <!-- Recent trades tape -->
          <div class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2 flex-1 min-h-48">
            <div class="flex items-baseline justify-between">
              <h3 class="text-sm font-semibold">{{ t('trade.tape') }}</h3>
              <span class="text-xs text-muted">{{ symbol }}</span>
            </div>

            <div v-if="tape.length" class="flex flex-col text-sm">
              <div class="grid grid-cols-3 gap-2 pb-1 text-xs text-muted border-b border-default">
                <span>{{ t('trade.time') }}</span>
                <span class="text-right">{{ t('trade.price') }}</span>
                <span class="text-right">{{ t('trade.qty') }}</span>
              </div>
              <div
                v-for="trade in tape"
                :key="trade.id ?? `${trade.eventTime}-${trade.ingestTime}`"
                class="grid grid-cols-3 gap-2 py-0.5 font-mono text-xs"
              >
                <span class="text-muted">{{ tapeTime(trade.eventTime) }}</span>
                <span class="text-right" :class="sideClass(trade.side)">
                  {{ formatPrice(trade.price) }}
                </span>
                <span class="text-right text-default">
                  {{ trade.quantity !== undefined ? trade.quantity : '—' }}
                </span>
              </div>
            </div>
            <p v-else class="py-6 text-center text-sm text-muted">{{ t('trade.tapeEmpty') }}</p>
          </div>
        </div>
      </div>

      <!-- Terminal bottom row (roadmap §10): ticket, methods, signals, risk, positions -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-5">
        <TradeTicket
          :symbol="symbol"
          :tf="timeframe"
          :quote="displayQuote"
          :replay-session-id="replaySession?.id ?? null"
          @placed="signalsReload++"
        />
        <MethodControls v-model="activeMethod" />
        <SignalPanel :symbol="symbol" :reload-key="signalsReload" />
        <OrdersPanel :reload="signalsReload" />
        <FillsPanel :reload="signalsReload" />
        <RiskPanel />
        <PositionPanel :method="activeMethod" @clear-method="activeMethod = ''" />
      </div>
    </div>
  </BasePage>
</template>
