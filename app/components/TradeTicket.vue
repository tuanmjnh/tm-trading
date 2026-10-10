<script setup lang="ts">
// =============================================================================
//  Trade Ticket (roadmap Phase 7T/7P) — manual order panel.
//
//  Submits INTENT only: POST /api/v1/orders stores a manual ENTRY alert
//  (status 'received') and exec/paper.mjs runs it through the risk gate (D7)
//  before any position opens. No sizing, no fills, no state decisions here
//  (D21). The chosen `type` (market/limit/stop) rides the payload into the
//  alert's raw doc, where the paper fill model prices the entry against the
//  real quote — never at this form's price. Market mode mirrors the live
//  quote so the gate can validate the intended level.
//
//  Replay mode (7R2): with `replaySessionId` the SAME form posts to
//  POST /api/v1/replay/sessions/:id/orders — same validateTicket intake, same
//  D7 gate — but the order lands in the session's in-memory book instead of
//  the alert pipeline.
// =============================================================================
import type { QuoteMessage } from '../utils/marketFeed'
import { attemptFill, FILL_DEFAULTS } from '../../simulation/fill.mjs'
import { MARGIN_DEFAULTS } from '../../simulation/margin.mjs'

const props = defineProps<{
  symbol: string
  tf: string
  quote?: QuoteMessage | null
  /** Attached replay session — orders go to its book instead of /api/v1/orders. */
  replaySessionId?: string | null
}>()

const emit = defineEmits<{ placed: [alertKey: string] }>()

const { t } = useI18n()
const toast = useToast()
const replayApi = useReplay()

const side = ref<'BUY' | 'SELL'>('BUY')
const orderType = ref<'market' | 'limit' | 'stop'>('market')
const price = ref('')
const sl = ref('')
const tps = ref<string[]>(['', ''])
/** v3 §16.1-16.2: qty XOR riskPct sizing intent — the gate sizes/verifies (D7). */
const sizeMode = ref<'qty' | 'riskPct'>('qty')
const size = ref('')
const busy = ref(false)
const error = ref('')

const pnum = (s: string): number | null => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}
const sizeQty = computed<number | null>(() => (sizeMode.value === 'qty' ? pnum(size.value) : null))
const sizePct = computed<number | null>(() => (sizeMode.value === 'riskPct' ? pnum(size.value) : null))

// fmt helpers — preview only; no business logic lives here (D21).
const fmt = (n: number | null, digits = 2): string =>
  n === null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n)

/**
 * Live preview (roadmap §16.2) priced through the SAME simulation fill model
 * against the CURRENT quote, so the numbers match what exec/paper.mjs will
 * actually do — never a hand-rolled formula. In riskPct mode the qty is the
 * gate's job (D7a), so qty-dependent rows (risk/exposure/margin/fee) show '—'
 * instead of a fabricated number (D12: measurement honesty).
 */
const est = computed<{
  entry: number
  dir: 1 | -1
  fillPrice: number | null
  working: boolean
  riskDist: number
  slPct: number
  rr: number | null
  riskAmount: number | null
  feeEst: number | null
  spreadBps: number
  slippageBps: number
  exposure: number | null
  marginUsed: number | null
  leverage: number
  sized: boolean
} | null>(() => {
  const entry = Number(price.value)
  const sl_ = Number(sl.value)
  if (!(Number.isFinite(entry) && entry > 0 && Number.isFinite(sl_) && sl_ > 0)) return null
  const dir = side.value === 'BUY' ? 1 : -1
  const riskDist = Math.abs(entry - sl_)
  const qty = sizeQty.value

  const fill = attemptFill(
    { type: orderType.value, side: side.value, qty: 1, ...(orderType.value !== 'market' ? { price: entry } : {}) },
    props.quote ?? entry,
    FILL_DEFAULTS,
    Date.now(),
  )

  const notional = qty !== null ? qty * entry : null
  return {
    entry,
    dir,
    fillPrice: fill.status === 'filled' || fill.status === 'partial' ? fill.price : fill.status === 'working' ? entry : null,
    working: fill.status === 'working',
    riskDist,
    slPct: (riskDist / entry) * 100,
    rr: Number.isFinite(Number(tps.value[0])) ? ((Number(tps.value[0]) - entry) * dir) / riskDist : null,
    riskAmount: qty !== null ? riskDist * qty : null,
    // Round-trip worst case: taker on both legs (SL leg) — an honest upper bound.
    feeEst: notional !== null ? (notional * FILL_DEFAULTS.takerFeeBps * 2) / 1e4 : null,
    spreadBps: FILL_DEFAULTS.spreadBps,
    slippageBps: FILL_DEFAULTS.slippageBps,
    exposure: notional,
    marginUsed: notional !== null ? (notional * MARGIN_DEFAULTS.initialMarginPct) / 100 : null,
    leverage: 100 / MARGIN_DEFAULTS.initialMarginPct,
    sized: qty !== null,
  }
})

// Market mode mirrors the live quote: a buy lifts the ask, a sell hits the bid.
const marketPrice = computed<number | null>(() => {
  const q = props.quote
  if (!q) return null
  const p = side.value === 'BUY' ? q.ask : q.bid
  return typeof p === 'number' && Number.isFinite(p) ? p : null
})

watch([marketPrice, orderType, side], () => {
  if (orderType.value === 'market' && marketPrice.value !== null) {
    price.value = String(marketPrice.value)
  }
})

const addTp = (): void => {
  if (tps.value.length < 4) tps.value.push('')
}
const removeTp = (i: number): void => {
  if (tps.value.length > 1) tps.value.splice(i, 1)
}

/** Client mirror of the server rules — the endpoint re-validates (authoritative). */
const clientError = (): string => {
  const p = Number(price.value)
  const s = Number(sl.value)
  const ladder = tps.value.map(Number)
  if (!Number.isFinite(p) || p <= 0) return t('trade.ticketInvalid')
  if (!Number.isFinite(s)) return t('trade.ticketInvalid')
  if (!ladder.length || ladder.some((x) => !Number.isFinite(x) || x <= 0)) return t('trade.ticketInvalid')
  if (side.value === 'BUY') {
    if (s >= p || ladder.some((x) => x <= p)) return t('trade.ticketInvalid')
  } else if (s <= p || ladder.some((x) => x >= p)) {
    return t('trade.ticketInvalid')
  }
  return ''
}

const submitDisabled = computed(() =>
  busy.value ||
  (orderType.value === 'market' && marketPrice.value === null)
)

const submit = async (): Promise<void> => {
  error.value = ''
  const invalid = clientError()
  if (invalid) {
    error.value = invalid
    return
  }
  busy.value = true
  try {
    const payload = {
      symbol: props.symbol,
      tf: props.tf,
      side: side.value,
      type: orderType.value,
      price: Number(price.value),
      sl: Number(sl.value),
      tps: tps.value.map(Number),
      ...(sizeQty.value !== null ? { qty: sizeQty.value } : {}),
      ...(sizePct.value !== null ? { riskPct: sizePct.value } : {})
    }
    if (props.replaySessionId) {
      // Replay book: same gate, same ticket rules — the session's symbol wins.
      const data = await replayApi.placeOrder(props.replaySessionId, payload)
      toast.add({
        title: t('trade.replayPlaced'),
        icon: 'i-lucide-check-circle',
        color: 'success'
      })
      emit('placed', data.order.id)
    } else {
      const res = await $fetch<{ success: boolean, data: { alertKey: string } }>('/api/v1/orders', {
        method: 'POST',
        body: payload
      })
      toast.add({
        title: t('trade.ticketPlaced'),
        icon: 'i-lucide-check-circle',
        color: 'success'
      })
      emit('placed', res.data.alertKey)
    }
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    const base = props.replaySessionId ? t('trade.replayOrderError') : t('trade.ticketError')
    error.value = msg ? `${base}: ${msg}` : base
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.ticket') }}</h3>
      <span class="text-[10px] text-muted">{{ symbol }} · {{ tf }}</span>
    </div>

    <!-- Side -->
    <div class="grid grid-cols-2 gap-1.5" role="group" :aria-label="t('trade.ticketSide')">
      <UButton
        size="sm"
        :color="side === 'BUY' ? 'success' : 'neutral'"
        :variant="side === 'BUY' ? 'soft' : 'ghost'"
        :aria-pressed="side === 'BUY'"
        @click="side = 'BUY'"
      >
        {{ t('trade.sides.buy') }}
      </UButton>
      <UButton
        size="sm"
        :color="side === 'SELL' ? 'error' : 'neutral'"
        :variant="side === 'SELL' ? 'soft' : 'ghost'"
        :aria-pressed="side === 'SELL'"
        @click="side = 'SELL'"
      >
        {{ t('trade.sides.sell') }}
      </UButton>
    </div>

    <!-- Order type -->
    <div class="flex items-center gap-1.5" role="group" :aria-label="t('trade.ticketType')">
      <span class="text-[10px] text-muted">{{ t('trade.ticketType') }}</span>
      <UButton
        size="xs"
        :color="orderType === 'market' ? 'primary' : 'neutral'"
        :variant="orderType === 'market' ? 'soft' : 'ghost'"
        :aria-pressed="orderType === 'market'"
        @click="orderType = 'market'"
      >
        {{ t('trade.ticketMarket') }}
      </UButton>
      <UButton
        size="xs"
        :color="orderType === 'limit' ? 'primary' : 'neutral'"
        :variant="orderType === 'limit' ? 'soft' : 'ghost'"
        :aria-pressed="orderType === 'limit'"
        @click="orderType = 'limit'"
      >
        {{ t('trade.ticketLimit') }}
      </UButton>
      <UButton
        size="xs"
        :color="orderType === 'stop' ? 'primary' : 'neutral'"
        :variant="orderType === 'stop' ? 'soft' : 'ghost'"
        :aria-pressed="orderType === 'stop'"
        @click="orderType = 'stop'"
      >
        {{ t('trade.ticketStop') }}
      </UButton>
    </div>

    <!-- Price -->
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-muted">{{ t('trade.price') }}</span>
      <UInput
        v-model="price"
        type="number"
        size="sm"
        inputmode="decimal"
        :placeholder="orderType === 'market' && marketPrice === null ? t('trade.ticketNoQuote') : undefined"
      />
    </label>

    <!-- Size (v3 §16.1: qty XOR risk %) -->
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ t('trade.size') }}</span>
        <div class="flex items-center gap-1.5" role="group" :aria-label="t('trade.ticketSizeMode')">
          <UButton
            size="xs"
            :color="sizeMode === 'qty' ? 'primary' : 'neutral'"
            :variant="sizeMode === 'qty' ? 'soft' : 'ghost'"
            :aria-pressed="sizeMode === 'qty'"
            @click="sizeMode = 'qty'"
          >
            {{ t('trade.ticketQty') }}
          </UButton>
          <UButton
            size="xs"
            :color="sizeMode === 'riskPct' ? 'primary' : 'neutral'"
            :variant="sizeMode === 'riskPct' ? 'soft' : 'ghost'"
            :aria-pressed="sizeMode === 'riskPct'"
            @click="sizeMode = 'riskPct'"
          >
            {{ t('trade.ticketRiskPct') }}
          </UButton>
        </div>
      </div>
      <UInput
        v-model="size"
        type="number"
        size="sm"
        inputmode="decimal"
        :placeholder="sizeMode === 'qty' ? t('trade.ticketQtyPh') : t('trade.ticketRiskPctPh')"
      />
    </div>

    <!-- Stop loss -->
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-muted">{{ t('trade.sl') }}</span>
      <UInput v-model="sl" type="number" size="sm" inputmode="decimal" />
    </label>

    <!-- Take profit ladder (max 4) -->
    <div class="flex flex-col gap-1">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] text-muted">{{ t('trade.tp') }}</span>
        <UButton
          v-if="tps.length < 4"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          @click="addTp"
        >
          {{ t('trade.ticketAddTp') }}
        </UButton>
      </div>
      <div v-for="(_, i) in tps" :key="i" class="flex gap-1.5">
        <UInput
          v-model="tps[i]"
          type="number"
          size="sm"
          inputmode="decimal"
          class="flex-1"
          :aria-label="`${t('trade.tp')} ${i + 1}`"
        />
        <UButton
          v-if="tps.length > 1"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="t('trade.ticketRemoveTp')"
          @click="removeTp(i)"
        />
      </div>
    </div>

    <UButton
      block
      size="sm"
      color="primary"
      :loading="busy"
      :disabled="submitDisabled"
      @click="submit"
    >
      {{ busy ? t('trade.ticketSending') : t('trade.ticketSubmit') }}
    </UButton>

    <!-- Preview (roadmap §16.2) — same fill model, priced off the live quote -->
    <div v-if="est" class="flex flex-col gap-1.5 rounded-lg bg-default ring ring-default/50 p-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('trade.preview') }}</span>
        <span v-if="!est.sized" class="text-[10px] text-muted italic">{{ t('trade.previewGateSized') }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        <dt class="text-muted">{{ t('trade.previewEntry') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.entry) }}</dd>
        <dt class="text-muted">{{ t('trade.previewFill') }}</dt>
        <dd class="text-right font-mono">
          {{ est.fillPrice === null ? t('trade.ticketNoQuote') : fmt(est.fillPrice) }}
          <span v-if="est.working" class="text-muted">{{ t('trade.previewWorking') }}</span>
        </dd>
        <dt class="text-muted">{{ t('trade.previewRisk') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.riskAmount) }}</dd>
        <dt class="text-muted">{{ t('trade.previewSlDist') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.slPct) }}%</dd>
        <dt class="text-muted">{{ t('trade.previewRr') }}</dt>
        <dd class="text-right font-mono">{{ est.rr === null ? '—' : fmt(est.rr) }}</dd>
        <dt class="text-muted">{{ t('trade.previewFee') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.feeEst) }}</dd>
        <dt class="text-muted">{{ t('trade.previewSpread') }}</dt>
        <dd class="text-right font-mono">{{ est.spreadBps }} bps</dd>
        <dt class="text-muted">{{ t('trade.previewSlippage') }}</dt>
        <dd class="text-right font-mono">{{ est.slippageBps }} bps</dd>
        <dt class="text-muted">{{ t('trade.previewExposure') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.exposure) }}</dd>
        <dt class="text-muted">{{ t('trade.previewMargin') }}</dt>
        <dd class="text-right font-mono">{{ fmt(est.marginUsed) }}</dd>
        <dt class="text-muted">{{ t('trade.previewLeverage') }}</dt>
        <dd class="text-right font-mono">{{ est.leverage }}x</dd>
      </dl>
    </div>

    <p v-if="error" class="text-[11px] text-error">{{ error }}</p>
    <p class="text-[10px] text-muted">{{ t('trade.ticketSizing') }}</p>
  </div>
</template>
