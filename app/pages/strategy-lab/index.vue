<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { FilterChip } from '~/components/FilterChips.vue'
import type { StrategyProfile } from '~~/types/strategy'
import { formatTimeAgo } from '@vueuse/core'

// Strategy Library (roadmap §58.9 Slice 2 §57.4 F). Reusable strategy profiles
// pointing at immutable strategy versions (§29). Read-only.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.strategies.title',
  descKey: 'strategyLab.strategies.desc'
})
const { viewMode } = useAdminGridView('strategies-view-mode')
const strategiesApi = useStrategies()

const profiles = ref<StrategyProfile[]>([])
const isLoading = ref(false)
const statusFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    profiles.value = await strategiesApi.list()
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

function openDetail(item: StrategyProfile) {
  navigateTo(`/strategy-lab/${encodeURIComponent(item._id)}`)
}

const statusColor = (s: string) =>
  s === 'active' ? 'success' : s === 'paused' ? 'warning' : s === 'retired' ? 'error' : 'neutral'
const statusLabel = (s: string) => t(`strategyLab.strategies.statusLabels.${s}`)

const counts = computed(() => {
  const c = { total: profiles.value.length, active: 0, paused: 0, retired: 0, draft: 0 }
  for (const p of profiles.value) {
    if (p.status === 'active') c.active++
    else if (p.status === 'paused') c.paused++
    else if (p.status === 'retired') c.retired++
    else if (p.status === 'draft') c.draft++
  }
  return c
})

const versionedCount = computed(() => profiles.value.filter(p => !!p.strategyVersionId).length)

const filtered = computed(() =>
  statusFilter.value ? profiles.value.filter(p => p.status === statusFilter.value) : profiles.value
)

const metrics = computed<MetricItem[]>(() => [
  {
    key: 'total',
    label: t('strategyLab.strategies.metrics.total'),
    value: String(counts.value.total),
    tone: 'primary',
    hint: t('strategyLab.strategies.metrics.versionedHint', { n: versionedCount.value })
  },
  { key: 'active', label: t('strategyLab.strategies.statusLabels.active'), value: String(counts.value.active), tone: 'success' },
  { key: 'paused', label: t('strategyLab.strategies.statusLabels.paused'), value: String(counts.value.paused), tone: 'warning' },
  { key: 'retired', label: t('strategyLab.strategies.statusLabels.retired'), value: String(counts.value.retired), tone: 'error' }
])

const statusChips = computed<FilterChip[]>(() => [
  { value: '', label: t('common.all'), count: counts.value.total },
  { value: 'active', label: t('strategyLab.strategies.statusLabels.active'), count: counts.value.active },
  { value: 'paused', label: t('strategyLab.strategies.statusLabels.paused'), count: counts.value.paused },
  { value: 'retired', label: t('strategyLab.strategies.statusLabels.retired'), count: counts.value.retired },
  { value: 'draft', label: t('strategyLab.strategies.statusLabels.draft'), count: counts.value.draft }
])

const trail = computed(() => [
  { label: t('nav.strategy_lab') },
  { label: t('nav.strategies') }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('strategyLab.strategies.profile'), class: 'w-56' },
  { key: 'status', label: t('strategyLab.strategies.status'), class: 'w-28' },
  { key: 'strategyVersionId', label: t('strategyLab.strategies.version'), class: 'w-44' },
  { key: 'instruments', label: t('strategyLab.strategies.instruments'), class: 'w-44' },
  { key: 'timeframes', label: t('strategyLab.strategies.timeframes'), class: 'w-24' },
  { key: 'updatedAt', label: t('strategyLab.strategies.updated'), class: 'w-32' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="strategies" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('strategyLab.pips.strategies')" />
    </template>

    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        color="neutral"
        size="sm"
        :loading="isLoading"
        @click="refresh"
      />
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />
      <FilterChips v-model="statusFilter" :items="statusChips" />

      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="filtered"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="viewMode"
          item-key="_id"
          storage-key="strategies-view-mode"
          @refresh="refresh"
          @click="openDetail"
        >
          <template #name="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.name || item.profileId }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.profileId }}</span>
            </div>
          </template>

          <template #status="{ item }">
            <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
          </template>

          <template #strategyVersionId="{ item }">
            <span class="text-[11px] font-mono text-muted truncate">{{ item.strategyVersionId || '—' }}</span>
          </template>

          <template #instruments="{ item }">
            <span class="text-[11px] text-muted truncate">{{ item.instruments.length ? item.instruments.join(', ') : '—' }}</span>
          </template>

          <template #timeframes="{ item }">
            <span class="text-[11px] text-muted">{{ item.timeframes.length ? item.timeframes.join(', ') : '—' }}</span>
          </template>

          <template #updatedAt="{ item }">
            <time :datetime="new Date(item.updatedAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.updatedAt)) }}
            </time>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.name || item.profileId }}</span>
                  <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" class="shrink-0" />
                </div>
                <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">{{ item.strategyVersionId || item.profileId }}</div>
              </div>
              <time :datetime="new Date(item.updatedAt).toISOString()" class="text-[10px] text-muted shrink-0">
                {{ formatTimeAgo(new Date(item.updatedAt)) }}
              </time>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('strategyLab.strategies.empty')"
              :description="t('strategyLab.strategies.emptyHint')"
              icon="i-lucide-library"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
