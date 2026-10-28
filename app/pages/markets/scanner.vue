<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { IntelRegime, IntelServiceRow } from '#shared/types/intel'
import type { ScannerCandidate, ScannerSignal } from '~/utils/scanner'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'

// =============================================================================
//  Scanner (roadmap §58.5 /markets/scanner) — one symbol-centric candidate list
//  merged from the scanner-service snapshots (mover / flow / accum), joined to
//  the canonical Instrument Catalog. Regime/season is shown as CONTEXT only —
//  the full regime panel lives on Market Intelligence (§58.6 boundary, §58.5).
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketScanner.title',
  descKey: 'marketScanner.desc'
})
const { viewMode } = useAdminGridView('markets-scanner-view-mode')
const scanner = useMarketScanner()

const candidates = ref<ScannerCandidate[]>([])
const mongo = ref<'up' | 'down'>('up')
const generatedAt = ref<string | null>(null)
const services = ref<IntelServiceRow[]>([])
const regime = ref<IntelRegime | null>(null)
const catalogSize = ref(0)
const isLoading = ref(false)
const search = ref('')
const typeFilter = ref('')

const SIGNAL_TYPES: ScannerSignal[] = ['mover', 'flow', 'accum']

async function refresh() {
  isLoading.value = true
  try {
    const snap = await scanner.load()
    candidates.value = snap.candidates
    mongo.value = snap.mongo
    generatedAt.value = snap.generatedAt
    services.value = snap.services
    regime.value = snap.regime
    catalogSize.value = snap.catalogSize
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return candidates.value.filter((c) => {
    if (typeFilter.value && !c.signals.includes(typeFilter.value as ScannerSignal)) return false
    if (q) {
      const hay = `${c.symbol} ${c.instrument?.symbol ?? ''} ${c.instrument?.engineSymbol ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const scannerService = computed(() => services.value.find(s => /scanner/i.test(s.name)) ?? null)
const sweep = computed(() => regime.value?.sweep ?? [])
const sweepPassed = computed(() => sweep.value.filter(s => s.ok).length)

const signalColor = (s: ScannerSignal): 'warning' | 'primary' | 'info' =>
  s === 'mover' ? 'warning' : s === 'flow' ? 'primary' : 'info'
const flowColor = (d: ScannerCandidate['flowDir']): 'success' | 'error' | 'warning' | 'neutral' =>
  d === 'buy' ? 'success' : d === 'sell' ? 'error' : d === 'vol' ? 'warning' : 'neutral'

function fmtVol(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}
function fmtPrice(v: number | null) {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1000) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}
function fmtUtc(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`
  return `${Math.floor(diffMs / 86400000)}d ago`
}

function fmtNextUpdate(iso: string | null, intervalSec: number): string {
  if (!iso || !intervalSec) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const next = new Date(d.getTime() + intervalSec * 1000)
  const diffMs = next.getTime() - Date.now()
  if (diffMs <= 0) return t('marketScanner.updatingSoon')
  if (diffMs < 60000) return `${Math.ceil(diffMs / 1000)}s`
  return `${Math.ceil(diffMs / 60000)}m`
}

// Terminal deep-link is guarded so non-ASCII / non-engine symbols (e.g. a
// mis-scraped native symbol) never produce a broken /trading route (§57.4 B).
const TERMINAL_SYMBOL = /^[A-Z0-9]{5,20}$/
function tradeTarget(c: ScannerCandidate): string {
  const sym = c.instrument?.engineSymbol ?? c.symbol
  return TERMINAL_SYMBOL.test(sym) ? `/trading?instrument=${encodeURIComponent(sym)}` : ''
}

const signalCounts = computed(() => ({
  mover: candidates.value.filter(c => c.signals.includes('mover')).length,
  flow: candidates.value.filter(c => c.signals.includes('flow')).length,
  accum: candidates.value.filter(c => c.signals.includes('accum')).length
}))

const metrics = computed<MetricItem[]>(() => [
  { key: 'candidates', label: t('marketScanner.metrics.candidates'), value: String(candidates.value.length), icon: 'i-lucide-radar', tone: 'primary' },
  { key: 'mover', label: t('marketScanner.signalLabels.mover'), value: String(signalCounts.value.mover), icon: 'i-lucide-trending-up', tone: 'warning' },
  { key: 'flow', label: t('marketScanner.signalLabels.flow'), value: String(signalCounts.value.flow), icon: 'i-lucide-waves', tone: 'info' },
  { key: 'accum', label: t('marketScanner.signalLabels.accum'), value: String(signalCounts.value.accum), icon: 'i-lucide-minimize-2', tone: 'success' }
])

const chips = computed(() => [
  { value: '', label: t('marketScanner.allTypes'), count: candidates.value.length },
  ...SIGNAL_TYPES.map(s => ({ value: s, label: t(`marketScanner.signalLabels.${s}`), count: signalCounts.value[s] }))
])

const trail = computed(() => [{ label: t('nav.markets') }, { label: title.value }])

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('marketScanner.columns.symbol'), class: 'min-w-32' },
  { key: 'signals', label: t('marketScanner.columns.signals'), class: 'min-w-40' },
  { key: 'flow', label: t('marketScanner.columns.flow'), class: 'w-24' },
  { key: 'pct24h', label: t('marketScanner.columns.pct24h'), class: 'w-20' },
  { key: 'volume', label: t('marketScanner.columns.volume'), class: 'w-28' },
  { key: 'reasons', label: t('marketScanner.columns.reasons'), class: 'min-w-48' },
  { key: 'actions', label: t('marketScanner.columns.actions'), class: 'w-20' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="markets-scanner" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('marketScanner.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('marketScanner.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UBadge
          v-if="scannerService"
          :label="scannerService.name"
          :color="scannerService.overdue ? 'error' : 'success'"
          variant="subtle"
          size="xs"
          :title="t('marketScanner.serviceTip', { last: fmtUtc(scannerService.lastOkAt), every: scannerService.intervalSec })"
        />
        <UBadge
          v-if="regime"
          :label="t(`regime.${regime.season === 'alt' ? 'seasonAlt' : regime.season === 'btc' ? 'seasonBtc' : 'seasonNeutral'}`)"
          :color="regimeTone(regime.season)"
          variant="subtle"
          size="xs"
        />
        <UBadge v-if="generatedAt" :label="`${t('marketScanner.lastUpdated')} ${fmtUtc(generatedAt)}`" color="neutral" variant="subtle" size="xs" />
        <UBadge
          v-if="generatedAt && scannerService?.intervalSec"
          :label="`${t('marketScanner.nextUpdate')} ${fmtNextUpdate(generatedAt, scannerService.intervalSec)}`"
          color="neutral"
          variant="subtle"
          size="xs"
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
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <SharedFilterChips v-model="typeFilter" :items="chips" />
        <USeparator orientation="vertical" class="h-4" />
        <UBadge
          v-if="regime"
          :label="t('marketScanner.sweepSummary', { passed: sweepPassed, total: sweep.length })"
          color="neutral"
          variant="subtle"
          size="xs"
        />
        <UInput
          v-model="search"
          :placeholder="t('marketScanner.search')"
          icon="i-lucide-search"
          size="xs"
          class="w-52"
          :aria-label="t('marketScanner.search')"
        />
        <UButton
          icon="i-lucide-brain-circuit"
          :label="t('marketScanner.regimeDetail')"
          size="xs"
          variant="ghost"
          color="neutral"
          to="/markets"
          class="ms-auto"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <SharedMetricRibbon :items="metrics" />
      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="symbol"
        storage-key="markets-scanner-view-mode"
        @refresh="refresh"
      >
        <template #symbol="{ item }">
          <div class="flex flex-col">
            <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
            <span v-if="item.instrument" class="text-[10px] text-dimmed font-mono">
              {{ item.instrument.symbol }} · {{ fmtPrice(item.lastPrice) }}
            </span>
            <span v-else class="text-[10px] text-dimmed">{{ t('marketScanner.notInCatalog') }}</span>
          </div>
        </template>

        <template #signals="{ item }">
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="s in item.signals"
              :key="`${item.symbol}-${s}`"
              :label="t(`marketScanner.signalLabels.${s}`)"
              :color="signalColor(s)"
              variant="subtle"
              size="xs"
            />
            <UBadge v-if="item.breakout" :label="t('marketScanner.breakout')" color="error" variant="subtle" size="xs" />
          </div>
        </template>

        <template #flow="{ item }">
          <div v-if="item.flowDir" class="flex flex-col items-start gap-0.5">
            <UBadge :label="t(`intel.dir_${item.flowDir}`)" :color="flowColor(item.flowDir)" variant="subtle" size="xs" />
            <span v-if="item.score" class="text-[10px] text-dimmed font-mono">{{ item.score.toFixed(1) }}</span>
          </div>
          <span v-else class="text-[11px] text-dimmed">—</span>
        </template>

        <template #pct24h="{ item }">
          <span class="text-xs font-mono" :class="item.pct24h >= 0 ? 'text-success' : 'text-error'">
            {{ fmtPct(item.pct24h) }}
          </span>
        </template>

        <template #volume="{ item }">
          <div class="flex flex-col">
            <span class="text-[11px] font-mono text-muted">{{ fmtVol(item.quoteVolume) }}</span>
            <span v-if="item.volRatio && item.volRatio > 0" class="text-[10px] font-mono text-dimmed">
              {{ t('marketScanner.volTimes', { n: item.volRatio.toFixed(1) }) }}
            </span>
          </div>
        </template>

        <template #reasons="{ item }">
          <div v-if="item.reasons.length" class="flex flex-wrap gap-1">
            <UBadge
              v-for="r in item.reasons.slice(0, 3)"
              :key="`${item.symbol}-r-${r}`"
              :label="r"
              color="neutral"
              variant="outline"
              size="xs"
            />
            <span v-if="item.reasons.length > 3" class="text-[10px] text-dimmed">+{{ item.reasons.length - 3 }}</span>
          </div>
          <span v-else class="text-[11px] text-dimmed">—</span>
        </template>

        <template #actions="{ item }">
          <UButton
            v-if="tradeTarget(item)"
            icon="i-lucide-panel-top-open"
            size="xs"
            variant="ghost"
            color="primary"
            :to="tradeTarget(item)"
            :title="t('marketScanner.openTerminal')"
            :aria-label="t('marketScanner.openTerminal')"
            :ui="{ label: 'hidden' }"
          />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex flex-col gap-1.5 w-full">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
              <span class="text-xs font-mono" :class="item.pct24h >= 0 ? 'text-success' : 'text-error'">
                {{ fmtPct(item.pct24h) }}
              </span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="s in item.signals"
                :key="`m-${item.symbol}-${s}`"
                :label="t(`marketScanner.signalLabels.${s}`)"
                :color="signalColor(s)"
                variant="subtle"
                size="xs"
              />
              <UBadge v-if="item.flowDir" :label="t(`intel.dir_${item.flowDir}`)" :color="flowColor(item.flowDir)" variant="subtle" size="xs" />
              <UBadge v-if="item.breakout" :label="t('marketScanner.breakout')" color="error" variant="subtle" size="xs" />
            </div>
            <div class="flex items-center justify-between gap-2 text-[10px] text-dimmed font-mono">
              <span>{{ fmtVol(item.quoteVolume) }}<template v-if="item.volRatio"> · {{ t('marketScanner.volTimes', { n: item.volRatio.toFixed(1) }) }}</template></span>
              <span v-if="item.instrument">{{ item.instrument.symbol }}</span>
              <span v-else>{{ t('marketScanner.notInCatalog') }}</span>
            </div>
            <UButton
              v-if="tradeTarget(item)"
              icon="i-lucide-panel-top-open"
              :label="t('marketScanner.openTerminal')"
              size="xs"
              variant="soft"
              color="primary"
              :to="tradeTarget(item)"
            />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('marketScanner.empty')"
            :description="mongo === 'down' ? t('marketScanner.emptyMongo') : t('marketScanner.emptyHint')"
            icon="i-lucide-radar"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>