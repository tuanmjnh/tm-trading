<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { BotInstance, BotProfile } from '#shared/types/bots'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// Bot Profile detail (roadmap §57.4 G / §58.9 Slice 2). The reusable execution
// contract: which immutable strategy version it points at, its mode and risk
// limits, plus the sessions it has produced. Bot Profile != Bot Instance.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const botsApi = useBots()
const { viewMode } = useAdminGridView('bot-profile-detail-view-mode')

const profileId = computed(() => String(route.params.id ?? ''))
const profile = ref<BotProfile | null>(null)
const instances = ref<BotInstance[]>([])
const isLoading = ref(true)

async function load() {
  isLoading.value = true
  try {
    const [p, i] = await Promise.all([
      botsApi.profile(profileId.value),
      botsApi.instances({ botProfileId: profileId.value, limit: 50 })
    ])
    profile.value = p
    instances.value = i
  } catch (err) {
    notify.error(t('strategyLab.bots.profileDetail.title'), getErrorMessage(err, key => t(key)))
    profile.value = null
    instances.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

function openInstance(item: BotInstance) {
  navigateTo(`/strategy-lab/bots/instances/${encodeURIComponent(item._id)}`)
}

const title = computed(() => profile.value?.name || profile.value?.profileId || t('strategyLab.bots.profileDetail.title'))
const description = computed(() => profile.value?.profileId || t('strategyLab.bots.profilesDesc'))

const trail = computed(() => [
  { label: t('nav.strategy_lab'), to: '/strategy-lab' },
  { label: t('nav.bot_profiles'), to: '/strategy-lab/bots' },
  { label: title.value }
])

const statusColor = (s: string) =>
  s === 'enabled' ? 'success' : s === 'disabled' ? 'neutral' : s === 'archived' ? 'error' : 'warning'
const statusLabel = (s: string) => t(`strategyLab.bots.statusLabels.${s}`)
const stateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'queued' || s === 'starting' ? 'info'
      : s === 'paused' || s === 'stopping' ? 'warning'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'
const stateLabel = (s: string) => t(`strategyLab.bots.stateLabels.${s}`)

// The pinned version id is `strategyId@semver`; the strategy detail route is
// keyed by the strategy id, so derive it for a deep link.
const strategyLink = computed(() => {
  const v = profile.value?.strategyVersionId
  if (!v) return null
  const strategyId = v.split('@')[0]
  return strategyId ? `/strategy-lab/${encodeURIComponent(strategyId)}` : null
})

const metrics = computed<MetricItem[]>(() => {
  const p = profile.value
  if (!p) return []
  return [
    { key: 'status', label: t('strategyLab.bots.status'), value: statusLabel(p.status), tone: p.status === 'enabled' ? 'success' : 'default' },
    { key: 'mode', label: t('strategyLab.bots.mode'), value: p.mode, tone: 'primary' },
    { key: 'instances', label: t('strategyLab.bots.profileDetail.instances'), value: String(instances.value.length) },
    { key: 'maxPos', label: t('strategyLab.bots.profileDetail.maxPositions'), value: String(p.maxConcurrentPositions) },
    { key: 'enabled', label: t('strategyLab.bots.profileDetail.enabled'), value: p.enabled ? t('strategyLab.bots.profileDetail.yes') : t('strategyLab.bots.profileDetail.no'), tone: p.enabled ? 'success' : 'default' }
  ]
})

const columns = computed<GridColumn[]>(() => [
  { key: 'instanceId', label: t('strategyLab.bots.instance'), class: 'w-48' },
  { key: 'state', label: t('strategyLab.bots.state'), class: 'w-28' },
  { key: 'startedAt', label: t('strategyLab.bots.started'), class: 'w-32' },
  { key: 'counts', label: t('strategyLab.bots.trades'), class: 'w-40' },
  { key: 'lastEventAt', label: t('strategyLab.bots.lastEvent'), class: 'w-32' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="bot-profile-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('strategyLab.pips.botProfileDetail')" />
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
        :title="t('strategyLab.bots.profileDetail.notFound')"
        :description="t('strategyLab.bots.profileDetail.notFoundHint')"
        icon="i-lucide-bot"
      />

      <template v-else>
        <SharedMetricRibbon :items="metrics" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-bot" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.profile') }}</h3>
                <UBadge v-if="profile" :label="statusLabel(profile.status)" :color="statusColor(profile.status)" variant="subtle" size="xs" />
                <UBadge v-if="profile" :label="profile.mode" color="neutral" variant="subtle" size="xs" />
              </div>
              <span v-if="profile" class="text-[11px] text-dimmed font-mono truncate">{{ profile.profileId }}</span>
            </div>
          </template>

          <p v-if="profile?.description" class="text-xs text-muted mb-3">{{ profile.description }}</p>

          <dl v-if="profile" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.strategyVersion') }}</dt>
              <dd class="min-w-0 text-right">
                <NuxtLink
                  v-if="strategyLink && profile.strategyVersionId"
                  :to="strategyLink"
                  class="font-mono text-primary truncate hover:underline"
                >{{ profile.strategyVersionId }}</NuxtLink>
                <span v-else class="font-mono" :class="profile.strategyVersionId ? 'text-highlighted' : 'text-dimmed'">
                  {{ profile.strategyVersionId || t('strategyLab.strategyDetail.none') }}
                </span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profileDetail.paramsHash') }}</dt>
              <dd class="font-mono truncate" :class="profile.effectiveParamsHash ? 'text-highlighted' : 'text-dimmed'">
                {{ profile.effectiveParamsHash || t('strategyLab.strategyDetail.none') }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.instruments') }}</dt>
              <dd class="text-right truncate text-muted">{{ profile.instruments.length ? profile.instruments.join(', ') : '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.timeframes') }}</dt>
              <dd class="text-right text-muted">{{ profile.timeframes.length ? profile.timeframes.join(', ') : '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profileDetail.riskProfile') }}</dt>
              <dd class="font-mono truncate" :class="profile.riskProfileId ? 'text-highlighted' : 'text-dimmed'">
                {{ profile.riskProfileId || t('strategyLab.strategyDetail.none') }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profileDetail.account') }}</dt>
              <dd class="font-mono truncate" :class="profile.simulatedAccountId ? 'text-highlighted' : 'text-dimmed'">
                {{ profile.simulatedAccountId || t('strategyLab.strategyDetail.none') }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profileDetail.maxPositions') }}</dt>
              <dd class="text-muted">{{ profile.maxConcurrentPositions }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profileDetail.createdBy') }}</dt>
              <dd class="text-muted truncate">{{ profile.createdBy || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.created') }}</dt>
              <dd class="text-muted">
                <time v-if="profile.createdAt" :datetime="new Date(profile.createdAt).toISOString()">
                  {{ new Date(profile.createdAt).toISOString().slice(0, 16).replace('T', ' ') }} UTC
                </time>
                <span v-else>—</span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.strategyDetail.updated') }}</dt>
              <dd class="text-muted">
                <time :datetime="new Date(profile.updatedAt).toISOString()">{{ formatTimeAgo(new Date(profile.updatedAt)) }}</time>
              </dd>
            </div>
          </dl>
        </UCard>

        <!-- Sessions produced by this profile -->
        <UCard :ui="{ body: 'p-3 sm:p-3 pr-0 sm:pr-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-cpu" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.profileDetail.instances') }}</h3>
                <UBadge :label="String(instances.length)" variant="subtle" size="xs" />
              </div>
              <AdminViewModeToggle v-model="viewMode" />
            </div>
          </template>

          <div class="relative h-96">
            <LazyGridList
              :items="instances"
              :columns="columns"
              :loading="isLoading"
              :can-load-more="false"
              v-model:view-mode="viewMode"
              item-key="_id"
              storage-key="bot-profile-detail-view-mode"
              @refresh="load"
              @click="openInstance"
            >
              <template #instanceId="{ item }">
                <span class="text-[11px] font-mono text-highlighted truncate">{{ item.instanceId }}</span>
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
                <span class="text-[11px] text-muted">{{ item.counts?.signals ?? 0 }} / {{ item.counts?.orders ?? 0 }} / {{ item.counts?.trades ?? 0 }}</span>
              </template>
              <template #lastEventAt="{ item }">
                <time v-if="item.lastEventAt" :datetime="new Date(item.lastEventAt).toISOString()" class="text-[11px] text-muted">
                  {{ formatTimeAgo(new Date(item.lastEventAt)) }}
                </time>
                <span v-else class="text-[11px] text-dimmed">—</span>
              </template>
              <template #empty>
                <AdminEmptyState :title="t('strategyLab.bots.profileDetail.noInstances')" icon="i-lucide-cpu" />
              </template>
            </LazyGridList>
          </div>
        </UCard>
      </template>
    </div>
  </BasePage>
</template>
