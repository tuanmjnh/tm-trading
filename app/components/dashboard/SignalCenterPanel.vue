<script setup lang="ts">
// Signal Center (V5.0 §3.2) — every research event and observation in ONE table.
// Rows are produced by the services/engine; the panel only filters, sorts and
// opens the detail overlay. It never recalculates a value (D1).
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { FeedCategory, FeedEvent, Freshness } from '~/composables/useDashboardFeed'
import { freshnessOf } from '~/composables/useDashboardFeed'
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { events, loading, failed, signalCursor, signalTotal, watchSymbols, loadSignals } = useDashboardFeed()
const overlay = useAppOverlay()

const category = ref<'all' | FeedCategory>('all')
const freshness = ref<'all' | 'fresh' | 'stale'>('all')
const watchOnly = ref(false)
const search = ref('')
const sortDesc = ref(true)

const categories: Array<'all' | FeedCategory> = ['all', 'indicator', 'volatility', 'volume', 'funding', 'oi', 'news']

function rowFreshness(row: FeedEvent): Freshness {
  if (row.category === 'news') return freshnessOf(row.detectedAt, 'news')
  if (row.category === 'indicator') return freshnessOf(row.detectedAt, 'signals')
  return freshnessOf(row.detectedAt, 'intel')
}

const rows = computed(() => {
  const needle = search.value.trim().toUpperCase()
  const list = events.value
    .filter(row => (category.value === 'all' ? true : row.category === category.value))
    .filter(row => (freshness.value === 'all' ? true : rowFreshness(row) === freshness.value))
    .filter(row => (watchOnly.value ? watchSymbols.value.has(row.symbol.toUpperCase()) : true))
    .filter(row => (!needle ? true : row.symbol.toUpperCase().includes(needle) || row.context.toUpperCase().includes(needle)))
  return sortDesc.value ? list : [...list].reverse()
})

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('dash.signal.colAsset'), class: 'w-28', sortable: true, sort: 'desc' },
  { key: 'category', label: t('dash.signal.colType'), class: 'w-28 hidden md:flex' },
  { key: 'timeframe', label: t('dash.signal.colTf'), class: 'w-14 hidden lg:flex' },
  { key: 'context', label: t('dash.signal.colContext'), class: 'min-w-[160px] flex-1' },
  { key: 'quality', label: t('dash.signal.colQuality'), class: 'w-20 hidden xl:flex' },
  { key: 'detectedAt', label: t('dash.signal.colDetected'), class: 'w-28 hidden sm:flex', sortable: true, sort: 'desc' },
  { key: 'source', label: t('dash.signal.colSource'), class: 'w-32 hidden xl:flex' },
  { key: 'freshness', label: t('dash.signal.colFreshness'), class: 'w-24' },
  { key: 'status', label: t('dash.signal.colStatus'), class: 'w-24 hidden lg:flex' }
])

const quality = (v: number | null) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2))

const freshnessColor = (v: Freshness) => (v === 'fresh' ? 'success' : v === 'stale' ? 'warning' : 'neutral')

function openDetail(row: FeedEvent) {
  overlay.open('signal', { id: row.key })
}

function toggleSort() {
  sortDesc.value = !sortDesc.value
}

const canLoadMore = computed(() => !!signalCursor.value && !loading.signals)

async function loadMore() {
  if (!signalCursor.value) return
  await loadSignals(true)
}
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-radio" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.signal.title') }}</h2>
        <UBadge color="neutral" variant="subtle" size="xs" :label="`${rows.length} / ${signalTotal}`" />
        <UBadge v-if="failed.signals" color="warning" variant="subtle" size="xs" icon="i-lucide-database-zap"
          :label="t('intel.mongoDown')" />
        <span class="text-[11px] text-muted hidden lg:inline">{{ t('dash.signal.hint') }}</span>
      </div>
    </template>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        size="sm"
        class="w-full sm:w-56"
        :placeholder="t('dash.signal.filter.search')"
        :aria-label="t('dash.signal.filter.search')"
      />
      <USelect
        v-model="category"
        size="sm"
        class="w-full sm:w-44"
        :aria-label="t('dash.signal.filter.category')"
        :items="categories.map(c => ({ label: t(`dash.signal.filter.${c}`), value: c }))"
      />
      <USelect
        v-model="freshness"
        size="sm"
        class="w-full sm:w-36"
        :aria-label="t('dash.signal.filter.freshness')"
        :items="(['all', 'fresh', 'stale'] as const).map(f => ({ label: t(`dash.signal.filter.${f}`), value: f }))"
      />
      <UButton
        :icon="watchOnly ? 'i-lucide-star' : 'i-lucide-star-off'"
        :label="t('dash.signal.filter.watchlist')"
        :color="watchOnly ? 'primary' : 'neutral'"
        :variant="watchOnly ? 'soft' : 'ghost'"
        size="sm"
        @click="watchOnly = !watchOnly"
      />
      <UButton
        class="ms-auto"
        :icon="sortDesc ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide'"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="t('dash.signal.sort')"
        @click="toggleSort"
      />
    </div>

    <UAlert
      v-if="failed.signals && !rows.length"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-circle"
      :title="t('common.loadErrorTitle')"
      :description="t('common.loadErrorHint')"
      class="mb-3"
    />

    <LazyGridList
      :items="rows"
      :columns="columns"
      :loading="loading.signals && !rows.length"
      item-key="key"
      storage-key="v5-signal-center"
      :can-load-more="false"
      :draggable="false"
      :action-options="undefined"
      :ui-scroll-area="{ root: 'max-h-[min(58vh,640px)]' }"
      @click="openDetail"
      @sort="toggleSort"
    >
      <template #symbol="{ item }">
        <div class="flex items-center gap-1.5 min-w-0">
          <UIcon
            v-if="watchSymbols.has(item.symbol.toUpperCase())"
            name="i-lucide-star"
            class="size-3 text-primary shrink-0"
          />
          <span class="font-mono text-xs font-semibold text-highlighted truncate">{{ item.symbol }}</span>
        </div>
      </template>

      <template #category="{ item }">
        <UBadge color="neutral" variant="subtle" size="xs" :label="t(`dash.signal.filter.${item.category}`)" />
      </template>

      <template #timeframe="{ item }">
        <span class="font-mono text-[11px] text-muted">{{ item.timeframe }}</span>
      </template>

      <template #context="{ item }">
        <span class="text-xs text-toned line-clamp-1">{{ item.context }}</span>
      </template>

      <template #quality="{ item }">
        <span class="font-mono text-[11px]" :class="item.quality == null ? 'text-dimmed' : 'text-highlighted'">
          {{ quality(item.quality) }}
        </span>
      </template>

      <template #detectedAt="{ item }">
        <span class="text-[11px] text-muted">{{ item.detectedAt ? formatTimeAgo(new Date(item.detectedAt)) : '—' }}</span>
      </template>

      <template #source="{ item }">
        <span class="text-[11px] text-muted truncate" :title="item.method">{{ item.source }}</span>
      </template>

      <template #freshness="{ item }">
        <UBadge
          :color="freshnessColor(rowFreshness(item))"
          variant="subtle"
          size="xs"
          :label="t(`dash.freshness.${rowFreshness(item)}`)"
        />
      </template>

      <template #status="{ item }">
        <span class="text-[11px] text-muted">{{ item.status }}</span>
      </template>

      <template #mobile-content="{ item }">
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold">{{ item.symbol }}</span>
            <UBadge color="neutral" variant="subtle" size="xs" :label="t(`dash.signal.filter.${item.category}`)" />
            <UBadge :color="freshnessColor(rowFreshness(item))" variant="subtle" size="xs"
              :label="t(`dash.freshness.${rowFreshness(item)}`)" />
          </div>
          <p class="text-xs text-toned line-clamp-2 break-words">{{ item.context }}</p>
          <p class="text-[11px] text-muted">
            {{ item.timeframe }} · {{ item.source }} ·
            {{ item.detectedAt ? formatTimeAgo(new Date(item.detectedAt)) : '—' }}
          </p>
        </div>
      </template>

      <template #empty>
        <AdminEmptyState :title="t('dash.signal.empty')" :description="t('dash.signal.emptyHint')" icon="i-lucide-radio" />
      </template>
    </LazyGridList>

    <div class="mt-3 flex items-center justify-between gap-2">
      <span class="text-[11px] text-muted">{{ t('dash.signal.loaded', { count: rows.length }) }}</span>
      <UButton
        v-if="canLoadMore"
        :label="t('dash.signal.loadMore')"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading.signals"
        @click="loadMore"
      />
    </div>
  </UCard>
</template>
