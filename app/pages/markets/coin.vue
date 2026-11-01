<script setup lang="ts">
import type { IntelData } from '#shared/types/intel'

const route = useRoute()
const symbol = computed(() => String(route.query.symbol ?? ''))

const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketCoin.title',
  descKey: 'marketCoin.desc'
})
const intelApi = useIntel()

const intel = ref<IntelData | null>(null)
const isLoading = ref(false)

async function load() {
  isLoading.value = true
  try {
    intel.value = await intelApi.get()
  } finally {
    isLoading.value = false
  }
}
onMounted(load)

const mover = computed(() => intel.value?.movers.find(m => m.symbol === symbol.value))
const flow = computed(() => intel.value?.flows.find(f => f.symbol === symbol.value))
const vol = computed(() => intel.value?.volatility.find(v => v.symbol === symbol.value))
const lowcap = computed(() => intel.value?.lowcap.find(l => l.symbol === symbol.value))
const fundingOi = computed(() => intel.value?.fundingOi.find(f => f.symbol === symbol.value))

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
</script>

<template>
  <BasePage id="markets-coin" :title="title" :description="description">
    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold font-mono text-highlighted">{{ symbol }}</h2>
        <UButton :loading="isLoading" @click="load" color="primary" variant="soft" icon="i-lucide-refresh-cw">
          {{ t('common.refresh') }}
        </UButton>
      </div>

      <UAlert
        :title="t('marketCoin.freshness')"
        :description="intel?.generatedAt ? new Date(intel.generatedAt).toISOString() : t('common.unknown')"
      />

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UCard v-if="mover">
          <template #header>{{ t('marketCoin.mover') }}</template>
          <div class="text-sm space-y-1">
            <div>{{ t('intel.colPct24h') }}: {{ fmtPct(mover.pct24h) }}</div>
            <div>{{ t('intel.colChg4h') }}: {{ fmtPct(mover.chg4h) }}</div>
            <div>{{ t('intel.colBreakout') }}: {{ mover.breakout ? t('intel.yes') : t('intel.no') }}</div>
          </div>
        </UCard>
        <UCard v-if="flow">
          <template #header>{{ t('marketCoin.flow') }}</template>
          <div class="text-sm space-y-1">
            <div>{{ t('intel.colDir') }}: {{ flow.dir }}</div>
            <div>{{ t('intel.colScore') }}: {{ flow.score }}</div>
          </div>
        </UCard>
        <UCard v-if="vol">
          <template #header>{{ t('marketCoin.volatility') }}</template>
          <div class="text-sm space-y-1">
            <div>{{ t('marketVolatility.atrPct') }}: {{ fmtPct(vol.atrPct) }}</div>
            <div>{{ t('marketVolatility.chg4h') }}: {{ fmtPct(vol.chg4h) }}</div>
            <div>{{ t('marketVolatility.rangePct') }}: {{ fmtPct(vol.rangePct) }}</div>
            <div>{{ t('common.score') }}: {{ vol.score }}</div>
          </div>
        </UCard>
        <UCard v-if="lowcap">
          <template #header>{{ t('marketLowcap.title') }}</template>
          <div class="text-sm space-y-1">
            <div>{{ t('marketLowcap.quoteVolume') }}: {{ lowcap.quoteVolume }}</div>
            <div>{{ t('marketLowcap.pct24h') }}: {{ fmtPct(lowcap.pct24h) }}</div>
            <div>{{ t('common.score') }}: {{ lowcap.score }}</div>
          </div>
        </UCard>
        <UCard v-if="fundingOi">
          <template #header>{{ t('marketCoin.fundingOi') }}</template>
          <div class="text-sm space-y-1">
            <div>{{ t('intel.colRate') }}: {{ fmtPct(fundingOi.pct, 4) }}</div>
            <div>{{ t('intel.colOi') }}: {{ fundingOi.oiNotionalUsd ?? '—' }}</div>
            <div>{{ t('common.score') }}: {{ fundingOi.score }}</div>
          </div>
        </UCard>
      </div>
    </div>
  </BasePage>
</template>