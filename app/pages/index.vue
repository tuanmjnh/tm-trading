<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { RunSeries } from '~~/types/runs'
import type { RiskStatusData } from '~~/types/risk'
import type { IntelData, IntelZone } from '~~/types/intel'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { viewMode } = useAdminGridView('home-runs')
const { buildRowActions } = useAdminRowActions()
const runsApi = useRuns()
const riskApi = useRisk()
const intelApi = useIntel()

const series = ref<RunSeries[]>([])
const isLoading = ref(true)
const errorMessage = ref('')

// Trang thai risk gate + drift (Phase 7) — doc fail-soft, khong 500.
const risk = ref<RiskStatusData | null>(null)
const isRiskLoading = ref(false)

// Market intel + heartbeat D9 (Phase 8) — doc fail-soft, khong 500.
const intel = ref<IntelData | null>(null)
const isIntelLoading = ref(false)

async function loadRuns() {
  isLoading.value = true
  try {
    const res = await runsApi.list({ limit: 100 })
    series.value = res.items
    errorMessage.value = res.meta?.filesMissing ? 'runs.empty' : ''
  } catch (err) {
    series.value = []
    errorMessage.value = getErrorMessage(err, key => t(key))
  } finally {
    isLoading.value = false
  }
}

async function loadRisk() {
  isRiskLoading.value = true
  try {
    risk.value = await riskApi.status()
  } catch {
    risk.value = null
  } finally {
    isRiskLoading.value = false
  }
}

async function loadIntel() {
  isIntelLoading.value = true
  try {
    intel.value = await intelApi.get()
  } catch {
    intel.value = null
  } finally {
    isIntelLoading.value = false
  }
}

/** ISO -> "YYYY-MM-DD HH:mm UTC" (khong phu thuoc mui gio may — D2). */
function fmtUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

onMounted(() => {
  loadRuns()
  loadRisk()
  loadIntel()
})

const recentRuns = computed(() => series.value.slice(0, 12))

const totalRuns = computed(() => series.value.reduce((s, i) => s + i.summary.runs, 0))
const totalTrades = computed(() => series.value.reduce((s, i) => s + i.summary.trades, 0))
/** Chi dem canh bao du lieu that (multipleRuns = thong tin binh thuong, khong dem). */
const dataWarnings = computed(() =>
  series.value.reduce((s, i) => s + i.warnings.filter(w => w !== 'multipleRuns').length, 0)
)

const cards = computed(() => [
  {
    key: 'series',
    label: t('dashboard.series'),
    value: String(series.value.length),
    hint: t('dashboard.seriesHint'),
    icon: 'i-lucide-layers-3',
    // Class day du (khong dung template string) de Tailwind scan thay va sinh class.
    valueClass: 'text-primary-500 dark:text-primary-400',
    iconClass: 'bg-primary/10 text-primary-500'
  },
  {
    key: 'runs',
    label: t('dashboard.totalRuns'),
    value: String(totalRuns.value),
    hint: t('dashboard.totalRunsHint'),
    icon: 'i-lucide-flask-conical',
    valueClass: 'text-emerald-500 dark:text-emerald-400',
    iconClass: 'bg-emerald-500/10 text-emerald-500'
  },
  {
    key: 'trades',
    label: t('dashboard.totalTrades'),
    value: String(totalTrades.value),
    hint: t('dashboard.totalTradesHint'),
    icon: 'i-lucide-list-ordered',
    valueClass: 'text-indigo-500 dark:text-indigo-400',
    iconClass: 'bg-indigo-500/10 text-indigo-500'
  },
  {
    key: 'warnings',
    label: t('dashboard.dataWarnings'),
    value: String(dataWarnings.value),
    hint: t('dashboard.dataWarningsHint'),
    icon: 'i-lucide-triangle-alert',
    valueClass: dataWarnings.value > 0
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-cyan-500 dark:text-cyan-400',
    iconClass: dataWarnings.value > 0
      ? 'bg-amber-500/10 text-amber-500'
      : 'bg-cyan-500/10 text-cyan-500'
  }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('runs.symbol'), class: 'w-44' },
  { key: 'tf', label: t('runs.tf'), class: 'w-16' },
  { key: 'trades', label: t('runs.trades'), class: 'w-24' },
  { key: 'winRate', label: t('runs.winRate'), class: 'w-24' },
  { key: 'net', label: t('runs.net'), class: 'w-24' },
  { key: 'lastRunAt', label: t('runs.lastRun'), class: 'w-36' }
])

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const netColor = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')

/** OI notional USD -> "$123.4M" (null -> "—"). */
const fmtOi = (usd: number | null) =>
  usd == null ? '—' : `$${(usd / 1e6).toFixed(1)}M`
const svcAge = (sec: number) => `${Math.round(sec / 60)}m`

// --- Regime & Zones (Phase 9) — chi format, khong tinh toan lai (D1). ---
const seasonLabel = (s: string) =>
  s === 'alt' ? t('regime.seasonAlt') : s === 'btc' ? t('regime.seasonBtc') : t('regime.seasonNeutral')
const seasonColor = (s: string): 'success' | 'warning' | 'neutral' =>
  s === 'alt' ? 'success' : s === 'btc' ? 'warning' : 'neutral'

/** Flag he thong -> nhan doc duoc (i18n), khong ro -> nguyen bang. */
const flagLabel = (f: string): string => {
  if (f === 'fear-extreme') return t('regime.flagFear')
  if (f === 'greed-extreme') return t('regime.flagGreed')
  if (f === 'unlock-48h') return t('regime.flagUnlock')
  if (f.startsWith('supply-drift:')) return t('regime.flagSupply', { symbol: f.slice('supply-drift:'.length) })
  return f
}

/** Gia zone -> chuoi ngan (phu thuoc cap do gia). */
function fmtPx(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1000) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

/** Ước tính zone: top 2 mỗi phía theo usd da sort giam. */
const topEst = (z: IntelZone, side: 'long' | 'short') => z.est.filter((e) => e.side === side).slice(0, 2)

// --- Confluence (Phase 10) — chi format diem da tinh o services/confluence.mjs (D1). ---
/** Diem [-1,1] -> "+0.31" / "-0.08" (lam tron truoc de tranh "-0.00"; NaN -> "—"). */
const fmtScore = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  const r = Math.round(v * 100) / 100
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`
}
/** Bang mau tong diem: duong -> xanh, am -> do, gan 0 -> xam. */
const confScoreClass = (v: number) => (v >= 0.15 ? 'text-success' : v <= -0.15 ? 'text-error' : 'text-muted')
/** Chip phan diem: mau theo dau (0 -> xam). */
const confPartClass = (v: number) => (v > 0 ? 'text-success bg-success/10' : v < 0 ? 'text-error bg-error/10' : 'text-dimmed bg-default/50')

function openRun(item: RunSeries) {
  navigateTo(`/runs/${encodeURIComponent(item.id)}`)
}

const rowActions = (item: RunSeries) => buildRowActions([
  { type: 'view', onSelect: () => openRun(item) }
])

useHead({ title: computed(() => t('dashboard.title')) })
</script>

<template>
  <BasePage id="home" :title="t('dashboard.title')" :description="t('dashboard.description')">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-flask-conical"
          :label="t('runs.title')"
          variant="soft"
          color="primary"
          size="sm"
          to="/runs"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="loadRuns"
        />
      </div>
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <UAlert
        v-if="errorMessage"
        color="warning"
        variant="subtle"
        icon="i-lucide-database-zap"
        :title="t('runs.empty')"
        :description="errorMessage === 'runs.empty' ? t('runs.emptyHint') : errorMessage"
      />

      <!-- KPI -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <UCard v-for="card in cards" :key="card.key" class="hover:border-primary/50 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-medium text-muted uppercase tracking-wider truncate">{{ card.label }}</div>
              <div class="text-2xl font-bold mt-1.5" :class="card.valueClass">
                {{ card.value }}
              </div>
              <p class="text-[11px] text-muted mt-1 truncate">{{ card.hint }}</p>
            </div>
            <div class="p-3 rounded-xl shrink-0" :class="card.iconClass">
              <UIcon :name="card.icon" class="flex w-5 h-5" />
            </div>
          </div>
        </UCard>
      </div>

      <!-- Risk gate + drift (Phase 7) -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('risk.title') }}</h3>
              <UBadge
                v-if="risk"
                :label="`${t('risk.day')} ${risk.day}`"
                variant="subtle"
                size="xs"
                class="font-mono"
              />
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="xs"
              :loading="isRiskLoading"
              @click="loadRisk"
            />
          </div>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Risk gate -->
          <div class="space-y-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <UBadge
                v-if="!risk"
                color="warning"
                variant="subtle"
                size="sm"
                :label="t('risk.loadFailed')"
                icon="i-lucide-triangle-alert"
              />
              <UBadge
                v-else-if="risk.mongo === 'down'"
                color="warning"
                variant="subtle"
                size="sm"
                :label="t('risk.mongoDown')"
                icon="i-lucide-database-zap"
              />
              <UBadge
                v-else-if="!risk.accounts.length"
                color="neutral"
                variant="subtle"
                size="sm"
                :label="t('risk.noData')"
                icon="i-lucide-circle-dashed"
              />
              <UBadge
                v-for="a in risk?.accounts ?? []"
                :key="a.account"
                :color="a.halted ? 'error' : 'success'"
                variant="subtle"
                size="sm"
                :label="a.halted ? `${t('risk.halted')} · ${a.account}` : `${t('risk.active')} · ${a.account}`"
                :icon="a.halted ? 'i-lucide-octagon-x' : 'i-lucide-circle-check'"
              />
            </div>

            <p
              v-if="!risk?.accounts.length && (risk?.mongo === 'up')"
              class="text-[11px] text-dimmed leading-relaxed"
            >{{ t('risk.noDataHint') }}</p>

            <div
              v-for="a in risk?.accounts ?? []"
              :key="`stats-${a.account}`"
              class="rounded-lg border border-default/50 p-3"
            >
              <p v-if="a.halted && a.haltReason" class="text-[11px] text-error mb-2">
                {{ t('risk.haltReason') }}: {{ a.haltReason }}
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="min-w-0">
                  <div class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('risk.realizedPnl') }}</div>
                  <div class="text-sm font-bold font-mono mt-0.5" :class="netColor(a.realizedPnlPct)">
                    {{ fmtPct(a.realizedPnlPct) }}
                  </div>
                </div>
                <div class="min-w-0">
                  <div class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('risk.opened') }}</div>
                  <div class="text-sm font-semibold text-highlighted font-mono mt-0.5">{{ a.tradesOpened }}</div>
                </div>
                <div class="min-w-0">
                  <div class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('risk.closed') }}</div>
                  <div class="text-sm font-semibold text-highlighted font-mono mt-0.5">{{ a.tradesClosed }}</div>
                </div>
                <div class="min-w-0">
                  <div class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('risk.streak') }}</div>
                  <div
                    class="text-sm font-semibold font-mono mt-0.5"
                    :class="a.consecutiveLosses > 0 ? 'text-warning' : 'text-highlighted'"
                  >{{ a.consecutiveLosses }}</div>
                </div>
              </div>
            </div>

            <div
              v-if="risk?.mongo === 'up'"
              class="flex items-center justify-between text-xs border-t border-default/50 pt-2"
            >
              <span class="text-muted">{{ t('risk.openPositions') }}</span>
              <span class="font-semibold text-highlighted font-mono">{{ risk.openPositions }}</span>
            </div>
          </div>

          <!-- Drift (D8) -->
          <div class="space-y-3 min-w-0 md:border-l md:border-default/50 md:pl-6">
            <div class="flex items-center gap-2 flex-wrap">
              <UIcon name="i-lucide-activity" class="w-4 h-4 text-muted" />
              <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('risk.drift') }}</h4>
              <UBadge
                v-if="risk?.drift?.breach"
                color="error"
                variant="subtle"
                size="sm"
                :label="t('risk.driftBreach')"
              />
              <UBadge
                v-else-if="risk?.drift"
                color="success"
                variant="subtle"
                size="sm"
                :label="t('risk.driftOk')"
              />
              <UBadge v-else color="neutral" variant="subtle" size="sm" :label="t('risk.driftIdle')" />
            </div>
            <p v-if="risk?.drift" class="text-xs text-muted leading-relaxed">
              {{ t('risk.driftLast') }}: {{ fmtUtc(risk.drift.lastCheckAt) }} ·
              {{ risk.drift.checked }} {{ t('risk.driftPairs') }} · {{ risk.drift.windowH }}h
            </p>
            <p v-else class="text-xs text-muted leading-relaxed">{{ t('risk.driftHint') }}</p>
          </div>
        </div>
      </UCard>

      <!-- Market Intel + heartbeat D9 (Phase 8) -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-radar" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('intel.title') }}</h3>
              <UBadge
                v-if="intel?.generatedAt"
                :label="fmtUtc(intel.generatedAt)"
                variant="subtle"
                size="xs"
                class="font-mono"
              />
              <UBadge
                v-if="intel && intel.mongo === 'down'"
                color="warning"
                variant="subtle"
                size="xs"
                :label="t('intel.mongoDown')"
                icon="i-lucide-database-zap"
              />
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="xs"
              :loading="isIntelLoading"
              @click="loadIntel"
            />
          </div>
        </template>

        <!-- Heartbeat D9: service qua han 2 x chu ky -> chip do (test: tat 1 job) -->
        <div class="flex items-center gap-2 flex-wrap mb-4">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.services') }}</span>
          <UBadge
            v-if="!intel?.services?.length"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="t('intel.noServices')"
            icon="i-lucide-circle-dashed"
          />
          <UBadge
            v-for="s in intel?.services ?? []"
            :key="s.name"
            :color="s.overdue ? 'error' : 'success'"
            variant="subtle"
            size="sm"
            :icon="s.overdue ? 'i-lucide-heart-off' : 'i-lucide-heart-pulse'"
            :label="s.overdue ? `${s.name} · ${t('intel.overdue')} ${svcAge(s.overdueSec)}` : `${s.name} · ${svcAge(s.overdueSec)}`"
          />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <!-- Movers 24h -->
          <div class="space-y-2 min-w-0">
            <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('intel.movers') }}</h4>
            <p v-if="!intel?.movers?.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('intel.empty') }}</p>
            <div
              v-for="m in intel?.movers?.slice(0, 6) ?? []"
              :key="`mv-${m.symbol}`"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="flex items-center gap-1 min-w-0">
                <UIcon v-if="m.breakout" name="i-lucide-rocket" class="w-3.5 h-3.5 text-primary shrink-0" />
                <span class="font-semibold text-highlighted truncate">{{ m.symbol }}</span>
              </span>
              <span class="shrink-0">
                <span class="font-mono font-semibold" :class="netColor(m.pct24h)">{{ fmtPct(m.pct24h, 1) }}</span>
                <span class="text-dimmed font-mono"> · 4h {{ fmtPct(m.chg4h, 1) }}</span>
              </span>
            </div>
          </div>

          <!-- Dòng tiền -->
          <div class="space-y-2 min-w-0 md:border-l md:border-default/50 md:pl-6">
            <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('intel.flows') }}</h4>
            <p v-if="!intel?.flows?.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('intel.empty') }}</p>
            <div
              v-for="f in intel?.flows?.slice(0, 6) ?? []"
              :key="`fl-${f.symbol}`"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="flex items-center gap-1.5 min-w-0">
                <UIcon
                  :name="f.dir === 'buy' ? 'i-lucide-arrow-up-right' : f.dir === 'sell' ? 'i-lucide-arrow-down-right' : 'i-lucide-waves'"
                  class="w-3.5 h-3.5 shrink-0"
                  :class="f.dir === 'buy' ? 'text-success' : f.dir === 'sell' ? 'text-error' : 'text-warning'"
                />
                <span class="font-semibold text-highlighted truncate">{{ f.symbol }}</span>
              </span>
              <span class="text-dimmed font-mono shrink-0">
                {{ f.volRatio.toFixed(1) }}× · {{ (f.takerRatio * 100).toFixed(0) }}%
              </span>
            </div>
          </div>

          <!-- Gom hàng -->
          <div class="space-y-2 min-w-0 md:border-l md:border-default/50 md:pl-6">
            <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('intel.accums') }}</h4>
            <p v-if="!intel?.accums?.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('intel.empty') }}</p>
            <div
              v-for="a in intel?.accums?.slice(0, 6) ?? []"
              :key="`ac-${a.symbol}`"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="flex items-center gap-1.5 min-w-0">
                <UIcon name="i-lucide-minimize-2" class="w-3.5 h-3.5 text-info shrink-0" />
                <span class="font-semibold text-highlighted truncate">{{ a.symbol }}</span>
              </span>
              <span class="text-dimmed font-mono shrink-0">
                rng {{ a.rangePct.toFixed(1) }}% · Δ48 {{ fmtPct(a.priceChg48, 1) }}
              </span>
            </div>
          </div>

          <!-- Funding -->
          <div class="space-y-2 min-w-0 md:border-l md:border-default/50 md:pl-6">
            <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('intel.funding') }}</h4>
            <p v-if="!intel?.funding?.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('intel.empty') }}</p>
            <div
              v-for="fd in intel?.funding?.slice(0, 6) ?? []"
              :key="`fn-${fd.symbol}`"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="font-semibold text-highlighted truncate">{{ fd.symbol }}</span>
              <span class="shrink-0">
                <span class="font-mono font-semibold" :class="netColor(fd.pct)">{{ fmtPct(fd.pct, 4) }}</span>
                <span class="text-dimmed font-mono"> · {{ t('intel.oi') }} {{ fmtOi(fd.oiNotionalUsd) }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Tin noi bat (event news — chi med/high, TTL 7 ngay) -->
        <div
          v-if="intel?.news?.length"
          class="mt-5 pt-4 border-t border-default/50 space-y-1.5"
        >
          <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('intel.news') }}</h4>
          <div
            v-for="n in intel.news.slice(0, 3)"
            :key="n.link"
            class="flex items-center gap-2 text-xs min-w-0"
          >
            <UBadge
              :color="n.level === 'high' ? 'error' : 'warning'"
              variant="subtle"
              size="xs"
              :label="n.level === 'high' ? 'HIGH' : 'MED'"
            />
            <a
              :href="n.link"
              target="_blank"
              rel="noopener noreferrer"
              class="truncate hover:text-primary transition-colors"
              :class="n.dir === 'neg' ? 'text-error' : n.dir === 'pos' ? 'text-success' : 'text-muted'"
            >{{ n.title }}</a>
            <span class="text-dimmed shrink-0 text-[10px]">{{ n.source }}</span>
          </div>
        </div>
      </UCard>

      <!-- Regime & Zones (Phase 9) — doc fail-soft, cong voi Market Intel -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              <UIcon name="i-lucide-globe-2" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('regime.title') }}</h3>
              <template v-if="intel?.regime">
                <UBadge
                  :label="seasonLabel(intel.regime.season)"
                  :color="seasonColor(intel.regime.season)"
                  variant="subtle"
                  size="sm"
                />
                <UBadge
                  v-if="intel.regime.ts"
                  :label="fmtUtc(intel.regime.ts)"
                  variant="subtle"
                  size="xs"
                  class="font-mono"
                />
              </template>
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="xs"
              :loading="isIntelLoading"
              @click="loadIntel"
            />
          </div>
        </template>

        <p v-if="!intel?.regime" class="text-[11px] text-dimmed leading-relaxed">{{ t('regime.empty') }}</p>

        <template v-else>
          <!-- So lieu vua: ASI / F&G / BTC.D / MCap -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="rounded-lg bg-default/50 border border-default/50 p-3 space-y-1 min-w-0">
              <p class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.asi') }}</p>
              <p class="text-lg font-bold font-mono text-highlighted">{{ intel.regime.asi?.d90 ?? '—' }}</p>
              <p class="text-[10px] text-dimmed font-mono truncate">
                30 {{ intel.regime.asi?.d30 ?? '—' }} · 365 {{ intel.regime.asi?.d365 ?? '—' }}
              </p>
            </div>
            <div class="rounded-lg bg-default/50 border border-default/50 p-3 space-y-1 min-w-0">
              <p class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.fng') }}</p>
              <p
                class="text-lg font-bold font-mono"
                :class="intel.regime.fng ? (intel.regime.fng.value <= 25 ? 'text-error' : intel.regime.fng.value >= 75 ? 'text-success' : 'text-highlighted') : 'text-highlighted'"
              >{{ intel.regime.fng?.value ?? '—' }}</p>
              <p class="text-[10px] text-dimmed truncate">{{ intel.regime.fng?.classification || '—' }}</p>
            </div>
            <div class="rounded-lg bg-default/50 border border-default/50 p-3 space-y-1 min-w-0">
              <p class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.btcDom') }}</p>
              <p class="text-lg font-bold font-mono text-highlighted">{{ fmtPct(intel.regime.btcDom, 1) }}</p>
              <p class="text-[10px] text-dimmed font-mono truncate">ETH {{ fmtPct(intel.regime.ethDom, 1) }}</p>
            </div>
            <div class="rounded-lg bg-default/50 border border-default/50 p-3 space-y-1 min-w-0">
              <p class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.mcap') }}</p>
              <p class="text-lg font-bold font-mono" :class="netColor(intel.regime.mcapChg24h ?? 0)">{{ fmtPct(intel.regime.mcapChg24h, 2) }}</p>
              <p class="text-[10px] text-dimmed truncate">{{ t('regime.flags') }} · {{ intel.regime.flags.length }}</p>
            </div>
          </div>

          <!-- Co he thong + unlock 48h -->
          <div
            v-if="intel.regime.flags.length || intel.regime.unlocks48h.length"
            class="flex items-center gap-2 flex-wrap mb-4"
          >
            <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.flags') }}</span>
            <UBadge
              v-for="f in intel.regime.flags"
              :key="f"
              color="warning"
              variant="subtle"
              size="sm"
              icon="i-lucide-flag"
              :label="flagLabel(f)"
            />
            <UBadge
              v-for="u in intel.regime.unlocks48h"
              :key="`un-${u.symbol}`"
              color="info"
              variant="subtle"
              size="sm"
              icon="i-lucide-lock-open"
              :label="`${u.symbol} · ${u.date.slice(0, 10)}`"
            />
          </div>

          <!-- 2 cot: Alt sweep | Liquidation zones -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Alt sweep (filter alt-luot) -->
            <div class="space-y-2 min-w-0">
              <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('regime.sweep') }}</h4>
              <p v-if="!intel.regime.sweep.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('regime.sweepEmpty') }}</p>
              <div
                v-for="s in intel.regime.sweep.slice(0, 8)"
                :key="s.symbol"
                class="space-y-0.5"
              >
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="flex items-center gap-1.5 min-w-0">
                    <UBadge
                      :color="s.ok ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                      :label="s.ok ? t('regime.ok') : t('regime.blocked')"
                    />
                    <span class="font-semibold text-highlighted truncate">{{ s.symbol }}</span>
                  </span>
                  <span class="text-dimmed font-mono shrink-0">
                    {{ s.rate != null ? fmtPct(s.rate * 100, 4) : '—' }} · OI {{ s.oiTrendPct != null ? fmtPct(s.oiTrendPct, 1) : '—' }}
                  </span>
                </div>
                <p class="text-[10px] text-dimmed truncate pl-1">{{ (s.ok ? s.reasons : s.blockers).join(' · ') }}</p>
              </div>
            </div>

            <!-- Zone thanh ly (est gia mo + actual tu forceOrder) -->
            <div class="space-y-3 min-w-0 lg:border-l lg:border-default/50 lg:pl-6">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <h4 class="text-xs font-semibold text-highlighted uppercase tracking-wider">{{ t('regime.zones') }}</h4>
                <span class="text-[10px] text-dimmed">{{ t('regime.estNote') }}</span>
              </div>
              <p v-if="!intel.zones.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('regime.zonesEmpty') }}</p>
              <div
                v-for="z in intel.zones.slice(0, 6)"
                :key="z.symbol"
                class="space-y-1 text-xs min-w-0"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-highlighted truncate">{{ z.symbol }}</span>
                  <span class="text-dimmed font-mono shrink-0">
                    {{ fmtPx(z.markPx) }} · OI {{ fmtOi(z.oiUsd) }}<template v-if="z.lsRatio != null"> · L/S {{ z.lsRatio.toFixed(2) }}</template>
                  </span>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span
                    v-for="(e, i) in topEst(z, 'long')"
                    :key="`el-${z.symbol}-${i}`"
                    class="font-mono text-[10px] px-1 rounded text-error bg-error/10"
                  >▼{{ fmtPx(e.price) }} · {{ fmtOi(e.usd) }}</span>
                  <span
                    v-for="(e, i) in topEst(z, 'short')"
                    :key="`es-${z.symbol}-${i}`"
                    class="font-mono text-[10px] px-1 rounded text-warning bg-warning/10"
                  >▲{{ fmtPx(e.price) }} · {{ fmtOi(e.usd) }}</span>
                  <span
                    v-for="(a, i) in z.actual.slice(0, 2)"
                    :key="`ac-${z.symbol}-${i}`"
                    class="font-mono text-[10px] px-1 rounded text-info bg-info/10"
                  >{{ t('regime.actual') }} {{ fmtPx(a.price) }} · {{ fmtOi(a.usd) }}×{{ a.n }}</span>
                  <span v-if="!z.est.length && !z.actual.length" class="text-[10px] text-dimmed">{{ t('regime.zonesEmpty') }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </UCard>

      <!-- Confluence (Phase 10) — diem gop 4 nguon, doc snapshot (khong tinh lai — D1) -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              <UIcon name="i-lucide-git-merge" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('confluence.title') }}</h3>
              <UBadge
                v-if="intel?.confluence?.length"
                :label="t('confluence.daily')"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="intel?.confluence?.[0]?.ts"
                :label="fmtUtc(intel.confluence[0].ts)"
                variant="subtle"
                size="xs"
                class="font-mono"
              />
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="xs"
              :loading="isIntelLoading"
              @click="loadIntel"
            />
          </div>
        </template>

        <p v-if="!intel?.confluence?.length" class="text-[11px] text-dimmed leading-relaxed">{{ t('confluence.empty') }}</p>

        <template v-else>
          <!-- Cong trong so 4 phan (service da tinh, UI chi doc) -->
          <div class="flex items-center gap-2 flex-wrap mb-3 text-[10px] text-muted uppercase tracking-wider">
            <span>{{ t('confluence.weights') }}</span>
            <span class="font-mono normal-case tracking-normal">method 0.4 · regime 0.2 · funding 0.2 · zone 0.2</span>
            <span class="text-dimmed normal-case tracking-normal">— {{ t('confluence.legendNote') }}</span>
          </div>

          <div class="space-y-1.5">
            <div
              v-for="c in intel.confluence"
              :key="c.symbol"
              class="flex items-center justify-between gap-3 text-xs rounded-lg bg-default/50 border border-default/50 px-3 py-2 min-w-0"
            >
              <span class="flex items-center gap-2 min-w-0">
                <UBadge
                  :label="`#${c.rank || '—'}`"
                  variant="subtle"
                  size="xs"
                  class="font-mono w-8 justify-center shrink-0"
                />
                <span class="font-semibold text-highlighted truncate">{{ c.symbol }}</span>
              </span>
              <span class="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                <span class="px-1 rounded" :class="confPartClass(c.parts.method)">M {{ fmtScore(c.parts.method) }}</span>
                <span class="px-1 rounded" :class="confPartClass(c.parts.regime)">R {{ fmtScore(c.parts.regime) }}</span>
                <span class="px-1 rounded" :class="confPartClass(c.parts.funding)">F {{ fmtScore(c.parts.funding) }}</span>
                <span class="px-1 rounded" :class="confPartClass(c.parts.zone)">Z {{ fmtScore(c.parts.zone) }}</span>
              </span>
              <span class="font-mono font-bold text-sm shrink-0" :class="confScoreClass(c.score)">{{ fmtScore(c.score) }}</span>
            </div>
          </div>
        </template>
      </UCard>

      <!-- Recent Runs -->
      <UCard :ui="{ body: 'p-3 sm:p-3 pr-0 sm:pr-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-history" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('dashboard.recentRuns') }}</h3>
              <UBadge :label="`${series.length} ${t('runs.title')}`" variant="subtle" size="xs" />
            </div>
            <div class="flex items-center gap-2">
              <UButton
                variant="ghost"
                color="primary"
                size="xs"
                :label="t('dashboard.viewAll')"
                trailing-icon="i-lucide-arrow-right"
                to="/runs"
              />
              <AdminViewModeToggle v-model="viewMode" />
            </div>
          </div>
        </template>

        <div class="relative h-110">
          <LazyGridList
            :items="recentRuns"
            :columns="columns"
            :loading="isLoading"
            :can-load-more="false"
            :action-options="rowActions"
            v-model:view-mode="viewMode"
            item-key="id"
            storage-key="home-runs"
            hide-header
            @refresh="loadRuns"
            @click="openRun"
          >
            <template #symbol="{ item }">
              <div class="flex flex-col min-w-0 gap-0.5">
                <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol }}</span>
                <span class="text-[10px] text-dimmed font-mono truncate">{{ item.method }} · v{{ item.engineVersion }}</span>
              </div>
            </template>

            <template #tf="{ item }">
              <span class="text-xs text-muted">{{ item.tf }}m</span>
            </template>

            <template #trades="{ item }">
              <span class="text-xs text-highlighted">{{ item.summary.trades }}</span>
            </template>

            <template #winRate="{ item }">
              <span class="text-xs text-muted">{{ fmtPct(item.summary.winRate * 100, 1) }}</span>
            </template>

            <template #net="{ item }">
              <span class="text-xs font-semibold" :class="netColor(item.summary.netPct)">
                {{ fmtPct(item.summary.netPct) }}
              </span>
            </template>

            <template #lastRunAt="{ item }">
              <time :datetime="item.lastRunAt" class="text-[11px] text-muted">
                {{ formatTimeAgo(new Date(item.lastRunAt)) }}
              </time>
            </template>

            <template #mobile-content="{ item }">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                    <span class="text-muted shrink-0">{{ item.tf }}m</span>
                  </div>
                  <div class="text-[11px] text-dimmed mt-0.5">
                    {{ t('runs.trades') }} {{ item.summary.trades }} · WR {{ fmtPct(item.summary.winRate * 100, 1) }}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-xs font-semibold" :class="netColor(item.summary.netPct)">
                    {{ fmtPct(item.summary.netPct) }}
                  </div>
                  <time :datetime="item.lastRunAt" class="text-[10px] text-muted">
                    {{ formatTimeAgo(new Date(item.lastRunAt)) }}
                  </time>
                </div>
              </div>
            </template>

            <template #empty>
              <AdminEmptyState
                :title="t('runs.empty')"
                :description="t('runs.emptyHint')"
                icon="i-lucide-flask-conical"
                :actions="[{ label: t('common.refresh'), icon: 'i-lucide-refresh-cw', onClick: loadRuns }]"
              />
            </template>
          </LazyGridList>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
