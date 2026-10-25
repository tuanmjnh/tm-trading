<script setup lang="ts">
import type { LiveAccount } from '#shared/types/positions'
import type { RiskAccountDay } from '#shared/types/risk'
import { getErrorMessage } from '~/shared/utils/errors'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'

// =============================================================================
//  Paper Account overview (roadmap §20, §21, §58.5 /paper). Account-level
//  equity, risk, exposure and PnL. Every number is the SERVER projection from
//  persisted positions (D1/D12) — this page only formats, never computes.
//  Distinct from /trading/accounts (per-account activity) and the /trade
//  terminal's live desk (§58.6).
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'paper.title',
  descKey: 'paper.desc'
})
const paper = usePaperAccounts()
const { version: workspaceVersion } = useTradingWorkspace()
const { loading: isLoading, error: loadError, hasError, isStale, run } = useResourceState()

const ACCOUNT = 'default'
const account = ref<LiveAccount | null>(null)
const risk = ref<RiskAccountDay[] | null>(null)
const riskDay = ref('')
const mongoDown = ref(false)

async function load() {
  await run(async () => {
    const [acc, riskRes] = await Promise.all([paper.account(ACCOUNT), paper.riskStatus()])
    account.value = acc
    risk.value = riskRes?.accounts ?? null
    riskDay.value = riskRes?.day ?? ''
    mongoDown.value = riskRes ? riskRes.mongo === 'down' : !acc
  })
  if (hasError.value) notify.error(t('paper.title'), getErrorMessage(loadError.value, key => t(key)))
}
onMounted(load)
// §61.17 Phase C: account/order/fill events change the account projection —
// refetch when the workspace says this view changed.
watch(workspaceVersion('paper'), load)

const fmtMoney = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const fmtNum = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}%`
const moneyClass = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const pnlClass = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'text-dimmed' : v >= 0 ? 'text-success' : 'text-error'

const modeColor = (m: string): 'primary' | 'info' => (m === 'LIVE_PAPER' ? 'primary' : 'info')

const metrics = computed<MetricItem[]>(() => {
  const a = account.value
  if (!a) return []
  const tone = (v: number | null | undefined): MetricItem['tone'] => (v == null ? 'default' : v > 0 ? 'success' : v < 0 ? 'error' : 'default')
  return [
    { key: 'balance', label: t('paper.balance'), value: fmtNum(a.balance), icon: 'i-lucide-wallet', tone: 'primary' },
    { key: 'realized', label: t('paper.realized'), value: fmtMoney(a.realizedPnl), icon: 'i-lucide-trending-up', tone: tone(a.realizedPnl) },
    { key: 'dailyPnl', label: t('paper.dailyPnl'), value: fmtMoney(a.dailyPnl), icon: 'i-lucide-calendar-days', tone: tone(a.dailyPnl) },
    { key: 'unrealized', label: t('paper.unrealized'), value: fmtMoney(a.unrealized), icon: 'i-lucide-line-chart', tone: tone(a.unrealized) },
    { key: 'openPositions', label: t('paper.openPositions'), value: String(a.openPositions), icon: 'i-lucide-layers', tone: a.openPositions > 0 ? 'success' : 'default' },
    { key: 'notional', label: t('paper.notional'), value: fmtNum(a.notional), icon: 'i-lucide-banknote' },
    { key: 'freeMargin', label: t('paper.freeMargin'), value: fmtNum(a.freeMargin), icon: 'i-lucide-piggy-bank' },
    { key: 'utilization', label: t('paper.utilization'), value: fmtPct(a.utilizationPct), icon: 'i-lucide-gauge', tone: a.utilizationPct >= 80 ? 'error' : a.utilizationPct >= 50 ? 'warning' : 'default' },
    { key: 'maxDrawdown', label: t('paper.maxDrawdown'), value: a.maxDrawdownPct != null ? `${fmtNum(a.maxDrawdown)} (${fmtPct(a.maxDrawdownPct)})` : fmtNum(a.maxDrawdown), icon: 'i-lucide-trending-down', tone: a.maxDrawdownPct != null ? 'error' : 'default' },
    { key: 'maintenance', label: t('paper.maintenance'), value: fmtNum(a.maintenance), icon: 'i-lucide-wrench' }
  ]
})

const trail = computed(() => [{ label: t('nav.trading') }, { label: title.value }])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
mobileBar.registerInfo(computed(() => ({
  count: account.value?.openPositions ?? 0,
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="paper" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('paper.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown"
          :label="t('paper.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="account?.mode"
          :label="account.mode"
          :color="modeColor(account.mode)"
          variant="subtle"
          size="xs"
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

    <div class="flex flex-col w-full gap-3 pb-24 lg:pb-6">
      <SharedRefreshNotice
        :stale="isStale"
        :retrying="isLoading"
        :message="t('common.staleData')"
        @retry="load"
      />

      <!-- Equity summary -->
      <div
        v-if="account"
        class="rounded bg-default ring ring-default p-3 flex flex-col gap-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.equity') }}</span>
          <UBadge
            v-if="account.liquidated"
            :label="t('paper.liquidated')"
            color="error"
            variant="subtle"
            size="xs"
          />
        </div>
        <div class="flex flex-col">
          <span class="text-3xl font-bold font-mono text-highlighted">{{ fmtNum(account.equity) }}</span>
          <span class="text-[11px] text-muted font-mono">
            {{ t('paper.currency') }} {{ account.currency ?? '—' }} · {{ t('paper.initialBalance') }} {{ fmtNum(account.initialBalance) }}
          </span>
        </div>
      </div>

      <!-- Key metrics grid -->
      <SharedMetricRibbon v-if="account" :items="metrics" />

      <!-- Risk gate status (D7 kill-switch) -->
      <section class="rounded bg-default ring ring-default p-3 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.riskGate') }}</span>
          <span v-if="riskDay" class="text-[10px] text-dimmed font-mono">{{ riskDay }} UTC</span>
        </div>
        <p v-if="!risk || !risk.length" class="text-[11px] text-dimmed">{{ t('paper.riskEmpty') }}</p>
        <div v-else class="flex flex-col gap-1.5">
          <div
            v-for="a in risk"
            :key="a.account"
            class="flex items-center justify-between gap-2 rounded bg-elevated/50 px-3 py-2"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xs font-semibold text-highlighted truncate">{{ a.account }}</span>
              <UBadge
                v-if="a.halted"
                :label="t('paper.halted')"
                color="error"
                variant="subtle"
                size="xs"
              />
              <UBadge v-else :label="t('paper.clear')" color="success" variant="subtle" size="xs" />
            </div>
            <div class="flex items-center gap-3 text-[11px] font-mono shrink-0">
              <span class="text-muted">{{ t('paper.trades') }} {{ a.tradesOpened }}/{{ a.tradesClosed }}</span>
              <span :class="moneyClass(a.realizedPnlAbs)">{{ fmtMoney(a.realizedPnlAbs) }}</span>
              <span v-if="a.halted && a.haltReason" class="text-error truncate max-w-40" :title="a.haltReason">{{ a.haltReason }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Terminal / Positions deep-links -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <UButton icon="i-lucide-panel-top-open" :label="t('paper.openTerminal')" variant="soft" color="primary" to="/trading" />
        <UButton icon="i-lucide-list-checks" :label="t('paper.openPositions')" variant="soft" color="neutral" to="/trading/positions" />
      </div>

      <AdminEmptyState
        v-if="hasError && !account"
        :title="t('common.loadErrorTitle')"
        :description="t('common.loadErrorHint')"
        icon="i-lucide-triangle-alert"
        :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: load }]"
      />
      <AdminEmptyState
        v-else-if="!isLoading && !account"
        :title="t('paper.empty')"
        :description="t('paper.emptyHint')"
        icon="i-lucide-wallet"
      />
    </div>
  </BasePage>
</template>
