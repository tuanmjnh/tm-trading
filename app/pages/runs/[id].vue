<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { RunSeriesDetail, RunTrade } from '~~/types/runs'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const runsApi = useRuns()

const seriesId = computed(() => String(route.params.id ?? ''))
const data = ref<RunSeriesDetail | null>(null)
const isLoading = ref(true)
const { viewMode } = useAdminGridView('run-detail-view-mode')

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
}

onMounted(load)

const title = computed(() => (data.value ? `${data.value.symbol} · ${data.value.tf}m` : t('runs.detail.title')))
const description = computed(() => {
  const s = data.value
  if (!s) return t('runs.desc')
  return `${s.method} · v${s.engineVersion} · ${s.paramsHash.slice(0, 8)}`
})

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

const statCards = computed(() => {
  const s = data.value?.summary
  if (!s) return []
  return [
    { key: 'trades', label: t('runs.detail.stats.trades'), value: String(s.trades), hint: s.open ? `+${s.open} ${t('runs.open')}` : '' },
    { key: 'winRate', label: t('runs.detail.stats.winRate'), value: `${(s.winRate * 100).toFixed(1)}%`, hint: `${s.wins}W / ${s.losses}L` },
    { key: 'pf', label: t('runs.detail.stats.profitFactor'), value: s.profitFactor === null ? '∞' : s.profitFactor.toFixed(2), hint: '' },
    { key: 'net', label: t('runs.detail.stats.net'), value: `${s.netPct.toFixed(2)}%`, hint: t('runs.detail.stats.netHint'), color: s.netPct > 0 ? 'text-success' : s.netPct < 0 ? 'text-error' : 'text-highlighted' },
    { key: 'maxDD', label: t('runs.detail.stats.maxDD'), value: `${s.maxDrawdownPct.toFixed(2)}%`, hint: '' },
    { key: 'medianR', label: t('runs.detail.stats.medianR'), value: `${s.medianRr.toFixed(2)}R`, hint: `avg ${s.avgRr.toFixed(2)}R` },
    { key: 'expectancy', label: t('runs.detail.stats.expectancy'), value: `${s.expectancy.toFixed(3)}R`, hint: t('runs.detail.stats.expectancyHint'), color: s.expectancy > 0 ? 'text-success' : s.expectancy < 0 ? 'text-error' : 'text-highlighted' },
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
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-scale"
          :label="t('runs.compare.nav')"
          variant="soft"
          color="primary"
          size="sm"
          :to="`/runs/compare?ids=${encodeURIComponent(seriesId)}`"
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

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
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
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <UCard v-for="card in statCards" :key="card.key" class="hover:border-primary/40 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider truncate">{{ card.label }}</div>
              <div class="text-xl font-bold mt-1 truncate" :class="card.color || 'text-highlighted'">{{ card.value }}</div>
              <p v-if="card.hint" class="text-[10px] text-dimmed mt-0.5 truncate">{{ card.hint }}</p>
            </div>
          </div>
        </UCard>
      </div>

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
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('runs.engineVersion') }}</dt>
              <dd class="font-mono text-highlighted">{{ data?.engineVersion }}</dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('runs.paramsHash') }}</dt>
              <dd class="flex items-center gap-1.5 min-w-0">
                <code class="text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono break-all">{{ data?.paramsHash }}</code>
                <UButton icon="i-lucide-copy" variant="ghost" color="neutral" size="xs" @click="copyText(data?.paramsHash || '')" />
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('runs.dataHash') }}</dt>
              <dd class="flex flex-col items-end gap-1 min-w-0">
                <code
                  v-for="h in data?.dataHashes ?? []"
                  :key="h"
                  class="text-[11px] text-muted bg-elevated/50 px-1.5 py-0.5 rounded font-mono break-all"
                >{{ h }}</code>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('runs.gitRev') }}</dt>
              <dd class="font-mono text-muted break-all">{{ data?.gitRev || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('runs.market') }}</dt>
              <dd class="text-highlighted">{{ data?.market || '—' }}</dd>
            </div>
            <div class="flex items-start justify-between gap-4">
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
    </div>
  </BasePage>
</template>
