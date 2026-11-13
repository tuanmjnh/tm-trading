<script setup lang="ts">
// Market Overview strip (V5.0 §3.1). Every value carries its source and asOf;
// a stale snapshot is labelled stale instead of being presented as current.
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { intel, intelFreshness, failed } = useDashboardFeed()
const overlay = useAppOverlay()

const regime = computed(() => intel.value?.regime ?? null)
const generatedAt = computed(() => intel.value?.generatedAt ?? null)

const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'

const change24h = (symbol: string) => {
  const row = intel.value?.movers?.find(m => m.symbol.toUpperCase() === symbol)
  return row ? row.pct24h : null
}

const btc = computed(() => change24h('BTCUSDT'))
const eth = computed(() => change24h('ETHUSDT'))

/** Breadth = share of observed movers with a positive 24h change (labelled as derived). */
const breadth = computed(() => {
  const movers = intel.value?.movers ?? []
  if (!movers.length) return null
  return Math.round((movers.filter(m => m.pct24h > 0).length / movers.length) * 100)
})

const cards = computed<MetricItem[]>(() => {
  const r = regime.value
  return [
    {
      key: 'regime',
      label: t('dash.market.regime'),
      value: r ? t(`dash.market.season.${r.season}`) : '—',
      hint: r ? `ASI ${r.asi?.d90 ?? '—'}` : t('dash.market.noData'),
      icon: 'i-lucide-compass',
      tone: r ? 'primary' : 'default'
    },
    {
      key: 'fng',
      label: t('dash.market.fng'),
      value: r?.fng ? String(r.fng.value) : '—',
      hint: r?.fng?.classification ?? '—',
      icon: 'i-lucide-gauge',
      tone: !r?.fng ? 'default' : r.fng.value <= 25 ? 'error' : r.fng.value >= 75 ? 'success' : 'default',
      bar: r?.fng ? Math.max(0, Math.min(100, r.fng.value)) : undefined
    },
    {
      key: 'btc',
      label: t('dash.market.btc'),
      value: pct(btc.value),
      hint: `ETH ${pct(eth.value)}`,
      icon: 'i-lucide-bitcoin',
      tone: btc.value == null ? 'default' : btc.value > 0 ? 'success' : btc.value < 0 ? 'error' : 'default'
    },
    {
      key: 'breadth',
      label: t('dash.market.breadth'),
      value: breadth.value == null ? '—' : `${breadth.value}%`,
      hint: r ? `BTC.D ${pct(r.btcDom)} · ETH.D ${pct(r.ethDom)}` : '—',
      icon: 'i-lucide-bar-chart-3',
      tone: breadth.value == null ? 'default' : breadth.value >= 50 ? 'success' : 'warning',
      bar: breadth.value ?? undefined
    }
  ]
})
</script>

<template>
  <section class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.market.title') }}</h2>
      <UBadge
        :color="intelFreshness === 'fresh' ? 'success' : intelFreshness === 'stale' ? 'warning' : 'neutral'"
        variant="subtle"
        size="xs"
        :icon="intelFreshness === 'fresh' ? 'i-lucide-clock' : 'i-lucide-clock-alert'"
        :label="t(`dash.freshness.${intelFreshness}`)"
      />
      <span v-if="generatedAt" class="text-[11px] text-muted font-mono">
        {{ t('dash.asOf') }} {{ formatTimeAgo(new Date(generatedAt)) }}
      </span>
      <UBadge v-if="intel?.mongo === 'down'" color="warning" variant="subtle" size="xs"
        icon="i-lucide-database-zap" :label="t('intel.mongoDown')" />
      <UButton
        class="ms-auto"
        icon="i-lucide-panel-right-open"
        :label="t('dash.controlCenter')"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="overlay.open('control', { section: 'services' })"
      />
    </div>

    <SharedMetricRibbon :items="cards" />

    <p class="text-[11px] text-muted">{{ t('dash.market.sourceNote') }}</p>

    <UAlert
      v-if="failed.intel"
      color="warning"
      variant="subtle"
      icon="i-lucide-database-zap"
      :title="t('dash.market.noData')"
      :description="t('dash.market.noDataHint')"
    />
  </section>
</template>
