<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { Dataset } from '~~/types/data'
import { formatTimeAgo } from '@vueuse/core'

// Dataset Library (roadmap §58.9 Slice 4, §23.4). The retention manifest the
// recorder keeps in sync — one row per kind × source × symbol × timeframe.
// Read-only projection of real persistence; never a placeholder.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'dataCenter.datasetsTitle',
  descKey: 'dataCenter.datasetsDesc'
})
const { viewMode } = useAdminGridView('data-datasets-view-mode')
const dc = useDataCenter()

const rows = ref<Dataset[]>([])
const isLoading = ref(false)
const symbolFilter = ref('')
const kindFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    rows.value = await dc.datasets({
      limit: 500,
      symbol: symbolFilter.value.trim(),
      kind: kindFilter.value
    })
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch(kindFilter, refresh)

const fmtDate = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : '—')

const columns = computed<GridColumn[]>(() => [
  { key: 'datasetId', label: t('dataCenter.columns.dataset'), class: 'min-w-56' },
  { key: 'kind', label: t('dataCenter.columns.kind'), class: 'w-24' },
  { key: 'symbol', label: t('dataCenter.columns.symbol'), class: 'w-28' },
  { key: 'timeframe', label: t('dataCenter.columns.timeframe'), class: 'w-16' },
  { key: 'count', label: t('dataCenter.columns.count'), class: 'w-24' },
  { key: 'range', label: t('dataCenter.columns.range'), class: 'w-44' },
  { key: 'retention', label: t('dataCenter.columns.retention'), class: 'w-24' },
  { key: 'compression', label: t('dataCenter.columns.compression'), class: 'w-28' },
  { key: 'checksum', label: t('dataCenter.columns.checksum'), class: 'w-28' },
  { key: 'updated', label: t('dataCenter.columns.updated'), class: 'w-28' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="data-datasets" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-badge-check"
          :label="t('dataCenter.viewQuality')"
          variant="soft"
          color="primary"
          size="sm"
          to="/data-research/data/quality"
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
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UButton
          v-for="k in [{ v: '', l: 'dataCenter.allKinds' }, { v: 'candles', l: 'dataCenter.kindLabels.candles' }]"
          :key="k.v || 'all'"
          :label="t(k.l)"
          size="xs"
          :color="kindFilter === k.v ? 'primary' : 'neutral'"
          :variant="kindFilter === k.v ? 'soft' : 'ghost'"
          @click="kindFilter = k.v"
        />
        <UInput
          v-model="symbolFilter"
          :placeholder="t('dataCenter.searchSymbol')"
          icon="i-lucide-search"
          size="xs"
          class="w-44"
          :aria-label="t('dataCenter.columns.symbol')"
          @keyup.enter="refresh"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="rows.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList
        :items="rows"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="datasetId"
        storage-key="data-datasets-view-mode"
        @refresh="refresh"
      >
        <template #datasetId="{ item }">
          <span class="text-[11px] font-mono text-highlighted truncate">{{ item.datasetId }}</span>
        </template>

        <template #kind="{ item }">
          <UBadge
            :label="item.kind === 'candles' ? t('dataCenter.kindLabels.candles') : item.kind"
            :color="item.kind === 'candles' ? 'primary' : 'info'"
            variant="subtle"
            size="xs"
          />
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

        <template #range="{ item }">
          <span class="text-[11px] text-muted">{{ fmtDate(item.startTs) }} → {{ fmtDate(item.endTs) }}</span>
        </template>

        <template #retention="{ item }">
          <span class="text-[11px] text-muted">{{ item.retentionDays }} {{ t('dataCenter.days') }}</span>
        </template>

        <template #compression="{ item }">
          <span class="text-[11px] text-muted">{{ item.compression }}</span>
        </template>

        <template #checksum="{ item }">
          <span v-if="item.checksum" class="text-[11px] font-mono text-muted truncate">{{ item.checksum.slice(0, 10) }}</span>
          <span v-else class="text-[11px] text-dimmed">{{ t('dataCenter.pending') }}</span>
        </template>

        <template #updated="{ item }">
          <time v-if="item.updatedAt" :datetime="new Date(item.updatedAt).toISOString()" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.updatedAt)) }}
          </time>
          <span v-else class="text-[11px] text-dimmed">—</span>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted font-mono truncate">{{ item.symbol }}</span>
                <UBadge
                  :label="item.kind === 'candles' ? t('dataCenter.kindLabels.candles') : item.kind"
                  :color="item.kind === 'candles' ? 'primary' : 'info'"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
              </div>
              <div class="text-[11px] text-dimmed mt-0.5 truncate">
                {{ item.source }} · {{ item.timeframe || '—' }} · {{ item.count.toLocaleString() }}
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('dataCenter.datasetsEmpty')"
            :description="t('dataCenter.datasetsEmptyHint')"
            icon="i-lucide-table"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
