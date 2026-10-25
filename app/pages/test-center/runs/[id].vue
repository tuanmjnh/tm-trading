<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { RunSeriesDetail, RunTrade } from '#shared/types/runs'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const runsApi = useRuns()
const researchApi = useResearch()

// §59.15 Slice E — freeze this run's evidence. The id here is the SERIES id the
// Test Center links and compares (`engineVersion~symbol~tf~paramsHash`); the
// service resolves it against reports/*.ndjson, i.e. the same rows this page
// displays, so the frozen set cannot disagree with what the reviewer saw (D12).
const freezing = ref(false)
const frozenSetId = ref<string | null>(null)

async function freezeEvidence() {
  if (!data.value || freezing.value) return
  freezing.value = true
  try {
    const doc = await researchApi.freezeEvidence({ kind: 'backtest-run', sourceId: seriesId.value })
    frozenSetId.value = doc.setId || doc._id
    notify.success(
      doc.alreadyFrozen ? t('runs.freezeEvidenceExists') : t('runs.freezeEvidence'),
      doc.sourceChanged ? t('runs.freezeEvidenceChanged') : frozenSetId.value || undefined
    )
  } catch (err) {
    notify.error(t('runs.freezeEvidence'), getErrorMessage(err, key => t(key)))
  } finally {
    freezing.value = false
  }
}

const seriesId = computed(() => String(route.params.id ?? ''))
const data = ref<RunSeriesDetail | null>(null)
const isLoading = ref(true)
const { viewMode } = useAdminGridView('run-detail-view-mode')

// Slice 3 lineage: strategy versions that cite this run as backtest/holdout
// evidence. Reverse of the version->run pointer (read-only, fail-soft).
interface LineageRow {
  strategyVersionId: string
  strategyId: string | null
  version: string | null
  status: string | null
  backtest: boolean
  holdout: boolean
  profileName: string | null
}
const lineage = ref<LineageRow[]>([])

async function loadLineage() {
  try {
    const res = await $fetch<{ success: boolean; data: LineageRow[] }>(
      `/api/v1/runs/${encodeURIComponent(seriesId.value)}/lineage`
    )
    lineage.value = res.data ?? []
  } catch {
    lineage.value = []
  }
}

const versionStates: Record<string, string> = {
  draft: 'strategyLab.strategyDetail.versionStates.draft',
  backtest: 'strategyLab.strategyDetail.versionStates.backtest',
  holdout: 'strategyLab.strategyDetail.versionStates.holdout',
  paper: 'strategyLab.strategyDetail.versionStates.paper',
  stable_paper: 'strategyLab.strategyDetail.versionStates.stable_paper',
  archived: 'strategyLab.strategyDetail.versionStates.archived'
}
const stateLabel = (s: string | null) => (s ? t(versionStates[s] ?? s) : '—')
const stateColor = (s: string | null): 'primary' | 'success' | 'info' | 'warning' | 'neutral' =>
  s === 'stable_paper' ? 'success' : s === 'paper' ? 'info' : s === 'archived' ? 'neutral' : s === 'draft' ? 'warning' : 'primary'

async function load() {
  isLoading.value = true
  try {
    data.value = await runsApi.detail(seriesId.value)
  } catch (err) {
    notify.error(t('runs.detail.title'), getErrorMessage(err, key => t(key)))
    data.value = null
  } finally {
    isLoading.value = false
  }
  void loadLineage()
}

onMounted(load)

const title = computed(() => (data.value ? `${data.value.symbol} · ${data.value.tf}m` : t('runs.detail.title')))
const description = computed(() => {
  const s = data.value
  if (!s) return t('runs.desc')
  return `${s.method} · v${s.engineVersion} · ${s.paramsHash.slice(0, 8)}`
})

const trail = computed(() => [
  { label: t('nav.test_center'), to: '/test-center/runs' },
  { label: title.value }
])

// Slice 3 — explicit mode separation: a backtest run's metrics are distinct
// from replay / live-paper. Label this surface and cross-link the other two.
const otherModes = computed(() => [
  { key: 'REPLAY' as const, to: '/test-center/replay' },
  { key: 'LIVE_PAPER' as const, to: '/test-center/forward' }
])

const params = computed(() => {
  if (!data.value) return []
  return Object.entries(data.value.params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    }))
})

const trades = computed<RunTrade[]>(() => data.value?.trades ?? [])

// ---------------- Equity curve (Phase 7) ----------------
// Diem du lieu da co san tu API (`equity`, tinh ben server bang vong lap cua
// engine - co test khoa diem cuoi === netPct, dam === maxDrawdownPct).
// SVG thuuan, khong them dependency bieu do (unovis dang co trong nhom CAT).
const eqPoints = computed(() => data.value?.equity ?? [])

const eqChart = computed(() => {
  const pts = eqPoints.value
  if (!pts.length) return null
  // Diem xuat phat 0 - giong engine (peak/eq bat dau tu 0 truoc lenh dau tien)
  const values = [0, ...pts.map(p => p.v)]
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (max - min < 1e-9) { max = 1; min = -1 }
  const W = 1000
  const H = 100
  const y = (v: number) => H - ((v - min) / (max - min)) * H
  const coords = values.map((v, i) => ({ x: (i / Math.max(1, values.length - 1)) * W, y: y(v) }))
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
  return {
    line,
    area: `${line} L${W},${H} L0,${H} Z`,
    zeroY: y(0),
    last: values[values.length - 1] ?? 0,
    peak: Math.max(...values),
    trough: Math.min(...values),
    n: pts.length
  }
})

const firstEqT = computed(() => eqPoints.value[0]?.t ?? null)
const lastEqT = computed(() => eqPoints.value[eqPoints.value.length - 1]?.t ?? null)
const fmtEqTime = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—')

const metrics = computed<MetricItem[]>(() => {
  const s = data.value?.summary
  if (!s) return []
  return [
    { key: 'trades', label: t('runs.detail.stats.trades'), value: String(s.trades), hint: s.open ? `+${s.open} ${t('runs.open')}` : '' },
    { key: 'winRate', label: t('runs.detail.stats.winRate'), value: `${(s.winRate * 100).toFixed(1)}%`, hint: `${s.wins}W / ${s.losses}L` },
    { key: 'pf', label: t('runs.detail.stats.profitFactor'), value: s.profitFactor === null ? '∞' : s.profitFactor.toFixed(2), hint: '' },
    { key: 'net', label: t('runs.detail.stats.net'), value: `${s.netPct.toFixed(2)}%`, hint: t('runs.detail.stats.netHint'), tone: s.netPct > 0 ? 'success' : s.netPct < 0 ? 'error' : 'default' },
    { key: 'maxDD', label: t('runs.detail.stats.maxDD'), value: `${s.maxDrawdownPct.toFixed(2)}%`, hint: '' },
    { key: 'medianR', label: t('runs.detail.stats.medianR'), value: `${s.medianRr.toFixed(2)}R`, hint: `avg ${s.avgRr.toFixed(2)}R` },
    { key: 'expectancy', label: t('runs.detail.stats.expectancy'), value: `${s.expectancy.toFixed(3)}R`, hint: t('runs.detail.stats.expectancyHint'), tone: s.expectancy > 0 ? 'success' : s.expectancy < 0 ? 'error' : 'default' },
    { key: 'degenerate', label: t('runs.detail.stats.degenerate'), value: String(s.degenerateRisk), hint: t('runs.detail.stats.degenerateHint') }
  ]
})

const columns = computed<GridColumn[]>(() => [
  { key: 'entryTime', label: t('runs.detail.entry'), class: 'w-44' },
  { key: 'dir', label: t('runs.detail.side'), class: 'w-16' },
  { key: 'entryPrice', label: t('runs.detail.entryPrice'), class: 'w-28' },
  { key: 'exit', label: t('runs.detail.exit'), class: 'w-36' },
  { key: 'result', label: t('runs.detail.result'), class: 'w-20' },
  { key: 'pnlPct', label: t('runs.detail.pnl'), class: 'w-24' },
  { key: 'rMultiple', label: t('runs.detail.rMultiple'), class: 'w-20' },
  { key: 'barsHeld', label: t('runs.detail.bars'), class: 'w-16' }
])

const fmtPrice = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—')
const fmtPct = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)}%` : '—')
const fmtR = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)}R` : '—')
const resultColor = (r: string): 'primary' | 'success' | 'error' | 'warning' | 'neutral' =>
  r === 'TP' ? 'success' : r === 'SL' ? 'error' : r === 'OPEN' ? 'primary' : 'neutral'

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(t('common.copied'))
  } catch {
    notify.error(t('common.error'))
  }
}

useHead({ title })
</script>

<template>
  <BasePage id="run-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('testCenter.pips.runDetail')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <TestCenterRunModeBadge mode="BACKTEST" />
        <UButton
          v-for="m in otherModes"
          :key="m.key"
          :icon="m.key === 'REPLAY' ? 'i-lucide-history' : 'i-lucide-fast-forward'"
          :label="t(`testCenter.modes.${m.key}`)"
          variant="ghost"
          color="neutral"
          size="sm"
          :to="m.to"
          :ui="{ label: 'hidden lg:block' }"
        />
        <UButton
          icon="i-lucide-scale"
          :label="t('runs.compare.nav')"
          variant="soft"
          color="primary"
          size="sm"
          :to="`/test-center/runs/compare?ids=${encodeURIComponent(seriesId)}`"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          v-if="data && !frozenSetId"
          icon="i-lucide-lock"
          :label="t('runs.freezeEvidence')"
          variant="soft"
          color="primary"
          size="sm"
          :loading="freezing"
          :title="t('runs.freezeEvidenceHint')"
          @click="freezeEvidence"
        />
        <UButton
          v-if="frozenSetId"
          icon="i-lucide-fingerprint"
          :label="t('runs.viewEvidenceSet')"
          variant="soft"
          color="primary"
          size="sm"
          :to="`/data-research/research/evidence/${encodeURIComponent(frozenSetId)}`"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <div v-if="!isLoading && !data" class="flex flex-col items-center justify-center py-20">
      <AdminEmptyState
        :title="t('runs.detail.notFound')"
        :description="t('runs.detail.notFoundHint')"
        icon="i-lucide-search-x"
      />
      <UButton
        to="/test-center/runs"
        icon="i-lucide-arrow-left"
        :label="t('nav.test_center')"
        color="primary"
        variant="soft"
        class="mt-4"
      />
    </div>

    <div v-else class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <!-- Canh bao D1: khong im lang khi so lieu khong Sach -->
      <UAlert
        v-for="w in data?.warnings ?? []"
        :key="w"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t(`runs.warn.${w}`)"
        :description="t(`runs.warnDesc.${w}`)"
      />

      <!-- KPI -->
      <SharedMetricRibbon :items="metrics" />

      <!-- Duong equity - diem cuoi/dam khoa voi summary (D1, tests/equity.test.ts) -->
      <UCard v-if="eqChart">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-chart-no-axes-combined" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.detail.equity') }}</h3>
              <UBadge :label="`${eqChart.n}`" variant="subtle" size="xs" />
            </div>
            <span class="text-[11px] text-dimmed font-mono">
              {{ fmtEqTime(firstEqT) }} → {{ fmtEqTime(lastEqT) }} UTC
            </span>
          </div>
        </template>

        <div class="space-y-3">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div v-for="st in [
              { label: t('runs.detail.stats.net'), value: data?.summary.netPct, hint: t('runs.detail.stats.netHint') },
              { label: t('runs.detail.stats.maxDD'), value: data?.summary.maxDrawdownPct, hint: '' },
              { label: t('runs.detail.stats.peak'), value: eqChart.peak, hint: '' },
              { label: t('runs.detail.stats.trough'), value: eqChart.trough, hint: '' }
            ]" :key="st.label" class="min-w-0">
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider truncate">{{ st.label }}</div>
              <div
                class="text-sm font-bold font-mono mt-0.5 truncate"
                :class="(st.value ?? 0) > 0 ? 'text-success' : (st.value ?? 0) < 0 ? 'text-error' : 'text-highlighted'"
              >{{ fmtPct(st.value) }}</div>
              <p v-if="st.hint" class="text-[10px] text-dimmed truncate">{{ st.hint }}</p>
            </div>
          </div>

          <div class="relative h-56 w-full">
            <svg
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              class="w-full h-full"
              role="img"
              :aria-label="t('runs.detail.equity')"
            >
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" :stop-color="eqChart.last >= 0 ? 'var(--color-success)' : 'var(--color-error)'" stop-opacity="0.28" />
                  <stop offset="100%" :stop-color="eqChart.last >= 0 ? 'var(--color-success)' : 'var(--color-error)'" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <!-- Moc 0 (equity bat dau tu 0) -->
              <line
                x1="0" :y1="eqChart.zeroY" x2="1000" :y2="eqChart.zeroY"
                class="stroke-muted/60"
                stroke-dasharray="6 6"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
              <path :d="eqChart.area" fill="url(#eqFill)" />
              <path
                :d="eqChart.line"
                fill="none"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                :class="eqChart.last >= 0 ? 'stroke-success' : 'stroke-error'"
              />
            </svg>
            <div class="absolute right-1 -translate-y-1/2 text-[10px] font-mono text-dimmed bg-elevated/70 px-1 rounded" :style="{ top: `${eqChart.zeroY}%` }">0%</div>
            <div class="absolute top-0 right-1 text-[10px] font-mono text-success/80 bg-elevated/70 px-1 rounded">{{ fmtPct(eqChart.peak) }}</div>
            <div class="absolute bottom-0 right-1 text-[10px] font-mono text-error/80 bg-elevated/70 px-1 rounded">{{ fmtPct(eqChart.trough) }}</div>
          </div>
        </div>
      </UCard>
      <UCard v-else-if="data && !isLoading">
        <AdminEmptyState :title="t('runs.detail.equityEmpty')" icon="i-lucide-chart-no-axes-combined" />
      </UCard>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- D1: stamp phien ban -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.detail.stamp') }}</h3>
            </div>
          </template>

          <dl class="space-y-3 text-xs">
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.detail.seriesId') }}</dt>
              <dd class="flex items-center gap-1.5 min-w-0">
                <code class="text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono break-all">{{ seriesId }}</code>
                <UButton icon="i-lucide-copy" variant="ghost" color="neutral" size="xs" @click="copyText(seriesId)" />
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.mode') }}</dt>
              <dd><UBadge label="BACKTEST" color="primary" variant="subtle" size="xs" class="font-mono" /></dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.engineVersion') }}</dt>
              <dd class="font-mono text-highlighted">{{ data?.engineVersion }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.detail.preset') }}</dt>
              <dd class="font-mono" :class="data?.preset ? 'text-highlighted' : 'text-dimmed'">{{ data?.preset || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.detail.dataset') }}</dt>
              <dd class="text-muted font-mono">{{ data?.rawTrades ?? '—' }} <span class="text-dimmed">→ {{ trades.length }}</span></dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.paramsHash') }}</dt>
              <dd class="flex items-center gap-1.5 min-w-0">
                <code class="text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono break-all">{{ data?.paramsHash }}</code>
                <UButton icon="i-lucide-copy" variant="ghost" color="neutral" size="xs" @click="copyText(data?.paramsHash || '')" />
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.dataHash') }}</dt>
              <dd class="flex flex-col items-end gap-1 min-w-0">
                <code
                  v-for="h in data?.dataHashes ?? []"
                  :key="h"
                  class="text-[11px] text-muted bg-elevated/50 px-1.5 py-0.5 rounded font-mono break-all"
                >{{ h }}</code>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.gitRev') }}</dt>
              <dd class="font-mono text-muted break-all">{{ data?.gitRev || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.market') }}</dt>
              <dd class="text-highlighted">{{ data?.market || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted shrink-0">{{ t('runs.lastRun') }}</dt>
              <dd class="text-right">
                <time v-if="data" :datetime="data.lastRunAt" class="text-highlighted">
                  {{ new Date(data.lastRunAt).toISOString().replace('T', ' ').slice(0, 19) }} UTC
                </time>
                <div v-if="data && data.summary.runs !== 1" class="text-[10px] text-dimmed">
                  {{ t('runs.firstRun') }}
                  <time :datetime="data.firstRunAt">{{ new Date(data.firstRunAt).toISOString().slice(0, 19).replace('T', ' ') }} UTC</time>
                </div>
              </dd>
            </div>
          </dl>
        </UCard>

        <!-- Tham so -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sliders-horizontal" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.detail.params') }}</h3>
              <UBadge :label="`${params.length}`" variant="subtle" size="xs" />
            </div>
          </template>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs max-h-72 overflow-y-auto">
            <div v-for="p in params" :key="p.key" class="flex flex-col min-w-0">
              <span class="text-dimmed font-mono truncate">{{ p.key }}</span>
              <span class="text-highlighted font-medium truncate" :title="p.value">{{ p.value }}</span>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Bang lenh -->
      <UCard :ui="{ body: 'p-3 sm:p-3 pr-0 sm:pr-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-list-ordered" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.detail.trades') }}</h3>
              <UBadge :label="`${trades.length}`" variant="subtle" size="xs" />
              <UBadge
                v-if="data && data.duplicateTrades > 0"
                :label="t('runs.warn.duplicatesRemoved')"
                color="warning"
                variant="subtle"
                size="xs"
              />
            </div>
            <AdminViewModeToggle v-model="viewMode" />
          </div>
        </template>

        <div class="relative h-110">
          <LazyGridList
            :items="trades"
            :columns="columns"
            :loading="isLoading"
            :can-load-more="false"
            v-model:view-mode="viewMode"
            item-key="entryTime"
            storage-key="run-detail-view-mode"
            @refresh="load"
          >
            <template #entryTime="{ item }">
              <time :datetime="item.entryTime" class="text-[11px] text-muted font-mono">
                {{ new Date(item.entryTime).toISOString().slice(0, 16).replace('T', ' ') }}
              </time>
            </template>

            <template #dir="{ item }">
              <UBadge
                :label="item.dir > 0 ? 'LONG' : 'SHORT'"
                :color="item.dir > 0 ? 'success' : 'error'"
                variant="subtle"
                size="xs"
                class="font-mono"
              />
            </template>

            <template #entryPrice="{ item }">
              <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.entryPrice) }}</span>
            </template>

            <template #exit="{ item }">
              <span class="text-[11px] text-muted font-mono truncate">
                {{ fmtPrice(item.exitPrice) }}
                <span v-if="item.exitTime" class="text-dimmed">· {{ new Date(item.exitTime).toISOString().slice(5, 16).replace('T', ' ') }}</span>
              </span>
            </template>

            <template #result="{ item }">
              <UBadge :label="item.result" :color="resultColor(item.result)" variant="subtle" size="xs" class="font-mono" />
            </template>

            <template #pnlPct="{ item }">
              <span
                class="text-xs font-semibold font-mono"
                :class="(item.pnlPct ?? 0) > 0 ? 'text-success' : (item.pnlPct ?? 0) < 0 ? 'text-error' : 'text-muted'"
              >{{ fmtPct(item.pnlPct) }}</span>
            </template>

            <template #rMultiple="{ item }">
              <span
                class="text-xs font-mono"
                :class="(item.rMultiple ?? 0) > 0 ? 'text-success' : (item.rMultiple ?? 0) < 0 ? 'text-error' : 'text-muted'"
              >{{ fmtR(item.rMultiple) }}</span>
            </template>

            <template #barsHeld="{ item }">
              <span class="text-[11px] text-muted">{{ item.barsHeld ?? '—' }}</span>
            </template>

            <template #mobile-content="{ item }">
              <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 text-xs">
                    <UBadge
                      :label="item.dir > 0 ? 'LONG' : 'SHORT'"
                      :color="item.dir > 0 ? 'success' : 'error'"
                      variant="subtle"
                      size="xs"
                    />
                    <UBadge :label="item.result" :color="resultColor(item.result)" variant="subtle" size="xs" />
                    <time :datetime="item.entryTime" class="text-[10px] text-muted font-mono">
                      {{ new Date(item.entryTime).toISOString().slice(5, 16).replace('T', ' ') }}
                    </time>
                  </div>
                  <div class="text-[11px] text-muted font-mono mt-1">
                    {{ fmtPrice(item.entryPrice) }} → {{ fmtPrice(item.exitPrice) }}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div
                    class="text-xs font-semibold font-mono"
                    :class="(item.pnlPct ?? 0) > 0 ? 'text-success' : (item.pnlPct ?? 0) < 0 ? 'text-error' : 'text-muted'"
                  >{{ fmtPct(item.pnlPct) }}</div>
                  <div class="text-[10px] text-dimmed font-mono">{{ fmtR(item.rMultiple) }}</div>
                </div>
              </div>
            </template>

            <template #empty>
              <AdminEmptyState :title="t('runs.detail.noTrades')" icon="i-lucide-list-ordered" />
            </template>
          </LazyGridList>
        </div>
      </UCard>

      <!-- Slice 3: run -> strategy-version lineage (reverse evidence pointer) -->
      <UCard v-if="data">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.detail.lineage.title') }}</h3>
              <span class="text-[11px] text-dimmed">{{ t('runs.detail.lineage.desc') }}</span>
            </div>
            <UBadge :label="String(lineage.length)" variant="subtle" size="xs" />
          </div>
        </template>

        <div v-if="lineage.length" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            v-for="row in lineage"
            :key="row.strategyVersionId"
            class="flex items-center justify-between gap-3 rounded border border-default/60 px-3 py-2"
          >
            <div class="min-w-0">
              <NuxtLink
                v-if="row.strategyId"
                :to="`/strategy-lab/${encodeURIComponent(row.strategyId)}`"
                class="block font-mono text-xs text-highlighted truncate hover:underline"
              >{{ row.strategyVersionId }}</NuxtLink>
              <span v-else class="block font-mono text-xs text-dimmed truncate">{{ row.strategyVersionId }}</span>
              <span class="text-[11px] text-dimmed truncate">{{ row.profileName || row.strategyId }}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <UBadge :label="stateLabel(row.status)" :color="stateColor(row.status)" variant="subtle" size="xs" />
              <UBadge v-if="row.backtest" :label="t('runs.detail.lineage.backtestEvidence')" color="primary" variant="subtle" size="xs" />
              <UBadge v-if="row.holdout" :label="t('runs.detail.lineage.holdoutEvidence')" color="info" variant="subtle" size="xs" />
            </div>
          </div>
        </div>
        <AdminEmptyState
          v-else
          :title="t('runs.detail.lineage.empty')"
          :description="t('runs.detail.lineage.emptyHint')"
          icon="i-lucide-git-branch"
        />
      </UCard>
    </div>
  </BasePage>
</template>
