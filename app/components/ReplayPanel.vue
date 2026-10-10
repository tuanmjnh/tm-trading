<script setup lang="ts">
// =============================================================================
//  ReplayPanel (Phase 7R2 / roadmap §25) — replay controls + session book.
//
//  Controls: start/exit the session, play (with speed), pause, manual step.
//  Book: the session's in-memory orders/positions (never the live collections).
//  Signals: the SAME engine method registry the backtest uses (§25 "same
//  methods") analyzed over seed history + played bars — the setups list shows
//  what the method would have fired at every replayed bar. Polling + session
//  state live in pages/trade.vue; this component only emits intents.
// =============================================================================
import '../../engine/methods/all.mjs'
import { getMethod } from '../../engine/methods/index.mjs'
import { formatPrice, type CandleInput } from '../utils/marketFeed'
import type {
  ReplayCandle,
  ReplayOrder,
  ReplayPosition,
  ReplaySummary
} from '~~/types/replay'

const props = defineProps<{
  session: ReplaySummary | null
  events: ReplayCandle[]
  orders: ReplayOrder[]
  positions: ReplayPosition[]
  /** Seed history fetched on attach (closeTime < replay start). */
  seed: CandleInput[] | null
  /** Shared method selection (MethodControls) — '' = no analysis shown. */
  activeMethod: string
  busy: boolean
  error: string
}>()

const emit = defineEmits<{
  start: []
  play: [speed: number]
  pause: []
  step: []
  detach: []
}>()

const { t } = useI18n()

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10]

const modeLabel = computed<string>(() => {
  switch (props.session?.mode) {
    case 'playing':
      return t('trade.replayModePlaying')
    case 'paused':
      return t('trade.replayModePaused')
    case 'done':
      return t('trade.replayModeDone')
    default:
      return t('trade.replayModeReady')
  }
})

const modeColor = computed(() =>
  props.session?.mode === 'playing' ? 'success' as const
  : props.session?.mode === 'done' ? 'neutral' as const
  : 'warning' as const
)

const clockTime = (ms: number): string =>
  Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('en-GB', { hour12: false }) : '—'

const resultOf = (p: ReplayPosition): string => {
  if (p.status !== 'closed') return '—'
  if (p.exitReason === 'data:tp') return 'TP'
  if (p.exitReason === 'data:sl') return 'SL'
  return p.exitReason ?? '—'
}

const pnlClass = (p: ReplayPosition): string =>
  (p.pnlAbs ?? 0) > 0 ? 'text-success' : (p.pnlAbs ?? 0) < 0 ? 'text-error' : 'text-muted'

// -----------------------------------------------------------------------------
//  §25 "same methods": run the selected engine method over seed + played bars.
//  Bars carry engine time (openTime ms); analyze() is the backtest entry point.
// -----------------------------------------------------------------------------

interface MethodBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const methodBars = computed<MethodBar[]>(() => {
  const rows: MethodBar[] = []
  const push = (c: CandleInput): void => {
    rows.push({
      time: Number(c.openTime),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number.isFinite(c.volume) ? Number(c.volume) : 0
    })
  }
  for (const c of props.seed ?? []) push(c)
  for (const c of props.events) push(c)
  return rows
})

interface SetupRow {
  bar: number
  dir: number
  entry: number
  sl: number
  tp: number
}

const setups = computed<SetupRow[]>(() => {
  if (!props.activeMethod || !props.session) return []
  try {
    const method = getMethod(props.activeMethod)
    if (!method?.analyze) return []
    const an = method.analyze(methodBars.value, {}) as { setups?: SetupRow[] }
    return (an?.setups ?? []).slice(-6)
  } catch {
    return []
  }
})

const setupTime = (bar: number): string => {
  const row = methodBars.value[bar]
  return row ? clockTime(row.time) : '—'
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('trade.replay') }}</h3>
      <div v-if="session" class="flex items-center gap-1.5">
        <span class="font-mono text-[10px] text-muted">{{ session.cursor }}/{{ session.total }}</span>
        <UBadge :color="modeColor" variant="subtle" size="sm">{{ modeLabel }}</UBadge>
      </div>
    </div>

    <!-- Not attached: start CTA -->
    <template v-if="!session">
      <p class="text-[11px] text-muted">{{ t('trade.replayStartHint') }}</p>
      <UButton
        size="sm"
        color="primary"
        variant="soft"
        icon="i-lucide-history"
        :loading="busy"
        @click="emit('start')"
      >
        {{ t('trade.replayStart') }}
      </UButton>
    </template>

    <!-- Attached: controls + book -->
    <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <UButton
          v-if="session.mode !== 'done'"
          size="xs"
          :color="session.mode === 'playing' ? 'warning' : 'primary'"
          variant="soft"
          :icon="session.mode === 'playing' ? 'i-lucide-pause' : 'i-lucide-play'"
          @click="session.mode === 'playing' ? emit('pause') : emit('play', session.speed)"
        >
          {{ session.mode === 'playing' ? t('trade.replayPause') : t('trade.replayPlay') }}
        </UButton>
        <UButton
          v-if="session.mode !== 'done'"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-step-forward"
          :disabled="busy || session.mode === 'playing'"
          @click="emit('step')"
        >
          {{ t('trade.replayStep') }}
        </UButton>
        <div class="flex items-center gap-0.5" role="group" :aria-label="t('trade.replaySpeed')">
          <UButton
            v-for="s in SPEEDS"
            :key="s"
            size="xs"
            :color="session.speed === s ? 'primary' : 'neutral'"
            :variant="session.speed === s ? 'soft' : 'ghost'"
            @click="emit('play', s)"
          >
            {{ s }}×
          </UButton>
        </div>
        <UButton
          size="xs"
          color="error"
          variant="ghost"
          icon="i-lucide-log-out"
          class="ml-auto"
          @click="emit('detach')"
        >
          {{ t('trade.replayStop') }}
        </UButton>
      </div>

      <!-- Orders -->
      <div class="flex flex-col gap-1">
        <span class="text-[10px] font-medium tracking-wide text-muted uppercase">
          {{ t('trade.replayOrders') }}
        </span>
        <p v-if="!orders.length" class="text-[11px] text-muted">{{ t('trade.replayEmptyOrders') }}</p>
        <div v-else class="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
          <div
            v-for="o in orders.slice(-8)"
            :key="o.id"
            class="grid grid-cols-12 gap-1 font-mono text-[11px]"
          >
            <span :class="o.side === 'BUY' ? 'text-success' : 'text-error'">
              {{ o.side === 'BUY' ? t('trade.sides.buy') : t('trade.sides.sell') }}
            </span>
            <span class="col-span-2 text-muted">{{ o.type }}</span>
            <span class="col-span-3 text-right">{{ formatPrice(o.fillPrice ?? o.price) }}</span>
            <span class="col-span-2 text-right">{{ o.qty }}</span>
            <span class="col-span-4 text-right" :class="o.status === 'rejected' ? 'text-error' : 'text-muted'">
              {{ o.status }}<template v-if="o.rejectReason"> · {{ o.rejectReason }}</template>
            </span>
          </div>
        </div>
      </div>

      <!-- Positions -->
      <div class="flex flex-col gap-1">
        <span class="text-[10px] font-medium tracking-wide text-muted uppercase">
          {{ t('trade.positions') }}
        </span>
        <p v-if="!positions.length" class="text-[11px] text-muted">{{ t('trade.replayEmptyPositions') }}</p>
        <div v-else class="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
          <div
            v-for="p in positions.slice(-8)"
            :key="p.id"
            class="grid grid-cols-12 gap-1 font-mono text-[11px]"
          >
            <span class="col-span-2" :class="p.dir === 1 ? 'text-success' : 'text-error'">
              {{ p.dir === 1 ? t('trade.sides.long') : t('trade.sides.short') }}
            </span>
            <span class="col-span-2 text-right">{{ p.qty }}</span>
            <span class="col-span-3 text-right">{{ formatPrice(p.entryPrice) }}</span>
            <span class="col-span-3 text-right">{{ formatPrice(p.exitPrice) }}</span>
            <span class="col-span-2 text-right" :class="p.status === 'closed' ? pnlClass(p) : 'text-muted'">
              {{ p.status === 'closed' ? resultOf(p) : '—' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Method setups on replay bars (§25 same methods) -->
      <div v-if="activeMethod" class="flex flex-col gap-1 border-t border-default pt-2">
        <span class="text-[10px] font-medium tracking-wide text-muted uppercase">
          {{ t('trade.replaySignals') }} · {{ activeMethod }}
        </span>
        <p v-if="!setups.length" class="text-[11px] text-muted">{{ t('trade.replaySignalsEmpty') }}</p>
        <div v-else class="flex flex-col gap-0.5">
          <div
            v-for="(s, i) in setups"
            :key="i"
            class="grid grid-cols-12 gap-1 font-mono text-[11px]"
          >
            <span class="col-span-3 text-muted">{{ setupTime(s.bar) }}</span>
            <span class="col-span-2" :class="s.dir === 1 ? 'text-success' : 'text-error'">
              {{ s.dir === 1 ? t('trade.sides.long') : t('trade.sides.short') }}
            </span>
            <span class="col-span-3 text-right">{{ formatPrice(s.entry) }}</span>
            <span class="col-span-2 text-right text-muted">{{ formatPrice(s.sl) }}</span>
            <span class="col-span-2 text-right text-muted">{{ formatPrice(s.tp) }}</span>
          </div>
        </div>
      </div>
    </template>

    <p v-if="error" class="text-[11px] text-error">{{ t('trade.replayError') }}: {{ error }}</p>
  </div>
</template>
