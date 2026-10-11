<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { RecordingGroup } from '~~/types/data'

// Market Recordings (roadmap §58.9 Slice 4). Recorded rows grouped by venue:
// `candles` for OHLCV bars, the `market_feed` ledger for feed events. Aggregated
// server-side from the real persistence — not the manifest.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'dataCenter.recordingsTitle',
  descKey: 'dataCenter.recordingsDesc'
})
const { viewMode } = useAdminGridView('data-recordings-view-mode')
const dc = useDataCenter()

const rows = ref<RecordingGroup[]>([])
const isLoading = ref(false)
const planeFilter = ref('')

const filtered = computed(() =>
  planeFilter.value ? rows.value.filter(r => r.plane === planeFilter.value) : rows.value)

async function refresh() {
  isLoading.value = true
  try {
    rows.value = await dc.recordings()
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const fmtDate = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : '—')

const columns = computed<GridColumn[]>(() => [
  { key: 'plane', label: t('dataCenter.columns.plane'), class: 'w-24' },
  { key: 'kind', label: t('dataCenter.columns.kind'), class: 'w-28' },
  { key: 'symbol', label: t('dataCenter.columns.symbol'), class: 'w-28' },
  { key: 'timeframe', label: t('dataCenter.columns.timeframe'), class: 'w-16' },
  { key: 'source', label: t('dataCenter.columns.source'), class: 'w-32' },
  { key: 'count', label: t('dataCenter.columns.count'), class: 'w-28' },
  { key: 'range', label: t('dataCenter.columns.range'), class: 'w-44' },
  { key: 'datasetId', label: t('dataCenter.columns.dataset'), class: 'min-w-52' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="data-recordings" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-table"
          :label="t('dataCenter.viewDataset')"
          variant="soft"
          color="primary"
          size="sm"
          to="/data-research/data"
          :ui="{ label: 'hidden md:block' }"
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

    <template #toolbar>
      <div class="flex items-center gap-1 flex-wrap px-4 sm:px-6 py-2">
        <UButton
          v-for="p in ['', 'candles', 'feed']"
          :key="p || 'all'"
          :label="p ? t(`dataCenter.planeLabels.${p}`) : t('common.all')"
          size="xs"
          :color="planeFilter === p ? 'primary' : 'neutral'"
          :variant="planeFilter === p ? 'soft' : 'ghost'"
          @click="planeFilter = p"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="datasetId"
        storage-key="data-recordings-view-mode"
        @refresh="refresh"
      >
        <template #plane="{ item }">
          <UBadge
            :label="t(`dataCenter.planeLabels.${item.plane}`)"
            :color="item.plane === 'candles' ? 'primary' : 'info'"
            variant="subtle"
            size="xs"
          />
        </template>

        <template #kind="{ item }">
          <span class="text-[11px] text-muted">{{ item.kind }}</span>
        </template>

        <template #symbol="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.symbol }}</span>
        </template>

        <template #timeframe="{ item }">
          <span class="text-[11px] text-muted">{{ item.timeframe || '—' }}</span>
        </template>

        <template #source="{ item }">
          <span class="text-[11px] text-muted">{{ item.source || '—' }}</span>
        </template>

        <template #count="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.count.toLocaleString() }}</span>
        </template>

        <template #range="{ item }">
          <span class="text-[11px] text-muted">{{ fmtDate(item.startTs) }} → {{ fmtDate(item.endTs) }}</span>
        </template>

        <template #datasetId="{ item }">
          <span class="text-[11px] font-mono text-muted truncate">{{ item.datasetId || '—' }}</span>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted font-mono truncate">{{ item.symbol }}</span>
                <UBadge
                  :label="t(`dataCenter.planeLabels.${item.plane}`)"
                  :color="item.plane === 'candles' ? 'primary' : 'info'"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
              </div>
              <div class="text-[11px] text-dimmed mt-0.5 truncate">
                {{ item.kind }} · {{ item.timeframe || '—' }} · {{ item.count.toLocaleString() }}
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('dataCenter.recordingsEmpty')"
            :description="t('dataCenter.recordingsEmptyHint')"
            icon="i-lucide-video"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
