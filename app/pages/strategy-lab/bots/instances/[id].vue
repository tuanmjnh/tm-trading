<script setup lang="ts">
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { BotInstance } from '#shared/types/bots'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// Bot Instance detail (roadmap §57.4 H / §58.9 Slice 2). One concrete session:
// lifecycle state, event lag, signal/order/trade counts and the read-only
// paper equity/PnL snapshot. Bot Instance != Bot Profile — one profile, many.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const botsApi = useBots()

const instanceId = computed(() => String(route.params.id ?? ''))
const instance = ref<BotInstance | null>(null)
const isLoading = ref(true)

async function load() {
  isLoading.value = true
  try {
    instance.value = await botsApi.instance(instanceId.value)
  } catch (err) {
    notify.error(t('strategyLab.bots.instanceDetail.title'), getErrorMessage(err, key => t(key)))
    instance.value = null
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const title = computed(() => instance.value?.instanceId || t('strategyLab.bots.instanceDetail.title'))
// Subtitle must not repeat the id (F12). Show the state (+ profile when known);
// fall back to the static section blurb while loading or when the record is gone.
const description = computed(() => {
  const i = instance.value
  if (!i) return t('strategyLab.bots.instanceDetail.description')
  const bits = [stateLabel(i.state)]
  if (i.botProfileId) bits.push(i.botProfileId)
  return bits.join(' · ')
})

const trail = computed(() => [
  { label: t('nav.strategy_lab'), to: '/strategy-lab' },
  { label: t('nav.bot_profiles'), to: '/strategy-lab/bots' },
  { label: title.value }
])

const stateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'queued' || s === 'starting' ? 'info'
      : s === 'paused' || s === 'stopping' ? 'warning'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'
const stateLabel = (s: string) => t(`strategyLab.bots.stateLabels.${s}`)

const profile = computed(() => instance.value?.botProfileId ?? null)
const profileLink = computed(() =>
  profile.value ? `/strategy-lab/bots/${encodeURIComponent(profile.value)}` : null
)

const strategyLink = computed(() => {
  const v = instance.value?.strategyVersionId
  if (!v) return null
  const strategyId = v.split('@')[0]
  return strategyId ? `/strategy-lab/${encodeURIComponent(strategyId)}` : null
})

function kv(record: Record<string, unknown> | null | undefined) {
  const r = record ?? {}
  return Object.entries(r).map(([k, v]) => ({
    key: k,
    value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
  }))
}
const sourceEntries = computed(() => kv(instance.value?.source))
const riskEntries = computed(() => kv(instance.value?.riskState))

const fmtNum = (n: number | null) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const metrics = computed<MetricItem[]>(() => {
  const i = instance.value
  if (!i) return []
  return [
    { key: 'state', label: t('strategyLab.bots.state'), value: stateLabel(i.state), tone: i.state === 'running' ? 'success' : i.state === 'failed' ? 'error' : 'primary' },
    { key: 'signals', label: t('strategyLab.bots.signals'), value: String(i.counts?.signals ?? 0) },
    { key: 'orders', label: t('strategyLab.bots.orders'), value: String(i.counts?.orders ?? 0) },
    { key: 'trades', label: t('strategyLab.bots.trades'), value: String(i.counts?.trades ?? 0) },
    { key: 'paperPnl', label: t('strategyLab.bots.instanceDetail.paperPnl'), value: fmtNum(i.paperPnl), tone: i.paperPnl === null ? 'default' : i.paperPnl >= 0 ? 'success' : 'error' }
  ]
})

function absTime(ms: number | null) {
  return ms ? `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—'
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="bot-instance-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('strategyLab.pips.botInstanceDetail')" />
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
        v-if="!isLoading && !instance"
        :title="t('strategyLab.bots.instanceDetail.notFound')"
        :description="t('strategyLab.bots.instanceDetail.notFoundHint')"
        icon="i-lucide-cpu"
      />

      <template v-else>
        <SharedMetricRibbon :items="metrics" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Session contract -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-cpu" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.instance') }}</h3>
                <UBadge v-if="instance" :label="stateLabel(instance.state)" :color="'info'" variant="subtle" size="xs" />
              </div>
            </template>

            <dl v-if="instance" class="grid grid-cols-1 gap-y-3 text-xs">
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.bots.profile') }}</dt>
                <dd class="min-w-0 text-right">
                  <NuxtLink v-if="profileLink && profile" :to="profileLink" class="font-mono text-primary truncate hover:underline">
                    {{ profile }}
                  </NuxtLink>
                  <span v-else class="font-mono text-dimmed">{{ profile || '—' }}</span>
                </dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.bots.strategyVersion') }}</dt>
                <dd class="min-w-0 text-right">
                  <NuxtLink v-if="strategyLink && instance.strategyVersionId" :to="strategyLink" class="font-mono text-primary truncate hover:underline">
                    {{ instance.strategyVersionId }}
                  </NuxtLink>
                  <span v-else class="font-mono text-dimmed">{{ instance.strategyVersionId || '—' }}</span>
                </dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.bots.instanceDetail.fingerprint') }}</dt>
                <dd class="font-mono truncate" :class="instance.strategyFingerprint ? 'text-highlighted' : 'text-dimmed'">
                  {{ instance.strategyFingerprint || '—' }}
                </dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.bots.mode') }}</dt>
                <dd><UBadge :label="instance.mode" color="neutral" variant="subtle" size="xs" /></dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.instruments') }}</dt>
                <dd class="text-right truncate text-muted">{{ instance.instruments.length ? instance.instruments.join(', ') : '—' }}</dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.strategies.timeframes') }}</dt>
                <dd class="text-right text-muted">{{ instance.timeframes.length ? instance.timeframes.join(', ') : '—' }}</dd>
              </div>
              <div class="flex items-start justify-between gap-3">
                <dt class="text-muted shrink-0">{{ t('strategyLab.bots.health') }}</dt>
                <dd class="text-muted">{{ instance.health }}</dd>
              </div>
            </dl>
          </UCard>

        <!-- Lifecycle -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-activity" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.instanceDetail.lifecycle') }}</h3>
            </div>
          </template>
          <dl v-if="instance" class="grid grid-cols-1 gap-y-3 text-xs">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.started') }}</dt>
              <dd class="text-muted">{{ absTime(instance.startedAt) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.instanceDetail.stopped') }}</dt>
              <dd class="text-muted">{{ absTime(instance.stoppedAt) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.lastEvent') }}</dt>
              <dd class="text-muted">
                <time v-if="instance.lastEventAt" :datetime="new Date(instance.lastEventAt).toISOString()">{{ formatTimeAgo(new Date(instance.lastEventAt)) }}</time>
                <span v-else>—</span>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.instanceDetail.eventLag') }}</dt>
              <dd class="text-muted">{{ instance.eventLagMs === null ? '—' : `${instance.eventLagMs} ms` }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.instanceDetail.initialCapital') }}</dt>
              <dd class="text-muted font-mono">{{ fmtNum(instance.initialCapital ?? 10000) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.instanceDetail.paperEquity') }}</dt>
              <dd class="text-muted">{{ fmtNum(instance.paperEquity) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.bots.instanceDetail.paperPnl') }}</dt>
              <dd :class="instance.paperPnl === null ? 'text-dimmed' : instance.paperPnl >= 0 ? 'text-success' : 'text-error'">
                {{ fmtNum(instance.paperPnl) }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('strategyLab.bots.instanceDetail.lastError') }}</dt>
              <dd class="text-right min-w-0 truncate" :class="instance.lastError ? 'text-error' : 'text-dimmed'" :title="instance.lastError || ''">
                {{ instance.lastError || t('strategyLab.bots.instanceDetail.noError') }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('strategyLab.strategyDetail.updated') }}</dt>
              <dd class="text-muted">
                <time :datetime="new Date(instance.updatedAt).toISOString()">{{ formatTimeAgo(new Date(instance.updatedAt)) }}</time>
              </dd>
            </div>
          </dl>
        </UCard>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UCard v-if="sourceEntries.length">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-tag" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.instanceDetail.source') }}</h3>
              </div>
            </template>
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div v-for="s in sourceEntries" :key="s.key" class="flex flex-col min-w-0">
                <dt class="text-dimmed font-mono truncate">{{ s.key }}</dt>
                <dd class="text-highlighted truncate" :title="s.value">{{ s.value }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard v-if="riskEntries.length">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-shield" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('strategyLab.bots.instanceDetail.riskState') }}</h3>
              </div>
            </template>
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div v-for="r in riskEntries" :key="r.key" class="flex flex-col min-w-0">
                <dt class="text-dimmed font-mono truncate">{{ r.key }}</dt>
                <dd class="text-highlighted truncate" :title="r.value">{{ r.value }}</dd>
              </div>
            </dl>
          </UCard>
        </div>
      </template>
    </div>
  </BasePage>
</template>
