<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { PositionItem } from '#shared/types/positions'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'positions.title',
  descKey: 'positions.desc'
})
const { viewMode } = useAdminGridView('positions-view-mode')
const { buildRowActions } = useAdminRowActions()
const positionsApi = usePositions()
const feed = useMarketStream()
const { account } = useAccountScope()
const { version: workspaceVersion } = useTradingWorkspace()
const { error: loadError, hasError, isStale, run } = useResourceState()

const statusFilter = ref('all')
const sourceFilter = ref('all')

// Global header stats (not filtered) — open/closed/realized across accounts.
const meta = ref<{ open: number; closed: number; realizedPnlAbs: number | null; mongo: 'up' | 'down' } | null>(null)

const positionsList = useCursorPagination<PositionItem>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await positionsApi.list({
      cursor: typeof cursor === 'string' ? cursor : null,
      limit,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      source: sourceFilter.value === 'all' ? undefined : sourceFilter.value,
      account: account.value ?? undefined
    })
    meta.value = res.meta
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: rows, loading: isLoading, hasMore } = positionsList

const statusItems = computed(() => [
  { label: t('positions.statusAll'), value: 'all' },
  { label: t('positions.statusOpen'), value: 'open' },
  { label: t('positions.statusClosed'), value: 'closed' },
  { label: t('positions.statusCancelled'), value: 'cancelled' }
])
const sourceItems = computed(() => [
  { label: t('positions.filterAll'), value: 'all' },
  { label: t('positions.srcPaper'), value: 'paper' },
  { label: t('positions.srcMt5'), value: 'mt5' },
  { label: t('positions.srcExchange'), value: 'exchange' },
  { label: t('positions.srcManual'), value: 'manual' }
])

async function refreshPositions() {
  await run(async () => { await positionsList.refresh() })
  if (hasError.value) notify.error(t('positions.title'), getErrorMessage(loadError.value, key => t(key)))
}

async function loadMorePositions() {
  try {
    await positionsList.loadMore()
  } catch (err) {
    notify.error(t('positions.title'), getErrorMessage(err, key => t(key)))
  }
}

watch([statusFilter, sourceFilter, account], () => {
  refreshPositions()
})

// §61.17 Phase C: open/close/partial fills bump the positions view — reconcile
// without a hard refresh.
watch(workspaceVersion('positions'), refreshPositions)

onMounted(() => {
  feed.connect()
  refreshPositions()
})

const columns = computed<GridColumn[]>(() => [
  { key: 'entryTime', label: t('positions.colTime'), class: 'w-36' },
  { key: 'symbol', label: t('positions.colSymbol'), class: 'w-40' },
  { key: 'dir', label: t('positions.colDir'), class: 'w-20' },
  { key: 'qty', label: t('positions.colQty'), class: 'w-24' },
  { key: 'entryPrice', label: t('positions.colEntry'), class: 'w-24' },
  { key: 'sl', label: t('positions.colSl'), class: 'w-24' },
  { key: 'status', label: t('positions.colStatus'), class: 'w-24' },
  { key: 'pnl', label: t('positions.colPnl'), class: 'w-28' },
  { key: 'source', label: t('positions.colSource'), class: 'w-32' }
])

const rowActions = () => buildRowActions([])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
const fmtMoney = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const moneyClass = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const fmtPct = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

const dirLabel = (d: number) => (d === 1 ? t('positions.dirLong') : t('positions.dirShort'))
const statusLabel = (s: string) =>
  s === 'open' ? t('positions.statusOpen')
    : s === 'closed' ? t('positions.statusClosed')
      : s === 'cancelled' ? t('positions.statusCancelled') : s
const statusColor = (s: string): 'success' | 'neutral' | 'warning' =>
  s === 'open' ? 'success' : s === 'cancelled' ? 'warning' : 'neutral'

// Live unrealized + notional (mockup blotter stats) — marked to the LIVE
// plane quote per symbol (last ?? mid, same fallback as the terminal hero).
// Rows without a quote contribute nothing ('—', never a fabricated mark);
// symbols outside MARKET_SYMBOLS simply have no quote yet (D1).
const markOf = (symbol: string): number | null => {
  const q = feed.state.quotes[symbol]
  if (!q) return null
  if (q.last !== undefined) return q.last
  if (q.bid !== undefined && q.ask !== undefined) return (q.bid + q.ask) / 2
  return null
}

interface LiveExposure {
  unrealized: number | null
  notional: number | null
}

const liveExposure = computed<LiveExposure>(() => {
  let pnl = 0
  let notion = 0
  let any = false
  for (const r of rows.value) {
    if (r.status !== 'open') continue
    const mark = markOf(r.symbol)
    if (mark === null) continue
    pnl += (mark - r.entryPrice) * r.dir * r.qty
    notion += mark * r.qty
    any = true
  }
  return any ? { unrealized: pnl, notional: notion } : { unrealized: null, notional: null }
})

const metrics = computed<MetricItem[]>(() => {
  const m = meta.value
  const realized = m?.realizedPnlAbs ?? null
  const live = liveExposure.value
  const liveTone = (v: number | null): MetricItem['tone'] =>
    v == null ? 'default' : v > 0 ? 'success' : v < 0 ? 'error' : 'default'
  return [
    { key: 'open', label: t('positions.statOpen'), value: m ? String(m.open) : '—', icon: 'i-lucide-layers', tone: 'success' },
    { key: 'closed', label: t('positions.statClosed'), value: m ? String(m.closed) : '—', icon: 'i-lucide-archive' },
    { key: 'realized', label: t('positions.statRealized'), value: m ? fmtMoney(m.realizedPnlAbs) : '—', icon: 'i-lucide-trending-up', tone: liveTone(realized) },
    { key: 'unrealized', label: t('positions.statUnrealized'), value: fmtMoney(live.unrealized), icon: 'i-lucide-activity', tone: liveTone(live.unrealized) },
    { key: 'notional', label: t('positions.statNotional'), value: live.notional === null ? '—' : fmtMoney(live.notional), icon: 'i-lucide-banknote' }
  ]
})

const trail = computed(() => [{ label: t('nav.trading') }, { label: title.value }])

// CSV export — exactly the rows this page has loaded (cursor-paginated), with
// the stored fields plus the server-computed live numbers when present.
const exporting = ref(false)
function exportCsv() {
  if (!rows.value.length) return
  exporting.value = true
  try {
    const csv = toCsv(rows.value, [
      { key: 'id', label: 'id', value: p => p.id },
      { key: 'account', label: 'account', value: p => p.account },
      { key: 'source', label: 'source', value: p => p.source },
      { key: 'symbol', label: 'symbol', value: p => p.symbol },
      { key: 'dir', label: 'dir', value: p => p.dir },
      { key: 'qty', label: 'qty', value: p => p.qty },
      { key: 'entryPrice', label: 'entryPrice', value: p => p.entryPrice },
      { key: 'entryTime', label: 'entryTime', value: p => p.entryTime },
      { key: 'sl', label: 'sl', value: p => p.sl },
      { key: 'tps', label: 'tps', value: p => p.tps.join(' ') },
      { key: 'exitPrice', label: 'exitPrice', value: p => p.exitPrice },
      { key: 'exitTime', label: 'exitTime', value: p => p.exitTime },
      { key: 'status', label: 'status', value: p => p.status },
      { key: 'exitReason', label: 'exitReason', value: p => p.exitReason },
      { key: 'pnlAbs', label: 'pnlAbs', value: p => p.pnlAbs },
      { key: 'pnlPct', label: 'pnlPct', value: p => p.pnlPct },
      { key: 'fees', label: 'fees', value: p => p.fees },
      { key: 'leverage', label: 'leverage', value: p => p.leverage },
      { key: 'method', label: 'method', value: p => p.method },
      { key: 'tf', label: 'tf', value: p => p.tf },
      { key: 'sessionId', label: 'sessionId', value: p => p.sessionId },
      { key: 'liveMark', label: 'liveMark', value: p => p.live?.mark ?? null },
      { key: 'liveUnrealized', label: 'liveUnrealized', value: p => p.live?.unrealized ?? null },
      { key: 'liveLiqPrice', label: 'liveLiqPrice', value: p => p.live?.liqPrice ?? null },
      { key: 'updatedAt', label: 'updatedAt', value: p => p.updatedAt }
    ])
    downloadCsv(csvFilename('tm-trading-positions'), csv)
    notify.success(t('common.export'), t('common.exportRows', { n: rows.value.length }))
  } finally {
    exporting.value = false
  }
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refreshPositions }
]))
mobileBar.registerInfo(computed(() => ({
  count: rows.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="positions" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('positions.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <TradingAccountSwitcher />
        <UBadge
          v-if="meta?.mongo === 'down'"
          :label="t('positions.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-download"
          :label="t('common.export')"
          variant="soft"
          color="neutral"
          size="sm"
          :disabled="!rows.length"
          :loading="exporting"
          @click="exportCsv"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshPositions"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <USelect
              v-model="statusFilter"
              :items="statusItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('positions.statusLabel')"
            />
            <USelect
              v-model="sourceFilter"
              :items="sourceItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('positions.sourceLabel')"
            />
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter
        :count="rows.length"
        :has-more="hasMore"
        :loading="isLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="metrics" cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" />

      <SharedRefreshNotice
        :stale="isStale"
        :retrying="isLoading"
        :message="t('common.staleData')"
        @retry="refreshPositions"
      />

      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="rows"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="hasMore"
          :action-options="rowActions"
          v-model:view-mode="viewMode"
          item-key="id"
          storage-key="positions-view-mode"
          @load-more="loadMorePositions"
          @refresh="refreshPositions"
        >
          <template #entryTime="{ item }">
            <time :datetime="item.entryTime" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.entryTime)) }}
            </time>
          </template>

          <template #symbol="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.tf ?? '—' }}</span>
            </div>
          </template>

          <template #dir="{ item }">
            <UBadge
              :label="dirLabel(item.dir)"
              :color="item.dir === 1 ? 'success' : 'error'"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #qty="{ item }">
            <span class="text-xs text-highlighted font-mono">{{ item.qty }}</span>
          </template>

          <template #entryPrice="{ item }">
            <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.entryPrice) }}</span>
          </template>

          <template #sl="{ item }">
            <span class="text-xs font-mono" :class="item.sl != null ? 'text-error' : 'text-dimmed'">
              {{ fmtPrice(item.sl) }}
            </span>
          </template>

          <template #status="{ item }">
            <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
          </template>

          <template #pnl="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-mono" :class="moneyClass(item.pnlAbs)">{{ fmtMoney(item.pnlAbs) }}</span>
              <span v-if="item.pnlPct != null" class="text-[10px] font-mono" :class="moneyClass(item.pnlAbs)">
                {{ fmtPct(item.pnlPct) }}
              </span>
            </div>
          </template>

          <template #source="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="text-xs text-highlighted truncate">{{ item.source }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.account }}</span>
            </div>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                  <span class="text-dimmed font-mono">{{ item.tf ?? '—' }}</span>
                  <UBadge
                    :label="dirLabel(item.dir)"
                    :color="item.dir === 1 ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                  {{ fmtPrice(item.entryPrice) }}
                  <span v-if="item.sl != null" class="text-error"> · SL {{ fmtPrice(item.sl) }}</span>
                </div>
                <div class="text-[10px] text-dimmed truncate mt-0.5">
                  {{ item.source }} · {{ item.account }} · {{ item.qty }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
                <span
                  class="block text-[11px] font-mono mt-1"
                  :class="moneyClass(item.pnlAbs)"
                >{{ fmtMoney(item.pnlAbs) }}</span>
                <time :datetime="item.entryTime" class="block text-[10px] text-muted">
                  {{ formatTimeAgo(new Date(item.entryTime)) }}
                </time>
              </div>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              v-if="hasError"
              :title="t('common.loadErrorTitle')"
              :description="t('common.loadErrorHint')"
              icon="i-lucide-triangle-alert"
              :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: refreshPositions }]"
            />
            <AdminEmptyState
              v-else
              :title="t('positions.empty')"
              :description="t('positions.emptyHint')"
              icon="i-lucide-layers"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
