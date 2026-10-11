<script setup lang="ts">
import type { LiveAccount } from '~~/types/positions'
import type { RiskAccountDay } from '~~/types/risk'
import { getErrorMessage } from '~/shared/utils/errors'

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

const ACCOUNT = 'default'
const account = ref<LiveAccount | null>(null)
const risk = ref<RiskAccountDay[] | null>(null)
const riskDay = ref('')
const mongoDown = ref(false)
const isLoading = ref(false)

async function load() {
  isLoading.value = true
  try {
    const [acc, riskRes] = await Promise.all([paper.account(ACCOUNT), paper.riskStatus()])
    account.value = acc
    risk.value = riskRes?.accounts ?? null
    riskDay.value = riskRes?.day ?? ''
    mongoDown.value = riskRes ? riskRes.mongo === 'down' : !acc
  } catch (err) {
    notify.error(t('paper.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoading.value = false
  }
}
onMounted(load)

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

const utilizationClass = (v: number) => (v >= 80 ? 'text-error' : v >= 50 ? 'text-warning' : 'text-highlighted')

const modeColor = (m: string): 'primary' | 'info' => (m === 'LIVE_PAPER' ? 'primary' : 'info')

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

    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <!-- Equity summary -->
      <div
        v-if="account"
        class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3"
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
      <div
        v-if="account"
        class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2"
      >
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.balance') }}</span>
          <span class="text-sm font-bold font-mono text-highlighted">{{ fmtNum(account.balance) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.realized') }}</span>
          <span class="text-sm font-bold font-mono" :class="moneyClass(account.realizedPnl)">{{ fmtMoney(account.realizedPnl) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.dailyPnl') }}</span>
          <span class="text-sm font-bold font-mono" :class="moneyClass(account.dailyPnl)">{{ fmtMoney(account.dailyPnl) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.unrealized') }}</span>
          <span class="text-sm font-bold font-mono" :class="moneyClass(account.unrealized)">{{ fmtMoney(account.unrealized) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.openPositions') }}</span>
          <span class="text-sm font-bold font-mono" :class="account.openPositions > 0 ? 'text-success' : 'text-highlighted'">{{ account.openPositions }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.notional') }}</span>
          <span class="text-sm font-bold font-mono text-highlighted">{{ fmtNum(account.notional) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.freeMargin') }}</span>
          <span class="text-sm font-bold font-mono text-highlighted">{{ fmtNum(account.freeMargin) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.utilization') }}</span>
          <span class="text-sm font-bold font-mono" :class="utilizationClass(account.utilizationPct)">{{ fmtPct(account.utilizationPct) }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.maxDrawdown') }}</span>
          <span class="text-sm font-bold font-mono" :class="account.maxDrawdownPct != null ? 'text-error' : 'text-dimmed'">
            {{ fmtNum(account.maxDrawdown) }}{{ account.maxDrawdownPct != null ? ` (${fmtPct(account.maxDrawdownPct)})` : '' }}
          </span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.maintenance') }}</span>
          <span class="text-sm font-bold font-mono text-highlighted">{{ fmtNum(account.maintenance) }}</span>
        </div>
      </div>

      <!-- Risk gate status (D7 kill-switch) -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('paper.riskGate') }}</span>
          <span v-if="riskDay" class="text-[10px] text-dimmed font-mono">{{ riskDay }} UTC</span>
        </div>
        <p v-if="!risk || !risk.length" class="text-[11px] text-dimmed">{{ t('paper.riskEmpty') }}</p>
        <div v-else class="flex flex-col gap-1.5">
          <div
            v-for="a in risk"
            :key="a.account"
            class="flex items-center justify-between gap-2 rounded-lg bg-elevated/50 px-3 py-2"
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
        v-if="!isLoading && !account"
        :title="t('paper.empty')"
        :description="t('paper.emptyHint')"
        icon="i-lucide-wallet"
      />
    </div>
  </BasePage>
</template>
