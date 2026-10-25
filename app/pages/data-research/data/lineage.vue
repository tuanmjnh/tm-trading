<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { LineageEntry } from '#shared/types/data'
import { formatTimeAgo } from '@vueuse/core'

// Test Data Lineage (roadmap §58.9 Slice 4, acceptance: traceable links).
// Answers "which dataset with which data hash produced this backtest series"
// by matching the D1 stamp (symbol+tf) to the recorder's candle datasets.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'dataCenter.lineageTitle',
  descKey: 'dataCenter.lineageDesc'
})
const { viewMode } = useAdminGridView('data-lineage-view-mode')
const dc = useDataCenter()

const rows = ref<LineageEntry[]>([])
const isLoading = ref(false)
const symbolFilter = ref('')

const filtered = computed(() => {
  const s = symbolFilter.value.trim().toLowerCase()
  return s ? rows.value.filter(r => r.symbol.toLowerCase().includes(s)) : rows.value
})

const metrics = computed(() => {
  const symbols = new Set(rows.value.map(r => r.symbol))
  const multi = rows.value.filter(r => r.dataHashCount > 1).length
  const linked = new Set(rows.value.flatMap(r => r.datasetIds)).size
  return [
    { key: 'series', label: t('dataCenter.metrics.series'), value: String(rows.value.length), icon: 'i-lucide-git-branch' },
    { key: 'symbols', label: t('dataCenter.metrics.symbols'), value: String(symbols.size), icon: 'i-lucide-hash' },
    { key: 'multiHash', label: t('dataCenter.metrics.multiHash'), value: String(multi), icon: 'i-lucide-shield-alert', tone: multi ? 'warning' as const : 'default' as const },
    { key: 'linked', label: t('dataCenter.metrics.linked'), value: String(linked), icon: 'i-lucide-link' }
  ]
})

const trail = computed(() => [
  { label: t('nav.data_center'), to: '/data-research/data' },
  { label: title.value }
])

async function refresh() {
  isLoading.value = true
  try {
    rows.value = await dc.lineage()
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const columns = computed<GridColumn[]>(() => [
  { key: 'seriesId', label: t('dataCenter.columns.series'), class: 'min-w-56' },
  { key: 'symbol', label: t('dataCenter.columns.symbol'), class: 'w-28' },
  { key: 'tf', label: t('dataCenter.columns.timeframe'), class: 'w-16' },
  { key: 'market', label: t('dataCenter.columns.market'), class: 'w-20' },
  { key: 'method', label: t('dataCenter.columns.method'), class: 'w-24' },
  { key: 'engineVersion', label: t('dataCenter.columns.engine'), class: 'w-24' },
  { key: 'dataHashCount', label: t('dataCenter.columns.dataHash'), class: 'w-24' },
  { key: 'datasetIds', label: t('dataCenter.columns.linked'), class: 'min-w-52' },
  { key: 'lastRunAt', label: t('dataCenter.columns.lastRun'), class: 'w-28' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="data-lineage" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('dataCenter.pips.lineage')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UInput
          v-model="symbolFilter"
          :placeholder="t('dataCenter.searchSymbol')"
          icon="i-lucide-search"
          size="sm"
          class="w-40"
          :aria-label="t('dataCenter.columns.symbol')"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refresh"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="metrics" />
      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="seriesId"
        storage-key="data-lineage-view-mode"
        @refresh="refresh"
      >
        <template #seriesId="{ item }">
          <span class="text-[11px] font-mono text-highlighted truncate">{{ item.seriesId }}</span>
        </template>

        <template #symbol="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.symbol }}</span>
        </template>

        <template #tf="{ item }">
          <span class="text-[11px] text-muted">{{ item.tf }}</span>
        </template>

        <template #market="{ item }">
          <span class="text-[11px] text-muted">{{ item.market }}</span>
        </template>

        <template #method="{ item }">
          <span class="text-[11px] text-muted">{{ item.method }}</span>
        </template>

        <template #engineVersion="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.engineVersion }}</span>
        </template>

        <template #dataHashCount="{ item }">
          <span class="text-[11px] font-mono" :class="item.dataHashCount > 1 ? 'text-warning' : 'text-muted'">
            {{ item.dataHashCount }}
          </span>
        </template>

        <template #datasetIds="{ item }">
          <span v-if="item.datasetIds.length" class="text-[11px] font-mono text-muted truncate">
            {{ item.datasetIds.join(', ') }}
          </span>
          <span v-else class="text-[11px] text-dimmed">{{ t('dataCenter.unknown') }}</span>
        </template>

        <template #lastRunAt="{ item }">
          <time v-if="item.lastRunAt" :datetime="new Date(item.lastRunAt).toISOString()" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.lastRunAt)) }}
          </time>
          <span v-else class="text-[11px] text-dimmed">—</span>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold text-highlighted font-mono truncate">{{ item.symbol }} · {{ item.tf }}</div>
              <div class="text-[11px] text-dimmed mt-0.5 truncate">
                {{ item.method }} · {{ item.datasetIds.length }} {{ t('dataCenter.columns.linked').toLowerCase() }}
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('dataCenter.lineageEmpty')"
            :description="t('dataCenter.lineageEmptyHint')"
            icon="i-lucide-git-branch"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
