<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { FilterChip } from '~/components/FilterChips.vue'
import type { BotInstance } from '~~/types/bots'
import { formatTimeAgo } from '@vueuse/core'

// Bot Instances (roadmap §57.4 H, §58.9 Slice 2). Concrete running/completed
// sessions. Bot Instance != Bot Profile — one profile, many sessions.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.bots.instancesTitle',
  descKey: 'strategyLab.bots.instancesDesc'
})
const { viewMode } = useAdminGridView('bot-instances-view-mode')
const botsApi = useBots()

const instances = ref<BotInstance[]>([])
const isLoading = ref(false)
const stateFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    instances.value = await botsApi.instances({ limit: 200 })
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

function openDetail(item: BotInstance) {
  navigateTo(`/strategy-lab/bots/instances/${encodeURIComponent(item._id)}`)
}

const stateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'queued' || s === 'starting' ? 'info'
      : s === 'paused' || s === 'stopping' ? 'warning'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'
const stateLabel = (s: string) => t(`strategyLab.bots.stateLabels.${s}`)

const stateCounts = computed(() => {
  const c: Record<string, number> = {}
  for (const it of instances.value) c[it.state] = (c[it.state] ?? 0) + 1
  return c
})

const filtered = computed(() =>
  stateFilter.value ? instances.value.filter(i => i.state === stateFilter.value) : instances.value
)

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('strategyLab.bots.instanceMetrics.total'), value: String(instances.value.length), tone: 'primary' },
  { key: 'running', label: t('strategyLab.bots.stateLabels.running'), value: String(stateCounts.value.running ?? 0), tone: 'success' },
  { key: 'completed', label: t('strategyLab.bots.stateLabels.completed'), value: String(stateCounts.value.completed ?? 0) },
  {
    key: 'failed',
    label: t('strategyLab.bots.stateLabels.failed'),
    value: String((stateCounts.value.failed ?? 0) + (stateCounts.value.halted ?? 0)),
    tone: 'error'
  }
])

const stateChips = computed<FilterChip[]>(() => [
  { value: '', label: t('common.all'), count: instances.value.length },
  { value: 'running', label: t('strategyLab.bots.stateLabels.running'), count: stateCounts.value.running ?? 0 },
  { value: 'paused', label: t('strategyLab.bots.stateLabels.paused'), count: stateCounts.value.paused ?? 0 },
  { value: 'queued', label: t('strategyLab.bots.stateLabels.queued'), count: stateCounts.value.queued ?? 0 },
  { value: 'completed', label: t('strategyLab.bots.stateLabels.completed'), count: stateCounts.value.completed ?? 0 },
  { value: 'failed', label: t('strategyLab.bots.stateLabels.failed'), count: stateCounts.value.failed ?? 0 }
])

const trail = computed(() => [
  { label: t('nav.strategy_lab') },
  { label: t('nav.bot_instances') }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'instanceId', label: t('strategyLab.bots.instance'), class: 'w-48' },
  { key: 'botProfileId', label: t('strategyLab.bots.profile'), class: 'w-44' },
  { key: 'state', label: t('strategyLab.bots.state'), class: 'w-28' },
  { key: 'startedAt', label: t('strategyLab.bots.started'), class: 'w-32' },
  { key: 'counts', label: t('strategyLab.bots.trades'), class: 'w-40' },
  { key: 'lastEventAt', label: t('strategyLab.bots.lastEvent'), class: 'w-32' },
  { key: 'health', label: t('strategyLab.bots.health'), class: 'w-24' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="bot_instances" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('strategyLab.pips.botInstances')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-bot"
          :label="t('nav.bot_profiles')"
          variant="soft"
          color="primary"
          size="sm"
          to="/strategy-lab/bots"
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
      <div class="px-4 sm:px-6 py-2">
        <FilterChips v-model="stateFilter" :items="stateChips" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />

      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="filtered"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="viewMode"
          item-key="_id"
          storage-key="bot-instances-view-mode"
          @refresh="refresh"
          @click="openDetail"
        >
          <template #instanceId="{ item }">
            <span class="text-[11px] font-mono text-highlighted truncate">{{ item.instanceId }}</span>
          </template>

          <template #botProfileId="{ item }">
            <span class="text-[11px] font-mono text-muted truncate">{{ item.botProfileId || '—' }}</span>
          </template>

          <template #state="{ item }">
            <UBadge :label="stateLabel(item.state)" :color="stateColor(item.state)" variant="subtle" size="xs" />
          </template>

          <template #startedAt="{ item }">
            <time v-if="item.startedAt" :datetime="new Date(item.startedAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.startedAt)) }}
            </time>
            <span v-else class="text-[11px] text-dimmed">—</span>
          </template>

          <template #counts="{ item }">
            <span class="text-[11px] text-muted">
              {{ item.counts?.signals ?? 0 }} / {{ item.counts?.orders ?? 0 }} / {{ item.counts?.trades ?? 0 }}
            </span>
          </template>

          <template #lastEventAt="{ item }">
            <time v-if="item.lastEventAt" :datetime="new Date(item.lastEventAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.lastEventAt)) }}
            </time>
            <span v-else class="text-[11px] text-dimmed">—</span>
          </template>

          <template #health="{ item }">
            <span class="text-[11px] text-muted">{{ item.health }}</span>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted font-mono truncate">{{ item.instanceId }}</span>
                  <UBadge :label="stateLabel(item.state)" :color="stateColor(item.state)" variant="subtle" size="xs" class="shrink-0" />
                </div>
                <div class="text-[11px] text-dimmed mt-0.5 truncate">
                  {{ item.botProfileId || '—' }} · {{ item.mode }}
                </div>
              </div>
              <time v-if="item.startedAt" :datetime="new Date(item.startedAt).toISOString()" class="text-[10px] text-muted shrink-0">
                {{ formatTimeAgo(new Date(item.startedAt)) }}
              </time>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('strategyLab.bots.instancesEmpty')"
              :description="t('strategyLab.bots.instancesEmptyHint')"
              icon="i-lucide-cpu"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
