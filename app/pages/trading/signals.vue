<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { NativeSignalItem, SignalItem } from '#shared/types/signals'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'signals.title',
  descKey: 'signals.desc'
})
const { viewMode } = useAdminGridView('signals-view-mode')
const { buildRowActions } = useAdminRowActions()
const signalsApi = useSignals()
const { version: workspaceVersion } = useTradingWorkspace()
const { error: loadError, hasError, isStale, run } = useResourceState()

// List collection `alerts` (D4) qua Nitro route noi dia.
const signalsList = useCursorPagination<SignalItem>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await signalsApi.list({ cursor: typeof cursor === 'string' ? cursor : null, limit })
    mongoDown.value = res.meta?.mongo === 'down'
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: signals, loading: isLoading, hasMore } = signalsList

const mongoDown = ref(false)

// ── Source switch (§61.17 Phase D — D5): the TradingView webhook (collection
//  alerts, legacy) vs the NATIVE engine output (collection signals, attributed).
//  Each source keeps its own paginator; the ribbon/footer/toolbar follow the
//  active one. The engine panel is a child that owns its own data + state.
const source = ref<'alerts' | 'engine'>('alerts')
const assistantOpen = ref(false)
const assistantScope = ref<{ type: 'signal', id: string, source: 'alerts' | 'engine' } | null>(null)
const sourceItems = computed(() => [
  { label: t('signals.source_alerts'), value: 'alerts' },
  { label: t('signals.source_engine'), value: 'engine' }
])
const nativePanel = ref<{
  refresh: () => Promise<void>
  items: NativeSignalItem[]
  loading: boolean
  hasMore: boolean
  metrics: MetricItem[]
} | null>(null)

const activeItems = computed<Array<SignalItem | NativeSignalItem>>(() =>
  source.value === 'engine' ? (nativePanel.value?.items ?? []) : signals.value)
const activeCount = computed(() => activeItems.value.length)
const activeHasMore = computed(() => (source.value === 'engine' ? !!nativePanel.value?.hasMore : hasMore.value))
const activeLoading = computed(() => (source.value === 'engine' ? !!nativePanel.value?.loading : isLoading.value))
const activeMetrics = computed<MetricItem[]>(() => (source.value === 'engine' ? (nativePanel.value?.metrics ?? []) : metrics.value))

async function activeRefresh() {
  if (source.value === 'engine') await nativePanel.value?.refresh()
  else await refreshSignals()
}

// The header description must match what is on screen (webhook vs engine).
const pageDescription = computed(() => (source.value === 'engine' ? t('signals.descEngine') : description.value))

const handleListError = (err: unknown) => {
  notify.error(t('signals.title'), getErrorMessage(err, key => t(key)))
}

async function refreshSignals() {
  await run(async () => { await signalsList.refresh() })
  if (hasError.value) handleListError(loadError.value)
}

async function loadMoreSignals() {
  try {
    await signalsList.loadMore()
  } catch (err) {
    handleListError(err)
  }
}

onMounted(refreshSignals)
// §61.17 Phase C: a new in-app signal bumps the signals view — reconcile live.
watch(workspaceVersion('signals'), refreshSignals)

// ── Cross-module actions (D): a signal is only useful if it can be acted on.
//  Both are pure deep links — no order is ever placed from a signal row (D7:
//  the risk gate owns every entry), the user lands on the real surface prefilled.
/** Explain one stored signal from its server-rebuilt bundle (read-only). */
function askAssistant(item: SignalItem | NativeSignalItem) {
  assistantScope.value = { type: 'signal', id: item.id, source: source.value }
  assistantOpen.value = true
}

/** Open the terminal desk on this signal's symbol/timeframe (?instrument=&tf=). */
function openInTerminal(s: SignalItem) {
  if (!s.symbol) return
  const query: Record<string, string> = { instrument: s.symbol }
  // The desk validates ?tf= against its own allowlist and falls back safely.
  if (s.tf) query.tf = s.tf
  return navigateTo({ path: '/trading', query })
}

/** Prefill a new alert rule for this signal's symbol (/alerts?create=1&symbol=). */
function createAlert(s: SignalItem) {
  const query: Record<string, string> = { create: '1' }
  if (s.symbol) query.symbol = s.symbol
  const name = [s.symbol, s.action, s.tf].filter(Boolean).join(' ')
  if (name) query.name = name
  return navigateTo({ path: '/alerts', query })
}

// ── CSV export: exactly the rows this page has loaded (cursor-paginated).
const exporting = ref(false)
function exportCsv() {
  if (!activeItems.value.length) return
  exporting.value = true
  try {
    const rows = activeItems.value
    const csv = source.value === 'engine'
      ? toCsv(rows as NativeSignalItem[], [
          { key: 'id', label: 'id', value: s => s.id },
          { key: 'ts', label: 'ts', value: s => s.ts },
          { key: 'symbol', label: 'symbol', value: s => s.symbol },
          { key: 'tf', label: 'tf', value: s => s.tf },
          { key: 'type', label: 'type', value: s => s.type },
          { key: 'method', label: 'method', value: s => s.method },
          { key: 'strategyVersion', label: 'strategyVersion', value: s => s.attribution?.strategyVersion ?? '' },
          { key: 'engineVersion', label: 'engineVersion', value: s => s.attribution?.engineVersion ?? '' },
          { key: 'paramsHash', label: 'paramsHash', value: s => s.attribution?.paramsHash ?? '' },
          { key: 'price', label: 'price', value: s => s.price },
          { key: 'signalKey', label: 'signalKey', value: s => s.signalKey }
        ])
      : toCsv(rows as SignalItem[], [
          { key: 'id', label: 'id', value: s => s.id },
          { key: 'ts', label: 'ts', value: s => s.ts },
          { key: 'symbol', label: 'symbol', value: s => s.symbol },
          { key: 'source', label: 'source', value: s => s.source },
          { key: 'tf', label: 'tf', value: s => s.tf },
          { key: 'action', label: 'action', value: s => s.action },
          { key: 'level', label: 'level', value: s => s.level },
          { key: 'side', label: 'side', value: s => s.side },
          { key: 'price', label: 'price', value: s => s.price },
          { key: 'sl', label: 'sl', value: s => s.sl },
          { key: 'tps', label: 'tps', value: s => s.tps.join(' ') },
          { key: 'conf', label: 'conf', value: s => s.conf },
          { key: 'status', label: 'status', value: s => s.status }
        ])
    downloadCsv(csvFilename(source.value === 'engine' ? 'tm-trading-engine-signals' : 'tm-trading-signals'), csv)
    notify.success(t('common.export'), t('common.exportRows', { n: rows.length }))
  } finally {
    exporting.value = false
  }
}

const columns = computed<GridColumn[]>(() => [
  { key: 'ts', label: t('signals.time'), class: 'w-36' },
  { key: 'symbol', label: t('signals.symbol'), class: 'w-44' },
  { key: 'tf', label: t('signals.tf'), class: 'w-16' },
  { key: 'action', label: t('signals.action'), class: 'w-28' },
  { key: 'side', label: t('signals.side'), class: 'w-20' },
  { key: 'price', label: t('signals.price'), class: 'w-24' },
  { key: 'sl', label: t('signals.sl'), class: 'w-24' },
  { key: 'tps', label: t('signals.tps'), class: 'w-44' },
  { key: 'conf', label: t('signals.conf'), class: 'w-20' },
  { key: 'status', label: t('signals.status'), class: 'w-24' },
  { key: 'actions', label: '', class: 'w-20' }
])

const rowActions = () => buildRowActions([])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'

const actionColor = (a: string | null) =>
  a === 'ENTRY' ? 'success' : a === 'STOP_LOSS' ? 'error' : a === 'TAKE_PROFIT' ? 'info' : 'neutral'

const sideColor = (s: string | null) => (s === 'BUY' ? 'success' : s === 'SELL' ? 'error' : 'neutral')

// Header stats (mockup telemetry strip) — derived ONLY from the loaded page
// (cursor-paginated, so the hint says so when more pages exist). Never faked.
const metrics = computed<MetricItem[]>(() => {
  const list = signals.value
  const longs = list.filter(s => s.side === 'BUY').length
  const shorts = list.filter(s => s.side === 'SELL').length
  const confs = list
    .map(s => s.conf)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null
  const forwarded = list.filter(s => s.status === 'forwarded').length
  const decided = list.filter(s => s.status === 'forwarded' || s.status === 'rejected').length
  const passRate = decided ? (forwarded / decided) * 100 : null
  const hint = hasMore.value ? t('signals.metrics.loadedHint') : t('signals.metrics.allHint')
  return [
    { key: 'triggered', label: t('signals.metrics.triggered'), value: String(list.length), tone: 'primary', hint },
    { key: 'long', label: t('signals.metrics.long'), value: String(longs), tone: 'success' },
    { key: 'short', label: t('signals.metrics.short'), value: String(shorts), tone: 'error' },
    {
      key: 'avgConf',
      label: t('signals.metrics.avgConf'),
      value: avgConf === null ? '—' : `${avgConf >= 0 ? '+' : ''}${avgConf.toFixed(2)}`,
      tone: avgConf === null ? 'default' : avgConf > 0 ? 'success' : avgConf < 0 ? 'error' : 'default'
    },
    {
      key: 'passRate',
      label: t('signals.metrics.passRate'),
      value: passRate === null ? '—' : `${passRate.toFixed(1)}%`,
      hint: decided ? `${forwarded}/${decided}` : ''
    }
  ]
})

const statusColor = (s: string) =>
  s === 'forwarded' ? 'success' : s === 'rejected' ? 'error' : 'warning'

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: activeRefresh
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: activeCount.value,
  hasMore: activeHasMore.value,
  loading: activeLoading.value
})))

const trail = computed(() => [{ label: t('nav.trading') }, { label: title.value }])

useHead({ title })
</script>

<template>
  <BasePage id="signals" :title="title" :description="pageDescription">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="source === 'engine' ? t('signals.pipEngine') : t('signals.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown && source === 'alerts'"
          :label="t('signals.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <USelect v-model="source" :items="sourceItems" value-key="value" size="sm" class="w-44" />
        <UButton
          icon="i-lucide-download"
          :label="t('common.export')"
          variant="soft"
          color="neutral"
          size="sm"
          :disabled="!activeItems.length"
          :loading="exporting"
          @click="exportCsv"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="activeLoading"
          @click="activeRefresh"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter
        :count="activeCount"
        :has-more="activeHasMore"
        :loading="activeLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="activeMetrics" />

      <TradingEngineSignalsPanel v-if="source === 'engine'" ref="nativePanel" />

      <template v-else>
      <SharedRefreshNotice
        :stale="isStale"
        :retrying="isLoading"
        :message="t('common.staleData')"
        @retry="refreshSignals"
      />

      <LazyGridList
        :items="signals"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="hasMore"
        :action-options="rowActions"
        v-model:view-mode="viewMode"
        item-key="id"
        storage-key="signals-view-mode"
        @load-more="loadMoreSignals"
        @refresh="refreshSignals"
      >
        <template #ts="{ item }">
          <time :datetime="item.ts" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.ts)) }}
          </time>
        </template>

        <template #symbol="{ item }">
          <div class="flex flex-col min-w-0 gap-0.5">
            <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
            <span class="text-[10px] text-dimmed font-mono truncate">{{ item.source }}</span>
          </div>
        </template>

        <template #tf="{ item }">
          <span class="text-xs text-muted">{{ item.tf ?? '—' }}</span>
        </template>

        <template #action="{ item }">
          <div class="flex items-center gap-1.5">
            <UBadge :label="item.action ?? '—'" :color="actionColor(item.action)" variant="subtle" size="xs" />
            <span v-if="item.level !== null" class="text-[10px] text-dimmed">L{{ item.level }}</span>
          </div>
        </template>

        <template #side="{ item }">
          <UBadge v-if="item.side" :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
          <span v-else class="text-xs text-muted">—</span>
        </template>

        <template #price="{ item }">
          <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.price) }}</span>
        </template>

        <template #sl="{ item }">
          <span class="text-xs text-error font-mono">{{ fmtPrice(item.sl) }}</span>
        </template>

        <template #tps="{ item }">
          <span class="text-xs text-success font-mono truncate">
            {{ item.tps.length ? item.tps.join(' · ') : '—' }}
          </span>
        </template>

        <template #conf="{ item }">
          <span class="text-xs text-muted">{{ item.conf !== null ? item.conf.toFixed(2) : '—' }}</span>
        </template>

        <template #status="{ item }">
          <UBadge :label="t(`signals.status_${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
        </template>

        <template #actions="{ item }">
          <div class="flex items-center gap-1">
            <UButton
              v-if="item.symbol"
              icon="i-lucide-candlestick-chart"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="t('signals.openTerminal')"
              :title="t('signals.openTerminal')"
              @click="openInTerminal(item)"
            />
            <UButton
              v-if="item.symbol"
              icon="i-lucide-bell-plus"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="t('signals.createAlert')"
              :title="t('signals.createAlert')"
              @click="createAlert(item)"
            />
            <UButton
              icon="i-lucide-sparkles"
              variant="ghost"
              color="primary"
              size="xs"
              :aria-label="t('assistant.title')"
              :title="t('assistant.title')"
              @click="askAssistant(item)"
            />
          </div>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
                <UBadge :label="item.action ?? '—'" :color="actionColor(item.action)" variant="subtle" size="xs" />
                <UBadge v-if="item.side" :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
              </div>
              <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                {{ fmtPrice(item.price) }}
                <span v-if="item.sl !== null" class="text-error"> · SL {{ fmtPrice(item.sl) }}</span>
                <span v-if="item.tps.length" class="text-success"> · TP {{ item.tps.join(' · ') }}</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <UBadge :label="t(`signals.status_${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
              <time :datetime="item.ts" class="block text-[10px] text-muted mt-1">
                {{ formatTimeAgo(new Date(item.ts)) }}
              </time>
            </div>
          </div>
          <div v-if="item.symbol" class="flex items-center gap-2 mt-2">
            <UButton
              icon="i-lucide-candlestick-chart"
              :label="t('signals.openTerminal')"
              variant="soft"
              color="neutral"
              size="xs"
              @click="openInTerminal(item)"
            />
            <UButton
              icon="i-lucide-bell-plus"
              :label="t('signals.createAlert')"
              variant="soft"
              color="neutral"
              size="xs"
              @click="createAlert(item)"
            />
            <UButton
              icon="i-lucide-sparkles"
              :label="t('assistant.title')"
              variant="soft"
              color="primary"
              size="xs"
              @click="askAssistant(item)"
            />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            v-if="hasError"
            :title="t('common.loadErrorTitle')"
            :description="t('common.loadErrorHint')"
            icon="i-lucide-triangle-alert"
            :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: refreshSignals }]"
          />
          <AdminEmptyState
            v-else
            :title="t('signals.empty')"
            :description="t('signals.emptyHint')"
            icon="i-lucide-radio-tower"
          />
        </template>
      </LazyGridList>
      </template>
    </div>
    <BaseModuleAssistantPanel v-model:open="assistantOpen" :scope="assistantScope" />
  </BasePage>
</template>
