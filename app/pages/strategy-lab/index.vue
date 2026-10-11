<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
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

async function refresh() {
  isLoading.value = true
  try {
    profiles.value = await strategiesApi.list()
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

const statusColor = (s: string) =>
  s === 'active' ? 'success' : s === 'paused' ? 'warning' : s === 'retired' ? 'error' : 'neutral'
const statusLabel = (s: string) => t(`strategyLab.strategies.statusLabels.${s}`)

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
      <SharedListFooter :count="profiles.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList
        :items="profiles"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="_id"
        storage-key="strategies-view-mode"
        @refresh="refresh"
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
  </BasePage>
</template>
