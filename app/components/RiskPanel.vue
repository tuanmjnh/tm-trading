<script setup lang="ts">
// =============================================================================
//  RiskPanel (S8 / roadmap 7T) — read model of GET /api/v1/risk/status.
//
//  D1: the engine/exec layer owns risk state — this panel only reads and
//  formats it (halt flag, day PnL, D8 drift check, open position count).
//  Fail-soft: risk_state empty (exec/risk not run yet) still returns 200
//  with empty accounts → we render an explicit "no data" state, not a crash.
//  Polls every 30s (kill-switch can flip from exec/risk at any time).
// =============================================================================
import type { RiskStatusData } from '../../types/risk'
import {
  driftTone,
  fmtSigned,
  fmtUtcTime,
  haltTone,
  mongoTone,
  pnlTone
} from '../utils/terminal'

const { t } = useI18n()

const data = ref<RiskStatusData | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const errorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { data?: { message?: string }; message?: string }
    return e.data?.message || e.message || 'request-failed'
  }
  return String(err)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ success: boolean, data: RiskStatusData }>('/api/v1/risk/status')
    data.value = res.data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
useIntervalFn(() => { void load() }, 30_000, { immediate: false })

/** D7c: ANY account halted means the desk is blocked (halt is a hard stop). */
const halted = computed(() => data.value?.accounts.some((a) => a.halted) ?? false)
const drift = computed(() => data.value?.drift ?? null)

const dayLabel = computed(() => data.value?.day ?? '—')

const pnlClass = (v: number): string => {
  const tone = pnlTone(v)
  return tone === 'success' ? 'text-success' : tone === 'error' ? 'text-error' : 'text-muted'
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.risk') }}</h3>
      <div class="flex items-center gap-1.5">
        <UBadge
          v-if="data"
          :color="haltTone(halted)"
          variant="subtle"
          size="sm"
        >
          {{ halted ? t('trade.riskHalted') : t('trade.riskActive') }}
        </UBadge>
        <UBadge v-if="data && data.mongo === 'down'" :color="mongoTone(data.mongo)" variant="subtle" size="sm">
          {{ t('trade.mongoDown') }}
        </UBadge>
        <span class="font-mono text-[10px] text-muted">{{ dayLabel }}</span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :aria-label="t('trade.refresh')"
          @click="load"
        />
      </div>
    </div>

    <div v-if="error" class="grid place-items-center gap-2 py-4 text-center">
      <UIcon name="i-lucide-triangle-alert" class="size-5 text-error" />
      <p class="max-w-[16rem] font-mono text-[11px] break-all text-error/80">{{ error }}</p>
      <UButton size="xs" color="primary" variant="soft" @click="load">{{ t('trade.retry') }}</UButton>
    </div>

    <div v-else-if="loading && !data" class="grid place-items-center gap-2 py-6">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
      <p class="text-xs text-muted">{{ t('trade.loadData') }}</p>
    </div>

    <template v-else-if="data">
      <!-- Halt reason (only when the kill-switch is engaged). -->
      <p
        v-for="a in data.accounts.filter((acc) => acc.halted)"
        :key="`${a.account}-halt`"
        class="rounded-sm bg-error/10 px-2 py-1 text-[11px] text-error"
      >
        <span class="font-medium">{{ a.account }}</span> — {{ a.haltReason || '—' }}
      </p>

      <!-- Per-account day state (usually one row). -->
      <div
        v-for="a in data.accounts"
        :key="a.account"
        class="flex flex-col gap-1 rounded-sm bg-elevated/40 px-2 py-1.5"
      >
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-medium truncate">{{ a.account }}</span>
          <span class="font-mono" :class="pnlClass(a.realizedPnlAbs)">
            {{ fmtSigned(a.realizedPnlAbs) }} / {{ fmtSigned(a.realizedPnlPct) }}%
          </span>
        </div>
        <div class="flex flex-wrap gap-x-3 text-[10px] text-muted">
          <span>{{ t('trade.opened') }} {{ a.tradesOpened }}</span>
          <span>{{ t('trade.closed') }} {{ a.tradesClosed }}</span>
          <span :class="a.consecutiveLosses > 0 ? 'text-error/80' : ''">
            {{ t('trade.consecLosses') }} {{ a.consecutiveLosses }}
          </span>
        </div>
      </div>

      <p v-if="!data.accounts.length" class="py-3 text-center text-xs text-muted">
        {{ t('trade.noRisk') }}
      </p>

      <!-- Open positions (engine count, D1 — not a client-side tally). -->
      <div class="flex items-center justify-between border-t border-default pt-1.5 text-[11px]">
        <span class="text-muted">{{ t('trade.openPositions') }}</span>
        <span class="font-mono">{{ data.openPositions }}</span>
      </div>

      <!-- D8 drift check. -->
      <div class="flex items-center justify-between gap-2 text-[11px]">
        <span class="text-muted">{{ t('trade.drift') }}</span>
        <div class="flex items-center gap-1.5">
          <UBadge :color="driftTone(drift)" variant="subtle" size="sm">
            {{ !drift ? t('trade.driftNever') : drift.breach ? t('trade.driftBreach') : t('trade.driftOk') }}
          </UBadge>
          <span v-if="drift" class="font-mono text-[10px] text-muted">
            {{ fmtUtcTime(drift.lastCheckAt) }} · {{ drift.windowH }}h · {{ drift.checked }}/{{ drift.diverged }}
          </span>
        </div>
      </div>
    </template>

    <p v-else class="py-6 text-center text-xs text-muted">{{ t('trade.noRisk') }}</p>
  </div>
</template>
