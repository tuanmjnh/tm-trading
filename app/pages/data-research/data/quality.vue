<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { DatasetQuality, QualityVerdict } from '#shared/types/data'
import { formatTimeAgo } from '@vueuse/core'

// Data Quality (roadmap §58.9 Slice 4). Coverage/gap/staleness verdict derived
// from the manifest's MEASURED start/end/count — never guessed (D12).
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'dataCenter.qualityTitle',
  descKey: 'dataCenter.qualityDesc'
})
const { viewMode } = useAdminGridView('data-quality-view-mode')
const dc = useDataCenter()

const rows = ref<DatasetQuality[]>([])
const isLoading = ref(false)
const verdictFilter = ref('')

const filtered = computed(() =>
  verdictFilter.value ? rows.value.filter(r => r.verdict === verdictFilter.value) : rows.value)

const counts = computed(() => ({
  ok: rows.value.filter(r => r.verdict === 'ok').length,
  warn: rows.value.filter(r => r.verdict !== 'ok').length
}))

async function refresh() {
  isLoading.value = true
  try {
    rows.value = await dc.quality({ limit: 500 })
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const verdictColor = (v: QualityVerdict) =>
  v === 'ok' ? 'success'
    : v === 'gap' || v === 'stale' ? 'warning'
      : v === 'suspect' ? 'error'
        : 'neutral'
const verdictLabel = (v: QualityVerdict) => t(`dataCenter.verdictLabels.${v}`)

const verdictChips = computed(() => [
  { value: '', label: t('common.all'), count: rows.value.length },
  { value: 'ok', label: verdictLabel('ok'), count: rows.value.filter(r => r.verdict === 'ok').length },
  { value: 'gap', label: verdictLabel('gap'), count: rows.value.filter(r => r.verdict === 'gap').length },
  { value: 'stale', label: verdictLabel('stale'), count: rows.value.filter(r => r.verdict === 'stale').length },
  { value: 'suspect', label: verdictLabel('suspect'), count: rows.value.filter(r => r.verdict === 'suspect').length },
  { value: 'empty', label: verdictLabel('empty'), count: rows.value.filter(r => r.verdict === 'empty').length }
])

const metrics = computed(() => {
  const cov = rows.value.map(r => r.coveragePct).filter((v): v is number => typeof v === 'number')
  const avg = cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null
  return [
    { key: 'datasets', label: t('dataCenter.metrics.datasets'), value: String(rows.value.length), icon: 'i-lucide-database' },
    { key: 'healthy', label: t('dataCenter.metrics.healthy'), value: String(counts.value.ok), icon: 'i-lucide-circle-check', tone: 'success' as const },
    { key: 'flagged', label: t('dataCenter.metrics.flagged'), value: String(counts.value.warn), icon: 'i-lucide-triangle-alert', tone: counts.value.warn ? 'warning' as const : 'default' as const },
    { key: 'coverage', label: t('dataCenter.metrics.coverage'), value: avg == null ? '—' : `${avg.toFixed(1)}%`, icon: 'i-lucide-percent' }
  ]
})

const trail = computed(() => [
  { label: t('nav.data_center'), to: '/data-research/data' },
  { label: title.value }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'datasetId', label: t('dataCenter.columns.dataset'), class: 'min-w-52' },
  { key: 'symbol', label: t('dataCenter.columns.symbol'), class: 'w-28' },
  { key: 'timeframe', label: t('dataCenter.columns.timeframe'), class: 'w-16' },
  { key: 'count', label: t('dataCenter.columns.count'), class: 'w-24' },
  { key: 'expected', label: t('dataCenter.columns.range'), class: 'w-24' },
  { key: 'coverage', label: t('dataCenter.columns.coverage'), class: 'w-24' },
  { key: 'gaps', label: t('dataCenter.columns.gaps'), class: 'w-20' },
  { key: 'age', label: t('dataCenter.columns.age'), class: 'w-28' },
  { key: 'verdict', label: t('dataCenter.columns.verdict'), class: 'w-24' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="data-quality" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('dataCenter.pips.quality')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge :label="`${counts.ok} / ${counts.warn}`" color="neutral" variant="subtle" size="sm" />
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

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <SharedFilterChips v-model="verdictFilter" :items="verdictChips" />
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
        item-key="datasetId"
        storage-key="data-quality-view-mode"
        @refresh="refresh"
      >
        <template #datasetId="{ item }">
          <span class="text-[11px] font-mono text-highlighted truncate">{{ item.datasetId }}</span>
        </template>

        <template #symbol="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.symbol }}</span>
        </template>

        <template #timeframe="{ item }">
          <span class="text-[11px] text-muted">{{ item.timeframe || '—' }}</span>
        </template>

        <template #count="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.count.toLocaleString() }}</span>
        </template>

        <template #expected="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.expected != null ? item.expected.toLocaleString() : '—' }}</span>
        </template>

        <template #coverage="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.coveragePct != null ? `${item.coveragePct}%` : '—' }}</span>
        </template>

        <template #gaps="{ item }">
          <span class="text-[11px] font-mono" :class="item.gaps ? 'text-warning' : 'text-muted'">
            {{ item.gaps != null ? item.gaps.toLocaleString() : '—' }}
          </span>
        </template>

        <template #age="{ item }">
          <time v-if="item.endTs" :datetime="new Date(item.endTs).toISOString()" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.endTs)) }}
          </time>
          <span v-else class="text-[11px] text-dimmed">—</span>
        </template>

        <template #verdict="{ item }">
          <UBadge :label="verdictLabel(item.verdict)" :color="verdictColor(item.verdict)" variant="subtle" size="xs" />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted font-mono truncate">{{ item.symbol }}</span>
                <UBadge :label="verdictLabel(item.verdict)" :color="verdictColor(item.verdict)" variant="subtle" size="xs" class="shrink-0" />
              </div>
              <div class="text-[11px] text-dimmed mt-0.5 truncate">
                {{ item.timeframe || '—' }} · {{ item.count.toLocaleString() }} / {{ item.expected != null ? item.expected.toLocaleString() : '—' }}
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('dataCenter.qualityEmpty')"
            :description="t('dataCenter.qualityEmptyHint')"
            icon="i-lucide-badge-check"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
