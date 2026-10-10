<script setup lang="ts">
// =============================================================================
//  TradeChart — lightweight-charts v5 candlestick panel (S5) + indicator
//  overlays/panes (S7 / roadmap 7I).
//
//  Lifecycle: REST history seed (S4 /api/v1/markets/:sym/candles) -> live
//  updates from the shared /ws/market feed (useMarketStream) applied through
//  the pure upsertBar() mapper. Chart time = UTCTimestamp SECONDS.
//  Indicator series are mounted/diffed from the `indicators` prop; values are
//  recomputed from engine/ta.mjs primitives via app/utils/indicators.ts on
//  every history load and every live bar (300 bars -> trivial).
//  Theme follows the app color mode; autoSize handles responsive resize.
// =============================================================================
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import {
  candleKey,
  candlesToBars,
  upsertBar,
  type CandleInput,
  type CandleMessage,
  type ChartBar
} from '../utils/marketFeed'
import {
  INDICATOR_MAP,
  calculateIndicator,
  type IndicatorDefinition,
  type IndicatorOutputDef,
  type IndicatorSelection
} from '../utils/indicators'
import type { ReplayCandle, ReplaySummary } from '~~/types/replay'
import type { IntelNewsItem, IntelZone } from '~~/types/intel'
import type { MethodEvent } from '~~/types/methods'

const props = defineProps<{
  symbol: string
  timeframe: string
  indicators?: IndicatorSelection[]
  /** Attached replay session (7R2) — while set, bars come from it, not the live feed. */
  replay?: ReplaySummary | null
  /** Seed history (closeTime < replay start) fetched by the page on attach. */
  replaySeed?: CandleInput[] | null
  /** Accumulated played events — the page appends on every poll/step. */
  replayEvents?: ReplayCandle[] | null
  /** Intel liquidation zones for the active symbol (Phase 8/9) — price-line overlay. */
  zone?: IntelZone | null
  /** Scored news — series markers within the loaded bar window (live only). */
  news?: IntelNewsItem[] | null
  /** Detected method events (Phase 10) — markers within the loaded bar window (live only). */
  methodEvents?: MethodEvent[] | null
}>()

const emit = defineEmits<{
  /** Marker/time click on a bar carrying a method event -> page inspector. */
  'select-method-event': [ev: MethodEvent]
}>()

const { t, locale } = useI18n()
const colorMode = useColorMode()
const feed = useMarketStream()

const el = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

type ChartSeriesApi = ISeriesApi<'Line' | 'Histogram'>

interface MountedOutput {
  api: ChartSeriesApi
  output: IndicatorOutputDef
}

interface MountedIndicator {
  def: IndicatorDefinition
  params: Record<string, number>
  outputs: MountedOutput[]
}

let chart: IChartApi | null = null
let series: ISeriesApi<'Candlestick'> | null = null
let bars: ChartBar[] = []
/** Which symbol|tf the current `bars`/series data belongs to. */
let loadedKey = ''
/** How many replay events have been applied to `bars` already. */
let replayConsumed = 0
/** Mounted indicator series keyed by definition id (diffed against props). */
const mounted = new Map<string, MountedIndicator>()

/** Recreated on every sync — liquidation price-lines attached to the series. */
let priceLines: IPriceLine[] = []
/** Series-marker plugin for scored news + method events inside the loaded bar window. */
let markerPlugin: ISeriesMarkersPluginApi<Time> | null = null

/** Per-method marker color (Phase 10) — matches the method names registry. */
const METHOD_COLOR: Record<string, string> = {
  'price-action': '#a78bfa',
  trend: '#f59e0b',
  orderflow: '#06b6d4',
  vsa: '#ec4899',
  sweep: '#84cc16'
}

const PANE_HEIGHT = 150

const themeColors = () => colorMode.value === 'dark'
  ? { bg: '#15171c', text: '#a1a1aa', grid: '#23252c', border: '#2e3138', up: '#22c55e', down: '#ef4444' }
  : { bg: '#ffffff', text: '#6b7280', grid: '#eef0f3', border: '#d9dce1', up: '#16a34a', down: '#dc2626' }

const chartOptions = () => {
  const th = themeColors()
  return {
    autoSize: true,
    localization: { locale: locale.value },
    layout: { background: { color: th.bg }, textColor: th.text },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderColor: th.border }
  }
}

const candleOptions = () => {
  const th = themeColors()
  return {
    upColor: th.up,
    downColor: th.down,
    wickUpColor: th.up,
    wickDownColor: th.down,
    borderVisible: false
  }
}

const asPoint = (bar: ChartBar) => ({
  time: bar.time as UTCTimestamp,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close
})

const errorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { data?: { message?: string }; message?: string }
    return e.data?.message || e.message || 'request-failed'
  }
  return String(err)
}

// -----------------------------------------------------------------------------
//  Intel overlays (Phase 8/9): liquidation zone price-lines + scored-news
//  markers. Both are real-time context and are wiped while a replay session
//  owns the chart (the page passes null/[] in replay — D17).
// -----------------------------------------------------------------------------

/**
 * Rebuild liquidation price-lines (dedupe est. levels by price, keep the most
 * significant USD per level, cap at 8) + top actual liquidation clusters.
 * Long liquidations sit below price (down tone), short ones above (up tone).
 */
const syncZones = (): void => {
  if (!series) return
  for (const pl of priceLines) series.removePriceLine(pl)
  priceLines = []
  if (props.replay) return
  const zone = props.zone
  if (!zone || !Number.isFinite(zone.markPx)) return
  const th = themeColors()
  const byPrice = new Map<number, { usd: number; side: 'long' | 'short' }>()
  for (const e of zone.est) {
    if (!Number.isFinite(e.price) || e.price <= 0) continue
    const cur = byPrice.get(e.price)
    if (!cur || cur.usd < e.usd) byPrice.set(e.price, { usd: e.usd, side: e.side })
  }
  const levels = [...byPrice.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, 8)
  for (const [price, { side }] of levels) {
    priceLines.push(series.createPriceLine({
      price,
      color: side === 'long' ? th.down : th.up,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'liq'
    }))
  }
  const actual = [...(zone.actual ?? [])].sort((a, b) => b.usd - a.usd).slice(0, 4)
  for (const ev of actual) {
    priceLines.push(series.createPriceLine({
      price: ev.price,
      color: ev.side === 'long' ? th.down : th.up,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false
    }))
  }
}

/**
 * Rebuild all markers scoped to the loaded bar window (times in seconds) —
 * scored news (Phase 8) merged with method events (Phase 10). Method events
 * take priority on a time collision; among events on the same bar only the
 * highest-|score| one becomes a marker. Live context only (bars belong to a
 * replay session -> cleared).
 */
const renderMarkers = (): void => {
  if (!markerPlugin) return
  if (props.replay || !bars.length) {
    markerPlugin.setMarkers([])
    return
  }
  const from = bars[0]!.time
  const to = bars[bars.length - 1]!.time
  const byTime = new Map<number, SeriesMarker<Time>>()

  // Method events first -> they own a bar when they collide with news.
  const methodEvents = props.methodEvents ?? []
  const bestMethod = new Map<number, MethodEvent>()
  for (const ev of methodEvents) {
    const cur = bestMethod.get(ev.time)
    if (!cur || Math.abs(ev.score) > Math.abs(cur.score)) bestMethod.set(ev.time, ev)
  }
  for (const [sec, ev] of bestMethod) {
    if (sec < from || sec > to) continue
    const score = ev.score ?? 0
    byTime.set(sec, {
      time: sec as UTCTimestamp,
      position: score > 0 ? 'belowBar' : 'aboveBar',
      color: METHOD_COLOR[ev.method] ?? '#94a3b8',
      shape: score > 0 ? 'arrowUp' : 'arrowDown',
      size: 1
    })
  }

  for (const item of props.news ?? []) {
    if (item.level !== 'high' && item.level !== 'med') continue
    const sec = Math.floor(Date.parse(item.ts) / 1000)
    if (!Number.isFinite(sec) || sec < from || sec > to) continue
    if (bestMethod.has(sec)) continue // method event owns this bar
    byTime.set(sec, {
      time: sec as UTCTimestamp,
      position: item.dir === 'neg' ? 'belowBar' : 'aboveBar',
      color: item.level === 'high' ? '#ef4444' : '#3b82f6',
      shape: item.level === 'high' ? 'arrowUp' : 'circle',
      size: item.level === 'high' ? 2 : 1
    })
  }

  const markers = [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time))
  markerPlugin.setMarkers(markers)
}

// -----------------------------------------------------------------------------
//  Indicator series lifecycle
// -----------------------------------------------------------------------------

const mountOutput = (
  def: IndicatorDefinition,
  output: IndicatorOutputDef
): ChartSeriesApi => {
  if (!chart) throw new Error('chart not ready')
  const th = themeColors()
  if (def.kind === 'volume') {
    // Shared volume overlay scale pinned to the bottom 25% of the main pane.
    // Explicit paneIndex 0 (main candlestick pane): without it lightweight-charts
    // drops the series into the LAST pane, overlapping any pane-kind indicator
    // (e.g. RSI) that was mounted first.
    const api = output.type === 'histogram'
      ? chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } }, 0)
      : chart.addSeries(LineSeries, {
          priceScaleId: '',
          color: output.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false
        }, 0)
    api.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } })
    return api
  }
  if (def.kind === 'pane') {
    return output.type === 'histogram'
      ? chart.addSeries(HistogramSeries, { priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, 1)
      : chart.addSeries(LineSeries, {
          color: output.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false
        }, 1)
  }
  return chart.addSeries(LineSeries, {
    color: output.color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  })
}

const normalizePanes = (): void => {
  if (!chart) return
  const pane = chart.panes()[1]
  if (!pane) return
  if (pane.getSeries().length === 0) chart.removePane(1)
  else pane.setHeight(PANE_HEIGHT)
}

const syncIndicators = (): void => {
  if (!chart) return
  const wanted = new Map<string, Record<string, number> | undefined>(
    (props.indicators ?? []).map((i) => [i.id, i.params])
  )

  for (const [id, entry] of [...mounted]) {
    if (wanted.has(id)) continue
    for (const out of entry.outputs) chart.removeSeries(out.api)
    mounted.delete(id)
  }

  for (const [id, params] of wanted) {
    if (mounted.has(id)) continue
    const def = INDICATOR_MAP[id]
    if (!def) continue
    const outputs = def.outputs.map((output) => ({ api: mountOutput(def, output), output }))
    mounted.set(id, { def, params: params ?? {}, outputs })
  }

  normalizePanes()
  updateIndicators()
}

const histColor = (def: IndicatorDefinition, value: number, bar: ChartBar): string => {
  const th = themeColors()
  if (def.id === 'volume') return bar.close >= bar.open ? th.up : th.down
  return value >= 0 ? th.up : th.down
}

const updateIndicators = (): void => {
  if (!chart || mounted.size === 0) return
  for (const entry of mounted.values()) {
    const result = calculateIndicator(entry.def.id, bars, entry.params)
    for (const { api, output } of entry.outputs) {
      const data = result[output.key]
      if (!data) continue
      if (output.type === 'histogram') {
        api.setData(bars.flatMap((bar, i) => {
          const v = data[i]
          if (v == null) return []
          return [{ time: bar.time as UTCTimestamp, value: v, color: histColor(entry.def, v, bar) }]
        }))
      } else {
        api.setData(bars.flatMap((bar, i) => {
          const v = data[i]
          // `null` -> whitespace point (line breaks over Pine `na` gaps).
          if (v == null) return [{ time: bar.time as UTCTimestamp }]
          return [{ time: bar.time as UTCTimestamp, value: v }]
        }))
      }
    }
  }
}

async function loadHistory(): Promise<void> {
  if (props.replay) return // replay owns the bars — see loadReplay()
  const key = candleKey(props.symbol, props.timeframe)
  loading.value = true
  loadError.value = null
  try {
    const res = await $fetch<{ success: boolean; data?: CandleMessage[] }>(
      `/api/v1/markets/${encodeURIComponent(props.symbol)}/candles`,
      { params: { interval: props.timeframe, limit: 300 } }
    )
    bars = candlesToBars(res.data ?? [])
    loadedKey = key
    series?.setData(bars.map(asPoint))
    // Catch up with a live frame that arrived while the fetch was in flight.
    const live = feed.state.lastCandles[key]
    if (live && series) {
      bars = upsertBar(bars, live)
      const last = bars[bars.length - 1]
      if (last) series.update(asPoint(last))
    }
    updateIndicators()
    syncZones()
    renderMarkers()
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

/**
 * Replay mode (7R2): seed history strictly BEFORE the replay window (the page
 * already filters it), then grow it bar-by-bar from the played events. No
 * live frames are consumed — the replay clock owns the chart (D17: only bars
 * <= now are ever shown).
 */
function loadReplay(): void {
  const session = props.replay
  if (!session) return
  loading.value = true
  loadError.value = null
  try {
    bars = candlesToBars(props.replaySeed ?? [])
    loadedKey = candleKey(props.symbol, props.timeframe)
    replayConsumed = 0
    series?.setData(bars.map(asPoint))
    applyReplayEvents()
    updateIndicators()
    syncZones()
    renderMarkers()
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

/** Apply played events the chart has not seen yet (ascending, append-safe). */
function applyReplayEvents(): void {
  if (!props.replay || !series) return
  const events = props.replayEvents ?? []
  for (let i = replayConsumed; i < events.length; i++) {
    const ev = events[i]
    if (!ev) continue
    replayConsumed = i + 1
    const evTime = Math.floor(Number(ev.openTime) / 1000)
    const last = bars[bars.length - 1]
    if (last && evTime < last.time) continue // stale — never go backwards
    bars = upsertBar(bars, ev)
    const next = bars[bars.length - 1]
    if (next) series.update(asPoint(next))
  }
  if (replayConsumed > 0) updateIndicators()
}

/** Template retry entry point — picks the right loader for the mode. */
const retry = (): void => {
  if (props.replay) loadReplay()
  else void loadHistory()
}

watch(
  () => candleKey(props.symbol, props.timeframe),
  () => { void loadHistory() }
)

// Replay lifecycle: attach -> seed load; every new batch -> apply the tail.
watch(
  () => props.replay?.id ?? '',
  () => {
    if (props.replay) loadReplay()
    else void loadHistory() // detached -> back to the live feed
  }
)
watch(
  () => props.replayEvents,
  () => { if (props.replay) applyReplayEvents() }
)

// Intel overlays follow the props (page passes null/[] during replay).
watch(() => props.zone, () => syncZones())
watch(() => props.news, () => renderMarkers())
watch(() => props.methodEvents, () => renderMarkers())

watch(() => props.indicators, () => syncIndicators())

// Live frames: one slot per symbol|timeframe; upsertBar keeps ordering safe.
// Gated while a replay session owns the chart — the live plane must never
// write into replay time (D17).
watch(
  () => feed.state.lastCandles[candleKey(props.symbol, props.timeframe)],
  (live) => {
    if (!live || !series || loading.value) return
    if (props.replay) return
    if (loadedKey !== candleKey(props.symbol, props.timeframe)) return
    bars = upsertBar(bars, live)
    const last = bars[bars.length - 1]
    if (last) series.update(asPoint(last))
    updateIndicators()
    renderMarkers()
  }
)

watch(colorMode, () => {
  if (!chart || !series) return
  chart.applyOptions(chartOptions())
  series.applyOptions(candleOptions())
  updateIndicators()
  syncZones()
})

onMounted(() => {
  if (!el.value) return
  chart = createChart(el.value, chartOptions())
  series = chart.addSeries(CandlestickSeries, candleOptions())
  markerPlugin = createSeriesMarkers(series, [])
  // Phase 10: clicking a bar that carries a method event opens it in the
  // inspector (the page highlights the matching row). Non-event clicks no-op.
  chart.subscribeClick((param) => {
    if (props.replay || !param?.time) return
    const sec = Number(param.time)
    if (!Number.isFinite(sec)) return
    const ev = (props.methodEvents ?? []).find((e) => e.time === sec)
    if (ev) emit('select-method-event', ev)
  })
  syncIndicators()
  syncZones()
  renderMarkers()
  if (props.replay) loadReplay()
  else void loadHistory()
})

onBeforeUnmount(() => {
  chart?.remove()
  chart = null
  series = null
  markerPlugin = null
  priceLines = []
  mounted.clear()
})
</script>

<template>
  <div class="relative w-full h-[420px] lg:h-[560px] rounded-md overflow-hidden">
    <div ref="el" class="absolute inset-0" />

    <div v-if="loading" class="absolute inset-0 z-10 grid place-items-center bg-default/70 backdrop-blur-[2px]">
      <div class="flex flex-col items-center gap-2">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        <p class="text-sm text-muted">{{ t('trade.loading') }}</p>
      </div>
    </div>

    <div v-else-if="loadError" class="absolute inset-0 z-10 grid place-items-center">
      <div class="flex flex-col items-center gap-3 px-6 text-center">
        <UIcon name="i-lucide-triangle-alert" class="size-6 text-error" />
        <p class="text-sm text-muted">{{ t('trade.chartError') }}</p>
        <p class="max-w-md font-mono text-xs break-all text-error/80">{{ loadError }}</p>
        <UButton size="xs" color="primary" variant="soft" @click="retry">
          {{ t('trade.retry') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
