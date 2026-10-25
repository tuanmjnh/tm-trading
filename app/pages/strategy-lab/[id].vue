<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { StrategyProfile, StrategyVersion } from '#shared/types/strategy'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// Strategy detail (roadmap §57.4 E / §58.9 Slice 2). Read-only profile plus the
// immutable version history it can pin to. Reads existing /api/v1/strategies.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const strategies = useStrategies()
const { viewMode } = useAdminGridView('strategy-detail-view-mode')

const profileId = computed(() => String(route.params.id ?? ''))
const profile = ref<StrategyProfile | null>(null)
const versions = ref<StrategyVersion[]>([])
const isLoading = ref(true)

async function load() {
  isLoading.value = true
  try {
    const [p, v] = await Promise.all([
      strategies.detail(profileId.value),
      strategies.versions(profileId.value)
    ])
    profile.value = p
    versions.value = v
  } catch (err) {
    notify.error(t('strategyLab.strategyDetail.title'), getErrorMessage(err, key => t(key)))
    profile.value = null
    versions.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const title = computed(
  () => profile.value?.name || profile.value?.profileId || t('strategyLab.strategyDetail.title')
)

const description = computed(() => profile.value?.profileId || t('strategyLab.strategies.desc'))

const trail = computed(() => [
  { label: t('nav.strategy_lab'), to: '/strategy-lab' },
  { label: title.value }
])

const activeVersion = computed(() => profile.value?.strategyVersionId || null)

const statusColor = (s: string) =>
  s === 'active' ? 'success' : s === 'paused' ? 'warning' : s === 'retired' ? 'error' : 'neutral'
const profileStatusLabel = (s: string) => t(`strategyLab.strategies.statusLabels.${s}`)

const versionStateColor = (s: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' =>
  s === 'stable_paper' ? 'success'
    : s === 'paper' ? 'primary'
      : s === 'holdout' ? 'warning'
        : 'neutral'
const versionStateLabel = (s: string) => t(`strategyLab.strategyDetail.versionStates.${s}`)

// Ribbon — derived only from the profile + versions already loaded (never faked).
const paperReady = computed(() => versions.value.filter(v => v.status === 'paper' || v.status === 'stable_paper').length)
const accepted = computed(() => versions.value.filter(v => !!v.acceptedExperimentId).length)

const metrics = computed<MetricItem[]>(() => [
  { key: 'versions', label: t('strategyLab.strategyDetail.metrics.versions'), value: String(versions.value.length), tone: 'primary' },
  {
    key: 'active',
    label: t('strategyLab.strategyDetail.metrics.active'),
    value: activeVersion.value ? '1' : '0',
    hint: activeVersion.value || t('strategyLab.strategyDetail.none'),
    tone: activeVersion.value ? 'success' : 'default'
  },
  {
    key: 'paperReady',
    label: t('strategyLab.strategyDetail.metrics.paperReady'),
    value: String(paperReady.value),
    tone: paperReady.value ? 'success' : 'default'
  },
  {
    key: 'accepted',
    label: t('strategyLab.strategyDetail.metrics.accepted'),
    value: String(accepted.value),
    tone: accepted.value ? 'success' : 'default'
  }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'version', label: t('strategyLab.strategyDetail.columns.version'), class: 'w-32' },
  { key: 'state', label: t('strategyLab.strategyDetail.columns.state'), class: 'w-28' },
  { key: 'paramsHash', label: t('strategyLab.strategyDetail.columns.paramsHash'), class: 'w-40' },
  { key: 'engine', label: t('strategyLab.strategyDetail.columns.engine'), class: 'w-24' },
  { key: 'backtest', label: t('strategyLab.strategyDetail.columns.backtest'), class: 'w-40' },
  { key: 'holdout', label: t('strategyLab.strategyDetail.columns.holdout'), class: 'w-40' },
  { key: 'paperTrades', label: t('strategyLab.strategyDetail.columns.paperTrades'), class: 'w-24' },
  { key: 'created', label: t('strategyLab.strategyDetail.columns.created'), class: 'w-32' }
])

const fmtNum = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : '—')

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(t('common.copied'))
  } catch {
    notify.error(t('common.error'))
  }
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="strategy-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('strategyLab.pips.strategyDetail')" />
    </template>

    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        color="neutral"
        size="sm"
        :loading="isLoading"
        @click="load"
      />
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <AdminEmptyState
        v-if="!isLoading && !profile"
        :title="t('strategyLab.strategyDetail.notFound')"
        :description="t('strategyLab.strategyDetail.notFoundHint')"
        icon="i-lucide-library"
      />

      <template v-else>
        <SharedMetricRibbon :items="metrics" />

        <!-- Profile overview -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-layer-group" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.strategyDetail.profile') }}</h3>
                <UBadge
                  v-if="profile"
                  :label="profileStatusLabel(profile.status)"
                  :color="statusColor(profile.status)"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <div v-if="profile" class="flex items-center gap-1.5 min-w-0">
                <span class="text-[11px] text-dimmed font-mono truncate">{{ profile.profileId }}</span>
                <UButton icon="i-lucide-copy" variant="ghost" color="neutral" size="xs" @click="copyText(profile.profileId)" />
              </div>
            </div>
          </template>

          <dl v-if="profile" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.activeVersion') }}</dt>
              <dd class="font-mono truncate" :class="profile.strategyVersionId ? 'text-highlighted' : 'text-dimmed'">
                {{ profile.strategyVersionId || t('strategyLab.strategyDetail.none') }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.riskProfile') }}</dt>
              <dd class="font-mono truncate" :class="profile.riskProfileId ? 'text-highlighted' : 'text-dimmed'">
                {{ profile.riskProfileId || t('strategyLab.strategyDetail.none') }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.instruments') }}</dt>
              <dd class="text-right truncate text-muted">
                {{ profile.instruments.length ? profile.instruments.join(', ') : '—' }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.timeframes') }}</dt>
              <dd class="text-right text-muted">
                {{ profile.timeframes.length ? profile.timeframes.join(', ') : '—' }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.created') }}</dt>
              <dd class="text-muted">
                <time v-if="profile.createdAt" :datetime="new Date(profile.createdAt).toISOString()">
                  {{ new Date(profile.createdAt).toISOString().replace('T', ' ').slice(0, 19) }} UTC
                </time>
                <span v-else>—</span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.updated') }}</dt>
              <dd class="text-muted">
                <time :datetime="new Date(profile.updatedAt).toISOString()">
                  {{ formatTimeAgo(new Date(profile.updatedAt)) }}
                </time>
              </dd>
            </div>
          </dl>
        </UCard>

        <!-- Version history -->
        <UCard :ui="{ body: 'p-3 sm:p-3 pr-0 sm:pr-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-history" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.strategyDetail.versions') }}</h3>
                <UBadge :label="String(versions.length)" variant="subtle" size="xs" />
              </div>
              <AdminViewModeToggle v-model="viewMode" />
            </div>
          </template>

          <div class="relative h-110">
            <LazyGridList
              :items="versions"
              :columns="columns"
              :loading="isLoading"
              :can-load-more="false"
              v-model:view-mode="viewMode"
              item-key="_id"
              storage-key="strategy-detail-view-mode"
              @refresh="load"
            >
              <template #version="{ item }">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="font-semibold text-xs text-highlighted font-mono">v{{ item.version }}</span>
                  <UBadge
                    v-if="item._id === activeVersion"
                    :label="t('strategyLab.strategyDetail.activeTag')"
                    color="success"
                    variant="subtle"
                    size="xs"
                  />
                </div>
              </template>

              <template #state="{ item }">
                <UBadge :label="versionStateLabel(item.status)" :color="versionStateColor(item.status)" variant="subtle" size="xs" />
              </template>

              <template #paramsHash="{ item }">
                <code
                  class="text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono"
                  :title="item.paramsHash"
                >{{ item.paramsHash ? item.paramsHash.slice(0, 8) : '—' }}</code>
              </template>

              <template #engine="{ item }">
                <span class="text-[11px] text-muted font-mono">{{ item.engineVersion || '—' }}</span>
              </template>

              <template #backtest="{ item }">
                <NuxtLink
                  v-if="item.backtestRunId"
                  :to="`/test-center/runs/${encodeURIComponent(item.backtestRunId)}`"
                  class="text-[11px] text-primary font-mono truncate hover:underline"
                >{{ item.backtestRunId }}</NuxtLink>
                <span v-else class="text-[11px] text-dimmed">—</span>
              </template>

              <template #holdout="{ item }">
                <NuxtLink
                  v-if="item.holdoutRunId"
                  :to="`/test-center/runs/${encodeURIComponent(item.holdoutRunId)}`"
                  class="text-[11px] text-primary font-mono truncate hover:underline"
                >{{ item.holdoutRunId }}</NuxtLink>
                <span v-else class="text-[11px] text-dimmed">—</span>
              </template>

              <template #paperTrades="{ item }">
                <span class="text-xs text-muted font-mono">{{ fmtNum(item.paperTrades) }}</span>
              </template>

              <template #created="{ item }">
                <time v-if="item.createdAt" :datetime="new Date(item.createdAt).toISOString()" class="text-[11px] text-muted">
                  {{ formatTimeAgo(new Date(item.createdAt)) }}
                </time>
                <span v-else class="text-[11px] text-dimmed">—</span>
              </template>

              <template #mobile-content="{ item }">
                <div class="flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 text-xs">
                      <span class="font-semibold text-highlighted font-mono">v{{ item.version }}</span>
                      <UBadge :label="versionStateLabel(item.status)" :color="versionStateColor(item.status)" variant="subtle" size="xs" />
                      <UBadge
                        v-if="item._id === activeVersion"
                        :label="t('strategyLab.strategyDetail.activeTag')"
                        color="success"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                    <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                      {{ item.paramsHash ? item.paramsHash.slice(0, 12) : '—' }}
                    </div>
                  </div>
                  <time v-if="item.createdAt" :datetime="new Date(item.createdAt).toISOString()" class="text-[10px] text-muted shrink-0">
                    {{ formatTimeAgo(new Date(item.createdAt)) }}
                  </time>
                </div>
              </template>

              <template #empty>
                <AdminEmptyState
                  :title="t('strategyLab.strategyDetail.versionsEmpty')"
                  :description="t('strategyLab.strategyDetail.versionsEmptyHint')"
                  icon="i-lucide-history"
                />
              </template>
            </LazyGridList>
          </div>
        </UCard>
      </template>
    </div>
  </BasePage>
</template>
