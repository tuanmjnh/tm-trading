<script setup lang="ts">
// Market Pulse (V5.0 §3.4) — tabs INSIDE the panel, not one page per group.
// Vendor estimates and venue-reported numbers are labelled differently on purpose.
const { t } = useI18n()
const { intel, loading } = useDashboardFeed()
const overlay = useAppOverlay()

type PulseTab = 'movers' | 'volatility' | 'volume' | 'funding' | 'oi' | 'liquidation' | 'lowcap'
interface PulseRow {
  symbol: string
  primary: string
  secondary: string
  tone: string
  note?: string
}

const tab = ref<PulseTab>('movers')

const tabs: Array<{ key: PulseTab, icon: string }> = [
  { key: 'movers', icon: 'i-lucide-trending-up' },
  { key: 'volatility', icon: 'i-lucide-activity' },
  { key: 'volume', icon: 'i-lucide-bar-chart-2' },
  { key: 'funding', icon: 'i-lucide-percent' },
  { key: 'oi', icon: 'i-lucide-layers' },
  { key: 'liquidation', icon: 'i-lucide-flame' },
  { key: 'lowcap', icon: 'i-lucide-gem' }
]

const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '—'
const tone = (v: number | null | undefined) =>
  typeof v !== 'number' ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const usd = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `$${(v / 1e6).toFixed(1)}M` : '—'

/** Rows for the active tab, already shaped by the services — never recomputed. */
const rows = computed<PulseRow[]>(() => {
  const d = intel.value
  if (!d) return []

  switch (tab.value) {
    case 'movers':
      return (d.movers ?? []).map(m => ({
        symbol: m.symbol,
        primary: pct(m.pct24h),
        secondary: `4h ${pct(m.chg4h)} · ${usd(m.quoteVolume)}`,
        tone: tone(m.pct24h),
        note: m.breakout ? t('dash.pulse.breakout') : undefined
      }))
    case 'volatility':
      return (d.volatility ?? []).map(v => ({
        symbol: v.symbol,
        primary: `ATR ${v.atrPct.toFixed(1)}%`,
        secondary: `range ${v.rangePct.toFixed(1)}% · vol ${v.volRatio.toFixed(1)}×`,
        tone: tone(v.chg4h),
        note: `4h ${pct(v.chg4h)}`
      }))
    case 'volume':
      return [
        ...(d.flows ?? []).map(f => ({
          symbol: f.symbol,
          primary: `${f.volRatio.toFixed(1)}×`,
          secondary: `taker ${(f.takerRatio * 100).toFixed(0)}% · CMF ${f.cmf.toFixed(2)}`,
          tone: tone(f.pct24h),
          note: f.dir
        })),
        ...(d.accums ?? []).map(a => ({
          symbol: a.symbol,
          primary: `range ${a.rangePct.toFixed(1)}%`,
          secondary: `Δ48h ${pct(a.priceChg48)}`,
          tone: tone(a.priceChg48),
          note: t('dash.pulse.accumulation')
        }))
      ]
    case 'funding':
      return (d.fundingOi ?? d.funding ?? []).map((f) => {
        const rate = 'pct' in f ? f.pct : 0
        return {
          symbol: f.symbol,
          primary: `${rate.toFixed(4)}%`,
          secondary: 'oiNotionalUsd' in f ? `OI ${usd(f.oiNotionalUsd)}` : '',
          tone: tone(rate)
        }
      })
    case 'oi':
      return (d.fundingOi ?? [])
        .filter(f => f.oiNotionalUsd != null)
        .map(f => ({
          symbol: f.symbol,
          primary: usd(f.oiNotionalUsd),
          secondary: `funding ${f.pct.toFixed(4)}%`,
          tone: 'text-toned'
        }))
    case 'liquidation':
      return (d.zones ?? []).flatMap(z => [
        ...(z.actual ?? []).map(a => ({
          symbol: z.symbol,
          primary: `${a.side} ${a.price}`,
          secondary: t('dash.pulse.liquidationActual', { usd: usd(a.usd), count: a.n }),
          tone: a.side === 'long' ? 'text-error' : 'text-success',
          note: t('dash.pulse.venueReported')
        })),
        ...(z.est ?? []).map(e => ({
          symbol: z.symbol,
          primary: `${e.side} ${e.price}`,
          secondary: `lev ${e.lev}× · ${pct(e.pct)}`,
          tone: 'text-muted',
          note: t('dash.pulse.estimate')
        }))
      ])
    case 'lowcap':
      return (d.lowcap ?? []).map(l => ({
        symbol: l.symbol,
        primary: pct(l.pct24h),
        secondary: `vol ${usd(l.quoteVolume)} · ${l.lastPrice}`,
        tone: tone(l.pct24h)
      }))
  }
})
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-waves" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.pulse.title') }}</h2>
        <UBadge v-if="intel?.generatedAt" color="neutral" variant="subtle" size="xs" class="font-mono"
          :label="intel.generatedAt.slice(11, 16) + ' UTC'" />
      </div>
    </template>

    <div class="mb-3 flex gap-1 overflow-x-auto" role="tablist">
      <UButton
        v-for="item in tabs"
        :key="item.key"
        :icon="item.icon"
        :label="t(`dash.pulse.${item.key}`)"
        size="xs"
        :color="tab === item.key ? 'primary' : 'neutral'"
        :variant="tab === item.key ? 'soft' : 'ghost'"
        role="tab"
        :aria-selected="tab === item.key"
        @click="tab = item.key"
      />
    </div>

    <div v-if="loading.intel && !rows.length" class="space-y-2">
      <USkeleton v-for="n in 5" :key="n" class="h-6 w-full" />
    </div>

    <AdminEmptyState v-else-if="!rows.length" :title="t('dash.pulse.empty')" :description="t('dash.pulse.emptyHint')" icon="i-lucide-waves" />

    <ul v-else class="divide-y divide-default/60 max-h-[min(46vh,420px)] overflow-y-auto">
      <li v-for="(row, i) in rows.slice(0, 40)" :key="`${row.symbol}-${i}`" class="flex items-center gap-2 py-1.5 min-w-0">
        <button
          type="button"
          class="flex flex-1 items-center gap-2 min-w-0 text-left rounded px-1 hover:bg-elevated/40"
          :aria-label="`${t('dash.watchlist.detail')}: ${row.symbol}`"
          @click="overlay.open('asset', { symbol: row.symbol })"
        >
          <span class="font-mono text-xs font-semibold text-highlighted w-24 shrink-0 truncate">{{ row.symbol }}</span>
          <span class="font-mono text-xs shrink-0 w-24 text-right" :class="row.tone">{{ row.primary }}</span>
          <span class="flex-1 min-w-0 text-[11px] text-muted truncate">{{ row.secondary }}</span>
          <UBadge v-if="row.note" color="neutral" variant="subtle" size="xs" class="shrink-0" :label="row.note" />
        </button>
      </li>
    </ul>
  </UCard>
</template>
