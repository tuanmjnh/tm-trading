<script setup lang="ts">
// System Health strip (V5.0 §3.7) — concise. Detailed logs live in the Control
// Center. A PID is never shown as "ready": readiness comes from the supervisor's
// functional probes (services/readiness.mjs), not from process existence.
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { services, serviceSummary, health, loading, failed } = useDashboardFeed()
const overlay = useAppOverlay()

/** The worker groups the Dashboard summarises (registry ids from services/registry.mjs). */
const GROUPS = [
  { id: 'market-plane', key: 'market' },
  { id: 'scanner', key: 'scanner' },
  { id: 'news', key: 'news' },
  { id: 'ai-agent', key: 'ai' },
  { id: 'outbox-drain', key: 'notification' }
] as const

const byId = computed(() => new Map(services.value.map(s => [s.serviceId, s])))

const rows = computed(() => GROUPS.map(group => ({
  ...group,
  state: byId.value.get(group.id)?.observed ?? 'UNKNOWN',
  health: byId.value.get(group.id)?.health ?? 'UNKNOWN',
  heartbeat: byId.value.get(group.id)?.lastHeartbeatAt ?? null,
  lastSuccess: byId.value.get(group.id)?.lastSuccessAt ?? null
})))

const color = (state: string) =>
  state === 'READY' ? 'success' : state === 'DEGRADED' ? 'warning' : state === 'FAILED' ? 'error' : state === 'STARTING' || state === 'STOPPING' ? 'info' : 'neutral'

const overall = computed(() => {
  if (failed.services && failed.health) return { label: t('common.unknown'), color: 'neutral' as const }
  if (health.value?.status === 'degraded') return { label: t('dash.health.degraded'), color: 'warning' as const }
  const summary = serviceSummary.value
  if (summary && summary.failed > 0) return { label: t('dash.health.degraded'), color: 'error' as const }
  if (summary && summary.degraded > 0) return { label: t('dash.health.degraded'), color: 'warning' as const }
  return { label: t('dash.health.ok'), color: 'success' as const }
})

const lastSuccess = computed(() => {
  const times = rows.value.map(r => r.lastSuccess).filter((v): v is number => typeof v === 'number')
  return times.length ? new Date(Math.max(...times)).toISOString() : null
})
</script>

<template>
  <UCard :ui="{ body: 'p-3' }">
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-heart-pulse" class="size-4 text-primary" />
      <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.health.title') }}</h2>
      <UBadge :color="overall.color" variant="subtle" size="xs" :label="overall.label" />
      <UBadge v-if="health?.db" color="neutral" variant="subtle" size="xs" :label="`DB ${health.db}`" />
      <span v-if="lastSuccess" class="text-[11px] text-muted">
        {{ t('dash.health.lastUpdate') }} {{ formatTimeAgo(new Date(lastSuccess)) }}
      </span>
      <span v-if="serviceSummary" class="text-[11px] text-muted">
        {{ serviceSummary.ready }}/{{ serviceSummary.total }} {{ t('dash.health.ready') }}
      </span>
      <UButton
        class="ms-auto"
        icon="i-lucide-panel-right-open"
        :label="t('dash.health.open')"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="overlay.open('control', { section: 'services' })"
      />
    </div>

    <div v-if="loading.services && !services.length" class="mt-2 flex gap-2">
      <USkeleton v-for="n in 5" :key="n" class="h-5 w-24" />
    </div>

    <div v-else class="mt-2 flex flex-wrap items-center gap-2">
      <UButton
        v-for="row in rows"
        :key="row.id"
        color="neutral"
        variant="ghost"
        size="xs"
        class="gap-1.5"
        :aria-label="`${t(`dash.health.workers.${row.key}`)}: ${row.state}`"
        @click="overlay.open('control', { section: 'services' })"
      >
        <UBadge :color="color(row.state)" variant="subtle" size="xs" :label="row.state" />
        <span class="text-[11px] text-toned">{{ t(`dash.health.workers.${row.key}`) }}</span>
        <span v-if="row.heartbeat" class="text-[10px] text-dimmed">{{ formatTimeAgo(new Date(row.heartbeat)) }}</span>
      </UButton>
      <UBadge
        v-if="failed.services || failed.health"
        color="warning"
        variant="subtle"
        size="xs"
        icon="i-lucide-triangle-alert"
        :label="t('dash.health.unavailable')"
      />
    </div>
  </UCard>
</template>
