<script setup lang="ts">
// =============================================================================
//  PositionPanel (S8 / roadmap 7T) — live positions read model.
//
//  Source: GET /api/v1/positions (collection `positions`, engine owns state —
//  D21: the UI never derives position truth, it only renders what the engine
//  stored). Header stats come from server meta (open/closed/realized PnL
//  across ALL accounts), rows are open positions (toggleable to all).
//  Optional method filter (shared selection with MethodControls) applies
//  client-side on the current page. Polls every 15s.
// =============================================================================
import type { PositionItem, PositionsListResponse } from '../../types/positions'
import type { PositionModifyPatch } from '../composables/usePositions'
import { getErrorMessage } from '~/shared/utils/errors'
import { dirTone, fmtPct, fmtQty, fmtSigned, fmtUtcTime, mongoTone, pnlTone } from '../utils/terminal'

const props = defineProps<{ method: string }>()
const emit = defineEmits<{ 'clear-method': [] }>()

const { t, te } = useI18n()
const notify = useNotify()
const { modify, close } = usePositions()

const status = ref<'open' | 'all'>('open')
const items = ref<PositionItem[]>([])
const meta = ref<PositionsListResponse['meta'] | null>(null)
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
    const params: Record<string, string | number> = { limit: 20 }
    if (status.value === 'open') params.status = 'open'
    const res = await $fetch<PositionsListResponse>('/api/v1/positions', { params })
    items.value = res.data
    meta.value = res.meta
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

watch(status, () => { void load() })
onMounted(() => { void load() })
// immediate: false would leave the timer paused (VueUse only resumes when
// immediate is true) — the load() above covers the first paint instead.
useIntervalFn(() => { void load() }, 15_000)

/** Client-side filter by the shared method selection (display only). */
const visible = computed<PositionItem[]>(() =>
  props.method ? items.value.filter((p) => p.method === props.method) : items.value
)

const methodLabel = (method: string | null): string => {
  if (!method) return '—'
  const key = `trade.methodNames.${method}`
  return te(key) ? t(key) : method
}

const dirLabel = (dir: number): string => (dir === -1 ? t('trade.dirShort') : t('trade.dirLong'))

const pnlClass = (v: number | null): string => {
  const tone = pnlTone(v)
  return tone === 'success' ? 'text-success' : tone === 'error' ? 'text-error' : 'text-muted'
}

const time = (iso: string | null): string => fmtUtcTime(iso)

// -----------------------------------------------------------------------------
//  Roadmap v3 §19/§20 — live numbers. The SERVER computes them (utils/
//  livePositions.ts) off current plane quotes through the SAME simulation core
//  the executor uses (D21/D25); we only render. `live` is absent on closed rows
//  and null on open rows without a usable quote — show '—', ever a guess (D12).
// -----------------------------------------------------------------------------
const liveUnrealizedTone = (v: number | null): string => pnlClass(v)
const fmtNum = (v: number | null | undefined): string => (v == null ? '—' : String(Math.round(v * 1e2) / 1e2))
const livePrice = (v: number | null | undefined): string => (v == null ? '—' : String(v))
const liveSigned = (v: number | null | undefined): string => (v == null ? '—' : fmtSigned(v))

// -----------------------------------------------------------------------------
//  Phase 7P actions — modify SL/TP + close (full/partial), risk-gated server.
//  One inline form at a time, only on OPEN rows; every result (success or a
//  gate reject like RISK_BUDGET / BAD_SL / HALTED) is surfaced through notify.
// -----------------------------------------------------------------------------
const activeForm = ref<{ id: string; kind: 'modify' | 'close' } | null>(null)
const busy = ref(false)
const modSl = ref('')
const modTps = ref('')
const closePct = ref('50')

function toggleModify(p: PositionItem): void {
  if (activeForm.value?.id === p.id && activeForm.value.kind === 'modify') {
    activeForm.value = null
    return
  }
  modSl.value = p.sl != null ? String(p.sl) : ''
  modTps.value = p.tps.join(', ')
  activeForm.value = { id: p.id, kind: 'modify' }
}

function toggleClose(p: PositionItem): void {
  if (activeForm.value?.id === p.id && activeForm.value.kind === 'close') {
    activeForm.value = null
    return
  }
  closePct.value = '50'
  activeForm.value = { id: p.id, kind: 'close' }
}

async function saveModify(p: PositionItem): Promise<void> {
  const patch: PositionModifyPatch = {}
  // UInput type="number" can hand back a number — coerce before string ops.
  const slRaw = String(modSl.value ?? '').trim()
  if (slRaw !== '') {
    const sl = Number(slRaw)
    if (!Number.isFinite(sl)) {
      notify.error(t('trade.posModifyInvalid'))
      return
    }
    patch.sl = sl
  }
  const parts = String(modTps.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length) {
    const tps = parts.map(Number)
    if (tps.some(n => !Number.isFinite(n))) {
      notify.error(t('trade.posModifyInvalid'))
      return
    }
    patch.tps = tps
  }
  if (patch.sl === undefined && patch.tps === undefined) {
    notify.error(t('trade.posModifyEmpty'))
    return
  }

  busy.value = true
  try {
    const res = await modify(p.id, patch)
    notify.success(t('trade.posModifyOk', { rr: res.data.rr ?? '—' }))
    activeForm.value = null
    await load()
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    busy.value = false
  }
}

async function saveClose(p: PositionItem): Promise<void> {
  const pct = Number(closePct.value)
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
    notify.error(t('trade.posPartialInvalid'))
    return
  }
  busy.value = true
  try {
    const res = await close(p.id, { pct })
    const d = res.data
    if (d.status === 'closed') {
      notify.success(t('trade.posCloseOk', { price: d.exitPrice ?? '—', pnl: fmtSigned(d.pnlAbs) }))
    } else {
      notify.success(t('trade.posPartialOk', {
        qty: fmtQty(d.closedQty),
        price: d.exitPrice ?? '—',
        pnl: fmtSigned(d.pnlAbs),
        left: fmtQty(d.remainingQty)
      }))
    }
    activeForm.value = null
    await load()
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.positions') }}</h3>
      <div class="flex items-center gap-1.5">
        <UBadge v-if="meta && meta.mongo === 'down'" :color="mongoTone(meta.mongo)" variant="subtle" size="sm">
          {{ t('trade.mongoDown') }}
        </UBadge>
        <div class="flex items-center gap-1" role="group" :aria-label="t('trade.positions')">
          <UButton
            v-for="opt in (['open', 'all'] as const)"
            :key="opt"
            size="xs"
            :color="status === opt ? 'primary' : 'neutral'"
            :variant="status === opt ? 'soft' : 'ghost'"
            :aria-pressed="status === opt"
            @click="status = opt"
          >
            {{ opt === 'open' ? t('trade.posOpen') : t('trade.posAll') }}
          </UButton>
        </div>
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

    <!-- Server-side header stats (D1: engine computes, we only display). -->
    <div v-if="meta" class="grid grid-cols-3 gap-2 border-b border-default pb-1.5 text-center">
      <div>
        <div class="font-mono text-sm">{{ meta.open }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.posOpen') }}</div>
      </div>
      <div>
        <div class="font-mono text-sm">{{ meta.closed }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.closed') }}</div>
      </div>
      <div>
        <div class="font-mono text-sm" :class="pnlClass(meta.realizedPnlAbs)">
          {{ fmtSigned(meta.realizedPnlAbs) }}
        </div>
        <div class="text-[10px] text-muted">{{ t('trade.realizedPnl') }}</div>
      </div>
    </div>

    <!-- Roadmap v3 §20: account portrait, server-computed from open positions +
         live quotes (locked margin, free, utilization, net unrealized).
         meta.account is null when no plane quote exists at all. -->
    <div v-if="meta?.account" class="grid grid-cols-5 gap-2 border-b border-default pb-1.5 text-center">
      <div>
        <div class="font-mono text-[11px]">{{ fmtNum(meta.account.equity) }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.accEquity') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]">{{ fmtNum(meta.account.marginUsed) }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.accMarginUsed') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]">{{ fmtNum(meta.account.freeMargin) }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.accFree') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]">{{ fmtPct(meta.account.utilizationPct) }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.accUtil') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]" :class="liveUnrealizedTone(meta.account.unrealized)">
          {{ fmtSigned(meta.account.unrealized) }}
        </div>
        <div class="text-[10px] text-muted">{{ t('trade.accUnrealized') }}</div>
      </div>
    </div>
    <div v-else-if="meta" class="border-b border-default pb-1 text-center text-[10px] text-muted/80">
      {{ t('trade.accNoQuotes') }}
    </div>

    <!-- Roadmap v3 §20 PERSISTENT paper account: read-projection of the stored
         positions (survives refresh / reconnect / backend restart). Balance,
         realized, daily PnL and drawdown stay exact with no quote at all. -->
    <div
      v-if="meta?.account?.balance != null"
      class="grid grid-cols-4 gap-2 border-b border-default pb-1.5 text-center"
    >
      <div title="balance = initial + realized (read-derived)">
        <div class="font-mono text-[11px]">{{ fmtNum(meta.account.balance) }}</div>
        <div class="text-[10px] text-muted">{{ t('trade.accBalance') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]" :class="pnlClass(meta.account.realizedPnl ?? null)">
          {{ fmtSigned(meta.account.realizedPnl ?? null) }}
        </div>
        <div class="text-[10px] text-muted">{{ t('trade.accRealized') }}</div>
      </div>
      <div>
        <div class="font-mono text-[11px]" :class="pnlClass(meta.account.dailyPnl ?? 0)">
          {{ fmtSigned(meta.account.dailyPnl ?? null) }}
        </div>
        <div class="text-[10px] text-muted">{{ t('trade.accDaily') }}</div>
      </div>
      <div :title="t('trade.accDdBasis')">
        <div class="font-mono text-[11px]" :class="meta.account.maxDrawdown ? 'text-warning' : 'text-muted'">
          {{ fmtSigned(meta.account.maxDrawdown ?? 0) }}<template v-if="meta.account.maxDrawdownPct != null"> ({{ fmtPct(meta.account.maxDrawdownPct) }})</template>
        </div>
        <div class="text-[10px] text-muted">{{ t('trade.accMaxDD') }}</div>
      </div>
    </div>

    <!-- Active shared method filter. -->
    <div v-if="method" class="flex items-center justify-between text-[10px] text-muted">
      <span>{{ t('trade.filteredBy') }} <span class="font-mono text-primary">{{ methodLabel(method) }}</span></span>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('trade.clearFilter')" @click="emit('clear-method')" />
    </div>

    <div v-if="error" class="grid place-items-center gap-2 py-4 text-center">
      <UIcon name="i-lucide-triangle-alert" class="size-5 text-error" />
      <p class="max-w-[16rem] font-mono text-[11px] break-all text-error/80">{{ error }}</p>
      <UButton size="xs" color="primary" variant="soft" @click="load">{{ t('trade.retry') }}</UButton>
    </div>

    <div v-else-if="loading && !items.length" class="grid place-items-center gap-2 py-6">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
      <p class="text-xs text-muted">{{ t('trade.loadData') }}</p>
    </div>

    <div v-else-if="visible.length" class="flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5">
      <div
        v-for="p in visible"
        :key="p.id"
        class="flex flex-col gap-0.5 rounded-sm bg-elevated/40 px-2 py-1.5"
      >
        <div class="flex items-center gap-1.5 text-[11px]">
          <UBadge :color="dirTone(p.dir)" variant="subtle" size="sm">{{ dirLabel(p.dir) }}</UBadge>
          <span class="font-medium truncate">{{ p.symbol }}</span>
          <span class="text-[10px] text-muted">{{ p.tf ?? '—' }}</span>
          <span class="ml-auto font-mono" :class="pnlClass(p.pnlAbs)">
            {{ fmtSigned(p.pnlAbs) }} / {{ fmtPct(p.pnlPct) }}
          </span>
        </div>
        <div class="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted">
          <span>
          <span class="text-muted/80">{{ t('trade.qty') }}</span>
          {{ fmtQty(p.qty) }}
          </span>
          <span>
            <span class="text-muted/80">{{ t('trade.entry') }}</span>
            {{ p.entryPrice }}
          </span>
          <span v-if="p.sl != null">
            <span class="text-muted/80">{{ t('trade.sl') }}</span>
            {{ p.sl }}
          </span>
          <span>
            <span class="text-muted/80">{{ t('trade.method') }}</span>
            {{ methodLabel(p.method) }}
          </span>
          <span v-if="p.status !== 'open'" :class="p.status === 'closed' ? '' : 'text-warning/80'">
            {{ p.exitReason ?? p.status }} · {{ time(p.exitTime) }}
          </span>
        </div>

        <!-- Roadmap v3 §19: live per-position numbers, SERVER-computed via the
             simulation core (mark / unrealized / liq / leverage / margin). -->
        <div v-if="p.live" class="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted">
          <span title="mark">
            <span class="text-muted/80">{{ t('trade.posMark') }}</span>
            {{ livePrice(p.live.mark) }}
          </span>
          <span title="unrealized">
            <span class="text-muted/80">{{ t('trade.posUnrealized') }}</span>
            <span :class="liveUnrealizedTone(p.live.unrealized)">{{ liveSigned(p.live.unrealized) }}</span>
          </span>
          <span title="liq">
            <span class="text-muted/80">{{ t('trade.posLiq') }}</span>
            {{ livePrice(p.live.liqPrice) }}
          </span>
          <span title="leverage">
            <span class="text-muted/80">{{ t('trade.posLev') }}</span>
            {{ fmtNum(p.live.leverage) }}x
          </span>
          <span title="margin">
            <span class="text-muted/80">{{ t('trade.posMargin') }}</span>
            {{ fmtNum(p.live.marginUsed) }}
          </span>
        </div>

        <!-- Phase 7P: action buttons + inline forms (OPEN rows only). -->
        <div v-if="p.status === 'open'" class="flex items-center gap-1 pt-0.5">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-sliders-horizontal"
            :aria-label="t('trade.posModify')"
            @click="toggleModify(p)"
          >
            {{ t('trade.posModify') }}
          </UButton>
          <UButton
            size="xs"
            color="warning"
            variant="soft"
            icon="i-lucide-circle-x"
            :aria-label="t('trade.posPartial')"
            @click="toggleClose(p)"
          >
            {{ t('trade.posPartial') }}
          </UButton>
        </div>

        <div
          v-if="p.status === 'open' && activeForm?.id === p.id && activeForm.kind === 'modify'"
          class="flex flex-wrap items-end gap-1.5 border-t border-default pt-1.5"
        >
          <label class="flex flex-col gap-0.5 text-[10px] text-muted">
            {{ t('trade.sl') }}
            <UInput v-model="modSl" size="xs" type="number" class="w-24" :aria-label="t('trade.sl')" />
          </label>
          <label class="flex min-w-32 grow flex-col gap-0.5 text-[10px] text-muted">
            {{ t('trade.posModifyTps') }}
            <UInput v-model="modTps" size="xs" class="w-full" :aria-label="t('trade.posModifyTps')" />
          </label>
          <div class="flex gap-1">
            <UButton size="xs" color="primary" variant="soft" :loading="busy" @click="saveModify(p)">
              {{ t('common.save') }}
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :disabled="busy" @click="activeForm = null">
              {{ t('common.cancel') }}
            </UButton>
          </div>
        </div>

        <div
          v-if="p.status === 'open' && activeForm?.id === p.id && activeForm.kind === 'close'"
          class="flex flex-wrap items-end gap-1.5 border-t border-default pt-1.5"
        >
          <label class="flex flex-col gap-0.5 text-[10px] text-muted">
            {{ t('trade.posPartialPct') }}
            <UInput v-model="closePct" size="xs" type="number" class="w-20" :aria-label="t('trade.posPartialPct')" />
          </label>
          <div class="flex gap-1">
            <UButton size="xs" color="warning" variant="soft" :loading="busy" @click="saveClose(p)">
              {{ t('trade.posPartial') }}
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :disabled="busy" @click="activeForm = null">
              {{ t('common.cancel') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <p v-else class="py-6 text-center text-xs text-muted">
      {{ method ? t('trade.posFilteredEmpty') : t('trade.posEmpty') }}
    </p>
  </div>
</template>
