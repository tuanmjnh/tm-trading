<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { FilterChip } from '~/components/FilterChips.vue'
import type { BotProfile } from '~~/types/bots'
import { formatTimeAgo } from '@vueuse/core'

// Bot Profiles (roadmap §57.4 G, §58.9 Slice 2). Reusable execution profiles
// pointing at an immutable strategy version. Bot Profile != Bot Instance.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.bots.profilesTitle',
  descKey: 'strategyLab.bots.profilesDesc'
})
const { viewMode } = useAdminGridView('bot-profiles-view-mode')
const botsApi = useBots()

const profiles = ref<BotProfile[]>([])
const isLoading = ref(false)
const statusFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    profiles.value = await botsApi.profiles({ limit: 200 })
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

const statusColor = (s: string) =>
  s === 'enabled' ? 'success' : s === 'disabled' ? 'neutral' : s === 'archived' ? 'error' : 'warning'
const statusLabel = (s: string) => t(`strategyLab.bots.statusLabels.${s}`)

const counts = computed(() => {
  const c = { total: profiles.value.length, enabled: 0, disabled: 0, archived: 0, draft: 0 }
  for (const p of profiles.value) {
    if (p.status === 'enabled') c.enabled++
    else if (p.status === 'disabled') c.disabled++
    else if (p.status === 'archived') c.archived++
    else if (p.status === 'draft') c.draft++
  }
  return c
})

const filtered = computed(() =>
  statusFilter.value ? profiles.value.filter(p => p.status === statusFilter.value) : profiles.value
)

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('strategyLab.bots.metrics.total'), value: String(counts.value.total), tone: 'primary' },
  { key: 'enabled', label: t('strategyLab.bots.statusLabels.enabled'), value: String(counts.value.enabled), tone: 'success' },
  { key: 'disabled', label: t('strategyLab.bots.statusLabels.disabled'), value: String(counts.value.disabled) },
  { key: 'archived', label: t('strategyLab.bots.statusLabels.archived'), value: String(counts.value.archived), tone: 'error' }
])

const statusChips = computed<FilterChip[]>(() => [
  { value: '', label: t('common.all'), count: counts.value.total },
  { value: 'enabled', label: t('strategyLab.bots.statusLabels.enabled'), count: counts.value.enabled },
  { value: 'disabled', label: t('strategyLab.bots.statusLabels.disabled'), count: counts.value.disabled },
  { value: 'archived', label: t('strategyLab.bots.statusLabels.archived'), count: counts.value.archived },
  { value: 'draft', label: t('strategyLab.bots.statusLabels.draft'), count: counts.value.draft }
])

const trail = computed(() => [
  { label: t('nav.strategy_lab') },
  { label: t('nav.bot_profiles') }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('strategyLab.bots.name'), class: 'w-56' },
  { key: 'mode', label: t('strategyLab.bots.mode'), class: 'w-32' },
  { key: 'strategyVersionId', label: t('strategyLab.bots.strategyVersion'), class: 'w-44' },
  { key: 'instruments', label: t('strategyLab.strategies.instruments'), class: 'w-44' },
  { key: 'status', label: t('strategyLab.bots.status'), class: 'w-28' },
  { key: 'updatedAt', label: t('strategyLab.strategies.updated'), class: 'w-32' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="bot_profiles" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('strategyLab.pips.botProfiles')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-cpu"
          :label="t('nav.bot_instances')"
          variant="soft"
          color="primary"
          size="sm"
          to="/strategy-lab/bots/instances"
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
          storage-key="bot-profiles-view-mode"
          @refresh="refresh"
        >
          <template #name="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.name || item.profileId }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.profileId }}</span>
            </div>
          </template>

          <template #mode="{ item }">
            <UBadge :label="item.mode" color="neutral" variant="subtle" size="xs" />
          </template>

          <template #strategyVersionId="{ item }">
            <span class="text-[11px] font-mono text-muted truncate">{{ item.strategyVersionId || '—' }}</span>
          </template>

          <template #instruments="{ item }">
            <span class="text-[11px] text-muted truncate">{{ item.instruments.length ? item.instruments.join(', ') : '—' }}</span>
          </template>

          <template #status="{ item }">
            <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
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
                <div class="text-[11px] text-dimmed mt-0.5">{{ item.mode }} · {{ item.strategyVersionId || '—' }}</div>
              </div>
              <time :datetime="new Date(item.updatedAt).toISOString()" class="text-[10px] text-muted shrink-0">
                {{ formatTimeAgo(new Date(item.updatedAt)) }}
              </time>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('strategyLab.bots.profilesEmpty')"
              :description="t('strategyLab.bots.profilesEmptyHint')"
              icon="i-lucide-bot"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
