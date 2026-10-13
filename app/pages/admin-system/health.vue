<script setup lang="ts">
import type { SystemHealth } from '~~/types/health'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import { formatTimeAgo } from '@vueuse/core'

// System Health (roadmap §58 acceptance #6). Aggregate platform health from the
// real runtime: database reachability + D9 service heartbeats. Fail-soft — the
// store being down simply reports 'error'/'degraded', never a fabricated 'ok'.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'systemHealth.title',
  descKey: 'systemHealth.desc'
})
const health = useSystemHealth()

const data = ref<SystemHealth | null>(null)
const isLoading = ref(false)

async function refresh() {
  isLoading.value = true
  try {
    const res = await health.system()
    data.value = res.data ?? null
  } catch {
    data.value = null
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const statusColor = computed(() =>
  data.value?.status === 'healthy' ? 'success' : data.value?.status === 'degraded' ? 'warning' : 'neutral')

const uptimeLabel = computed(() => {
  const total = data.value?.uptimeSec ?? 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
})

const statusTone = computed<MetricItem['tone']>(() => {
  const s = data.value?.status
  return s === 'healthy' ? 'success' : s === 'degraded' ? 'warning' : s === 'error' ? 'error' : 'default'
})

const overview = computed<MetricItem[]>(() => [
  { key: 'status', label: t('systemHealth.status'), value: data.value ? t(`systemHealth.statusLabels.${data.value.status}`) : '—', icon: 'i-lucide-heart-pulse', tone: statusTone.value },
  { key: 'database', label: t('systemHealth.database'), value: data.value ? t(`systemHealth.dbLabels.${data.value.db}`) : '—', icon: 'i-lucide-database', tone: data.value?.db === 'ok' ? 'success' : data.value?.db === 'error' ? 'error' : 'default' },
  { key: 'version', label: t('systemHealth.version'), value: data.value?.version ?? '—', icon: 'i-lucide-tag' },
  { key: 'uptime', label: t('systemHealth.uptime'), value: uptimeLabel.value, icon: 'i-lucide-clock' },
  { key: 'latency', label: t('systemHealth.latency'), value: data.value ? `${data.value.latencyMs} ms` : '—', icon: 'i-lucide-timer' },
  { key: 'checkedAt', label: t('systemHealth.checkedAt'), value: data.value ? formatTimeAgo(new Date(data.value.time)) : '—', icon: 'i-lucide-history' }
])

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: title.value }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('systemHealth.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="health" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('systemHealth.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="data"
          :label="t(`systemHealth.statusLabels.${data.status}`)"
          :color="statusColor"
          variant="subtle"
          size="sm"
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

    <div class="w-full pb-24 lg:pb-6 space-y-4">
      <div v-if="isLoading && !data" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <USkeleton v-for="n in 6" :key="n" class="h-16 rounded" />
      </div>

      <AdminEmptyState
        v-else-if="!data"
        :title="t('systemHealth.empty')"
        :description="t('systemHealth.emptyHint')"
        icon="i-lucide-heart-pulse"
      />

      <template v-else>
        <MetricRibbon :items="overview" cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-highlighted">{{ t('systemHealth.services') }}</span>
              <UBadge :label="String(data.services.length)" color="neutral" variant="subtle" size="sm" />
            </div>
          </template>

          <div v-if="!data.services.length" class="px-4 py-6 text-center text-sm text-muted">
            {{ t('systemHealth.servicesEmpty') }}
          </div>

          <ul v-else class="divide-y divide-default">
            <li
              v-for="svc in data.services"
              :key="svc.name"
              class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
            >
              <div class="flex items-center gap-2 min-w-40">
                <UIcon name="i-lucide-activity" class="size-4 text-muted" />
                <span class="text-sm font-medium text-highlighted">{{ svc.name }}</span>
              </div>
              <UBadge
                v-if="svc.overdue"
                :label="t('systemHealth.overdue')"
                color="warning"
                variant="subtle"
                size="xs"
              />
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                <span>{{ t('systemHealth.interval') }}: <span class="font-mono">{{ svc.intervalSec }}s</span></span>
                <span>{{ t('systemHealth.lastRun') }}: <span class="font-mono">{{ svc.lastRunAt ? formatTimeAgo(new Date(svc.lastRunAt)) : '—' }}</span></span>
                <span>{{ t('systemHealth.lastError') }}: <span class="font-mono" :class="svc.lastErrorAt ? 'text-warning' : ''">{{ svc.lastErrorAt ? formatTimeAgo(new Date(svc.lastErrorAt)) : '—' }}</span></span>
              </div>
            </li>
          </ul>
        </UCard>
      </template>
    </div>
  </BasePage>
</template>
