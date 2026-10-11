<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { JournalEntry, JournalStats } from '~~/types/journal'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'journal.title',
  descKey: 'journal.desc'
})
const { viewMode } = useAdminGridView('journal-view-mode')
const { buildRowActions } = useAdminRowActions()
const journalApi = useJournal()

const sourceFilter = ref('all')
const resultFilter = ref('all')

// Stats cover the WHOLE filtered set (endpoint computes them pre-pagination).
const stats = ref<JournalStats | null>(null)
const metaSource = ref<'mongo' | 'ndjson' | 'none' | null>(null)

const journalList = useCursorPagination<JournalEntry>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await journalApi.list({
      cursor: typeof cursor === 'string' ? cursor : null,
      limit,
      source: sourceFilter.value === 'all' ? undefined : sourceFilter.value,
      result: resultFilter.value === 'all' ? undefined : resultFilter.value
    })
    stats.value = res.stats
    metaSource.value = res.meta?.source ?? null
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: rows, loading: isLoading, hasMore } = journalList

const sourceItems = computed(() => [
  { label: t('journal.filterAll'), value: 'all' },
  { label: t('journal.srcPaper'), value: 'paper' },
  { label: t('journal.srcMt5'), value: 'mt5' },
  { label: t('journal.srcExchange'), value: 'exchange' },
  { label: t('journal.srcManual'), value: 'manual' }
])
const resultItems = computed(() => [
  { label: t('journal.filterAll'), value: 'all' },
  { label: t('journal.resTP'), value: 'TP' },
  { label: t('journal.resSL'), value: 'SL' },
  { label: t('journal.resTIME'), value: 'TIME' },
  { label: t('journal.resOPEN'), value: 'OPEN' },
  { label: t('journal.resUnknown'), value: 'unknown' }
])

async function refreshJournal() {
  try {
    await journalList.refresh()
  } catch (err) {
    notify.error(t('journal.title'), getErrorMessage(err, key => t(key)))
  }
}

async function loadMoreJournal() {
  try {
    await journalList.loadMore()
  } catch (err) {
    notify.error(t('journal.title'), getErrorMessage(err, key => t(key)))
  }
}

// Any filter change restarts pagination from page 1.
watch([sourceFilter, resultFilter], () => {
  stats.value = null
  refreshJournal()
})

onMounted(refreshJournal)

const columns = computed<GridColumn[]>(() => [
  { key: 'entryTime', label: t('journal.colTime'), class: 'w-36' },
  { key: 'symbol', label: t('journal.colSymbol'), class: 'w-40' },
  { key: 'dir', label: t('journal.colDir'), class: 'w-20' },
  { key: 'source', label: t('journal.colSource'), class: 'w-32' },
  { key: 'entryPrice', label: t('journal.colEntry'), class: 'w-24' },
  { key: 'exitPrice', label: t('journal.colExit'), class: 'w-24' },
  { key: 'rMultiple', label: 'R', class: 'w-20' },
  { key: 'pnlAbs', label: t('journal.colPnl'), class: 'w-24' },
  { key: 'result', label: t('journal.colResult'), class: 'w-24' },
  { key: 'method', label: t('journal.colMethod'), class: 'w-36' }
])

const rowActions = () => buildRowActions([])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
const fmtR = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const rClass = (v: number | null) =>
  v == null || !Number.isFinite(v) ? 'text-muted' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const fmtPct = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`
const fmtMoney = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`

const dirLabel = (d: number) => (d === 1 ? t('journal.dirLong') : t('journal.dirShort'))
const resultLabel = (r: JournalEntry['result']) => {
  if (r === 'TP') return t('journal.resTP')
  if (r === 'SL') return t('journal.resSL')
  if (r === 'TIME') return t('journal.resTIME')
  if (r === 'OPEN') return t('journal.resOPEN')
  return t('journal.resUnknown')
}
const resultColor = (r: JournalEntry['result']): 'success' | 'error' | 'warning' | 'info' | 'neutral' =>
  r === 'TP' ? 'success' : r === 'SL' ? 'error' : r === 'OPEN' ? 'info' : r === 'TIME' ? 'warning' : 'neutral'

const statCards = computed(() => {
  const s = stats.value
  return [
    { key: 'total', label: t('journal.statTotal'), value: s ? String(s.n) : '—' },
    { key: 'closed', label: t('journal.statClosed'), value: s ? String(s.closed) : '—' },
    { key: 'open', label: t('journal.statOpen'), value: s ? String(s.open) : '—' },
    { key: 'winRate', label: t('journal.statWinRate'), value: s ? fmtPct(s.winRate) : '—' },
    { key: 'expectancy', label: t('journal.statExpectancy'), value: s ? fmtR(s.expectancyR) : '—', r: s?.expectancyR ?? null },
    { key: 'median', label: t('journal.statMedianR'), value: s ? fmtR(s.medianR) : '—', r: s?.medianR ?? null },
    { key: 'pf', label: t('journal.statProfitFactor'), value: s ? fmtR(s.profitFactorR) : '—' }
  ]
})

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refreshJournal }
]))
mobileBar.registerInfo(computed(() => ({
  count: rows.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="journal" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="metaSource"
          :label="metaSource === 'mongo' ? t('journal.srcMongo') : metaSource === 'ndjson' ? t('journal.srcNdjson') : t('journal.srcNone')"
          :color="metaSource === 'mongo' ? 'success' : metaSource === 'ndjson' ? 'info' : 'warning'"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="stats?.insufficient"
          :label="t('journal.insufficient')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshJournal"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <USelect
              v-model="sourceFilter"
              :items="sourceItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('journal.sourceLabel')"
            />
            <USelect
              v-model="resultFilter"
              :items="resultItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('journal.resultLabel')"
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
      <!-- Whole-set metrics (D12 gate shown as a badge in the header). -->
      <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 shrink-0">
        <div
          v-for="c in statCards"
          :key="c.key"
          class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0"
        >
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ c.label }}</span>
          <span
            class="text-sm font-bold font-mono truncate"
            :class="'r' in c && c.r != null ? rClass(c.r) : 'text-highlighted'"
          >{{ c.value }}</span>
        </div>
      </div>

      <p
        v-if="stats?.insufficient && stats.insufficientReason"
        class="text-[11px] text-warning shrink-0"
      >{{ stats.insufficientReason }}</p>

      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="rows"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="hasMore"
          :action-options="rowActions"
          v-model:view-mode="viewMode"
          item-key="key"
          storage-key="journal-view-mode"
          @load-more="loadMoreJournal"
          @refresh="refreshJournal"
        >
          <template #entryTime="{ item }">
            <time :datetime="item.entryTime" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.entryTime)) }}
            </time>
          </template>

          <template #symbol="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.tf }}</span>
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

          <template #source="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="text-xs text-highlighted truncate">{{ item.source }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.account }}</span>
            </div>
          </template>

          <template #entryPrice="{ item }">
            <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.entryPrice) }}</span>
          </template>

          <template #exitPrice="{ item }">
            <span class="text-xs font-mono" :class="item.exitPrice != null ? 'text-muted' : 'text-dimmed'">
              {{ fmtPrice(item.exitPrice) }}
            </span>
          </template>

          <template #rMultiple="{ item }">
            <span class="text-xs font-mono font-semibold" :class="rClass(item.rMultiple)">{{ fmtR(item.rMultiple) }}</span>
          </template>

          <template #pnlAbs="{ item }">
            <span class="text-xs font-mono" :class="item.pnlAbs != null ? rClass(item.pnlAbs) : 'text-dimmed'">
              {{ fmtMoney(item.pnlAbs) }}
            </span>
          </template>

          <template #result="{ item }">
            <UBadge :label="resultLabel(item.result)" :color="resultColor(item.result)" variant="subtle" size="xs" />
          </template>

          <template #method="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="text-xs text-highlighted truncate">{{ item.method }}</span>
              <span class="text-[10px] text-dimmed truncate">{{ item.regime }}</span>
            </div>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                  <span class="text-dimmed font-mono">{{ item.tf }}</span>
                  <UBadge
                    :label="dirLabel(item.dir)"
                    :color="item.dir === 1 ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                  {{ fmtPrice(item.entryPrice) }}
                  <span v-if="item.exitPrice != null"> → {{ fmtPrice(item.exitPrice) }}</span>
                  <span class="ml-1" :class="rClass(item.rMultiple)">R {{ fmtR(item.rMultiple) }}</span>
                </div>
                <div class="text-[10px] text-dimmed truncate mt-0.5">
                  {{ item.source }} · {{ item.account }} · {{ item.method }} · {{ item.regime }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <UBadge :label="resultLabel(item.result)" :color="resultColor(item.result)" variant="subtle" size="xs" />
                <time :datetime="item.entryTime" class="block text-[10px] text-muted mt-1">
                  {{ formatTimeAgo(new Date(item.entryTime)) }}
                </time>
              </div>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('journal.empty')"
              :description="t('journal.emptyHint')"
              icon="i-lucide-book-marked"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
