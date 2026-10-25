<script setup lang="ts">
import type { MarketSourceHealth, MarketSourceHealthResponse } from '#shared/types/health'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'

// Market Data Sources (roadmap §58 acceptance #6). Live per-venue probes of the
// market data providers (§30.1) — DISTINCT from tm-hub connection records
// (shared-resources/connections.vue). Never re-derives engine numbers (D12).
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketSources.title',
  descKey: 'marketSources.desc'
})
const health = useSystemHealth()

const sources = ref<MarketSourceHealth[]>([])
const meta = ref<MarketSourceHealthResponse['meta'] | null>(null)
const isLoading = ref(false)

async function refresh() {
  isLoading.value = true
  try {
    const res = await health.marketSources()
    sources.value = res.data ?? []
    meta.value = res.meta ?? null
  } catch {
    sources.value = []
    meta.value = null
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const statusColor = (s: MarketSourceHealth['status']) =>
  s === 'up' ? 'success' : s === 'down' ? 'error' : 'neutral'

const metrics = computed<MetricItem[]>(() => {
  const up = sources.value.filter(s => s.status === 'up').length
  const down = sources.value.filter(s => s.status === 'down').length
  const unknown = sources.value.length - up - down
  return [
    { key: 'venues', label: t('marketSources.metrics.venues'), value: String(sources.value.length), icon: 'i-lucide-database-zap' },
    { key: 'up', label: t('marketSources.metrics.up'), value: String(up), icon: 'i-lucide-circle-check', tone: 'success' as const },
    { key: 'down', label: t('marketSources.metrics.down'), value: String(down), icon: 'i-lucide-circle-x', tone: down > 0 ? 'error' as const : 'default' as const },
    { key: 'unknown', label: t('marketSources.metrics.unknown'), value: String(unknown), icon: 'i-lucide-circle-help' }
  ]
})

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: title.value }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('marketSources.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="system-data-sources" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('marketSources.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="meta"
          :label="`${meta.healthy} / ${meta.total}`"
          color="neutral"
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
      <SharedMetricRibbon :items="metrics" />

      <UAlert
        icon="i-lucide-info"
        color="neutral"
        variant="subtle"
        :title="t('marketSources.distinctNote')"
      />

      <div v-if="isLoading && !sources.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <USkeleton v-for="n in sources.length || 3" :key="n" class="h-28 rounded" />
      </div>

      <AdminEmptyState
        v-else-if="!sources.length"
        :title="t('marketSources.empty')"
        :description="t('marketSources.emptyHint')"
        icon="i-lucide-database-zap"
      />

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="s in sources" :key="s.venue" :ui="{ body: 'p-3' }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold text-highlighted capitalize truncate">{{ s.venue }}</div>
              <div class="text-[11px] text-muted mt-0.5">
                {{ t('marketSources.instruments') }}:
                <span class="font-mono">{{ s.instruments }}</span>
              </div>
            </div>
            <UBadge
              :label="t(`marketSources.statusLabels.${s.status}`)"
              :color="statusColor(s.status)"
              variant="subtle"
              size="sm"
            />
          </div>

          <dl class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt class="text-dimmed">{{ t('marketSources.latency') }}</dt>
              <dd class="font-mono text-muted">{{ s.latencyMs != null ? `${s.latencyMs} ms` : '—' }}</dd>
            </div>
            <div>
              <dt class="text-dimmed">{{ t('marketSources.status') }}</dt>
              <dd class="font-mono text-muted">{{ s.status }}</dd>
            </div>
          </dl>

          <p v-if="s.error" class="mt-2 text-[11px] text-error break-words">{{ s.error }}</p>
        </UCard>
      </div>
    </div>
  </BasePage>
</template>
