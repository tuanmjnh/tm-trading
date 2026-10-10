<script setup lang="ts">
// =============================================================================
//  Replay page (route /replay, Phase 7R2 / roadmap §13, §22 "7R2" + §22.5
//  challenge mode).
//
//  Deterministic bar-by-bar replay of recorded candles on the simulated
//  clock: create a session (server fetches CLOSED bars from the same history
//  endpoint the live chart uses), then drive it with play / pause / step.
//  Events arrive strictly by cursor — the client renders only what the clock
//  has played (D17: future bars never cross the wire).
//
//  While mode === 'playing' the page polls GET :id?cursor=N every 700ms;
//  manual actions (create/step/play/pause) return their own fresh payload.
// =============================================================================
import type { ReplayCandle, ReplayCreateInput, ReplayMode, ReplayPosition, ReplaySummary } from '../../types/replay'
import { getErrorMessage } from '~/shared/utils/errors'
import { challengeLevels, challengeScore } from '../../simulation/challenge.mjs'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'replay.title',
  descKey: 'replay.desc'
})

useHead({ title })

const api = useReplay()

// --- Create form -------------------------------------------------------------
const symbol = ref('BTCUSDT')
const interval = ref('1m')
const limit = ref(120)
const market = ref<'spot' | 'futures'>('spot')
const creating = ref(false)

const INTERVALS = ['1m', '5m', '15m', '1h'] as const
const MARKETS = ['spot', 'futures'] as const

// --- Session state ------------------------------------------------------------
const session = ref<ReplaySummary | null>(null)
const events = ref<ReplayCandle[]>([])
const positions = ref<ReplayPosition[]>([])
const busy = ref(false)

function appendFresh(incoming: ReplayCandle[]): void {
  if (!incoming.length) return
  const last = events.value.length ? events.value[events.value.length - 1]!.openTime : -Infinity
  const fresh = incoming.filter((c) => c.openTime > last)
  if (fresh.length) events.value.push(...fresh)
}

// --- Challenge mode (roadmap §22.5, optional training) -------------------------
// Signal overlays are simply not rendered; future bars can never reach the
// client (D17). The user picks LONG / SHORT / WAIT at the CURRENT replay clock;
// LONG/SHORT place a real risk-gated ticket at the last played close with
// protective levels derived from the played bar + the user's %s. Decisions are
// scored against the replayed position book (simulation/challenge.mjs).
const challenge = ref(false)
const challengeSlPct = ref(2)
const challengeTpPct = ref(4)
const decisions = ref<Array<{ ts: number; side: 'LONG' | 'SHORT' | 'WAIT' }>>([])

const lastClose = computed<number | null>(() => {
  const c = events.value[events.value.length - 1]
  return c ? Number(c.close) : null
})

const challengeScoreboard = computed(() =>
  challengeScore(decisions.value, positions.value)
)

async function onDecision(side: 'LONG' | 'SHORT' | 'WAIT'): Promise<void> {
  const s = session.value
  if (!s) return
  const ts = Number(s.now)
  decisions.value.push({ ts, side })
  if (side === 'WAIT') return
  const price = lastClose.value
  if (price == null) {
    notify.error(t('replay.challengeNoBar'))
    return
  }
  const levels = challengeLevels(side, price, { slPct: challengeSlPct.value, tpPct: challengeTpPct.value })
  if (!levels.ok) {
    notify.error(t('replay.challengeLevelsInvalid'))
    return
  }
  busy.value = true
  try {
    const res = await api.placeOrder(s.id, {
      symbol: s.symbol,
      tf: s.timeframe,
      side: side === 'LONG' ? 'BUY' : 'SELL',
      type: 'market',
      price,
      sl: levels.sl,
      tps: [levels.tp]
    })
    session.value = res.session
    const qty = res.order.qty ?? 0
    if (res.order.status === 'rejected') notify.error(t('replay.challengeRejected'))
    else notify.success(t('replay.challengePlaced', { side, qty: String(qty) }))
  } catch (err) {
    // A gate reject surfaces the gate's own code+message — recorded as a
    // decision that produced no position ('no_trade' in the scoreboard).
    notify.error(getErrorMessage(err, (key) => t(key)) || t('replay.challengeRejected'))
  } finally {
    busy.value = false
  }
}

async function onCreate(): Promise<void> {
  const input: ReplayCreateInput = {
    symbol: symbol.value,
    interval: interval.value,
    limit: Number(limit.value),
    market: market.value
  }
  creating.value = true
  try {
    session.value = await api.create(input)
    events.value = []
    positions.value = []
    decisions.value = []
    notify.success(t('replay.sessionCreated'))
  } catch (err) {
    notify.error(getErrorMessage(err, (key) => t(key)) || t('replay.createFailed'))
  } finally {
    creating.value = false
  }
}

async function onPlay(speed: number): Promise<void> {
  const s = session.value
  if (!s) return
  busy.value = true
  try {
    session.value = await api.play(s.id, speed)
  } catch (err) {
    notify.error(getErrorMessage(err, (key) => t(key)) || t('replay.loadFailed'))
  } finally {
    busy.value = false
  }
}

async function onPause(): Promise<void> {
  const s = session.value
  if (!s) return
  busy.value = true
  try {
    session.value = await api.pause(s.id)
  } catch (err) {
    notify.error(getErrorMessage(err, (key) => t(key)) || t('replay.loadFailed'))
  } finally {
    busy.value = false
  }
}

async function onStep(): Promise<void> {
  const s = session.value
  if (!s || busy.value) return
  busy.value = true
  try {
    const data = await api.step(s.id, 1)
    session.value = data.session
    appendFresh(data.events)
    positions.value = data.positions
  } catch (err) {
    notify.error(getErrorMessage(err, (key) => t(key)) || t('replay.loadFailed'))
  } finally {
    busy.value = false
  }
}

// --- Polling while playing (fail-soft: a dropped poll never breaks playback).
// NOTE: useIntervalFn({ immediate: false }) leaves the timer PAUSED (VueUse
// only calls resume() when immediate is true) — the guard above makes the
// default eager timer a cheap no-op outside 'playing' instead.
//
// The shared API rate limit is 60 req/min per app+IP (api-guards), so the
// poll runs at 1.5s (~40/min headroom) and honors a 429 Retry-After before
// trying again — a throttled poll must never turn into a request storm.
const rateLimitedUntil = ref(0)
useIntervalFn(async () => {
  const s = session.value
  if (!s || s.mode !== 'playing' || busy.value) return
  if (Date.now() < rateLimitedUntil.value) return
  try {
    const data = await api.read(s.id, events.value.length)
    session.value = data.session
    appendFresh(data.events)
    positions.value = data.positions
  } catch (err) {
    const status = (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode
    if (status === 429) rateLimitedUntil.value = Date.now() + 10_000
    /* transient poll failure — next tick retries */
  }
}, 1500)

// --- Display helpers -----------------------------------------------------------
const mode = computed<ReplayMode>(() => session.value?.mode ?? 'ready')

/** Candle time → 'YYYY-MM-DD HH:mm' (D2: always UTC). */
function fmtCandleTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

function fmtPrice(v: number): string {
  return String(Number(v.toFixed(6)))
}
</script>

<template>
  <BasePage id="replay" :title="title" :description="description">
    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <!-- Session builder -->
      <div class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3" data-testid="replay-create-card">
        <div class="text-sm font-medium">{{ t('replay.sessionCard') }}</div>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.symbol') }}
            <UInput id="replay-symbol" v-model="symbol" data-testid="replay-symbol" size="sm" class="w-36" />
          </label>
          <div class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.interval') }}
            <div class="flex gap-1">
              <UButton
                v-for="iv in INTERVALS"
                :key="iv"
                size="xs"
                :color="iv === interval ? 'primary' : 'neutral'"
                :variant="iv === interval ? 'soft' : 'ghost'"
                :data-testid="`replay-interval-${iv}`"
                @click="interval = iv"
              >
                {{ iv }}
              </UButton>
            </div>
          </div>
          <label class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.candles') }}
            <UInput
              id="replay-limit"
              v-model="limit"
              data-testid="replay-limit"
              type="number"
              size="sm"
              class="w-24"
            />
          </label>
          <div class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.market') }}
            <div class="flex gap-1">
              <UButton
                v-for="m in MARKETS"
                :key="m"
                size="xs"
                :color="m === market ? 'primary' : 'neutral'"
                :variant="m === market ? 'soft' : 'ghost'"
                :data-testid="`replay-market-${m}`"
                @click="market = m"
              >
                {{ m === 'spot' ? t('replay.marketSpot') : t('replay.marketFutures') }}
              </UButton>
            </div>
          </div>
          <UButton
            id="replay-create"
            data-testid="replay-create"
            icon="i-lucide-history"
            color="primary"
            variant="soft"
            :loading="creating"
            @click="onCreate"
          >
            {{ t('replay.create') }}
          </UButton>
        </div>
      </div>

      <!-- Controls (only with a live session) -->
      <div
        v-if="session"
        class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3"
        data-testid="replay-controls-card"
      >
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span class="font-medium text-default">{{ session.symbol }}</span>
          <span>{{ session.timeframe }}</span>
          <UBadge color="neutral" variant="subtle">{{ session.market }}</UBadge>
          <span class="tabular-nums">{{ session.id }}</span>
          <div class="ml-auto">
            <UButton
              size="xs"
              :color="challenge ? 'primary' : 'neutral'"
              :variant="challenge ? 'soft' : 'ghost'"
              :icon="challenge ? 'i-lucide-target' : 'i-lucide-eye-off'"
              data-testid="replay-challenge-toggle"
              @click="challenge = !challenge"
            >
              {{ t(challenge ? 'replay.challengeOn' : 'replay.challengeOff') }}
            </UButton>
          </div>
        </div>
        <ReplayControls
          :mode="mode"
          :speed="session.speed"
          :cursor="session.cursor"
          :total="session.total"
          :busy="busy"
          @play="onPlay"
          @pause="onPause"
          @step="onStep"
        />
        <p class="text-xs text-muted">{{ t('replay.hint') }}</p>
      </div>

      <!-- Challenge mode (roadmap §22.5, optional training; NOT financial advice) -->
      <div
        v-if="session && challenge"
        class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3"
        data-testid="replay-challenge-card"
      >
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span>
            {{ t('replay.challengeLast') }}
            <span class="font-mono tabular-nums text-default">{{ lastClose == null ? '—' : fmtPrice(lastClose) }}</span>
          </span>
          <span>
            {{ t('replay.challengeDecisions') }}
            <span class="tabular-nums text-default">{{ challengeScoreboard.decisions }}</span>
          </span>
          <span>
            {{ t('replay.challengeWins') }}
            <span class="tabular-nums text-default">{{ challengeScoreboard.wins }}</span>
          </span>
          <span>
            {{ t('replay.challengeLosses') }}
            <span class="tabular-nums text-default">{{ challengeScoreboard.losses }}</span>
          </span>
          <span>
            {{ t('replay.challengeWait') }}
            <span class="tabular-nums text-default">{{ challengeScoreboard.wait }}</span>
          </span>
          <span>
            {{ t('replay.challengePnl') }}
            <span class="font-mono tabular-nums" :class="challengeScoreboard.pnlAbs > 0 ? 'text-success' : challengeScoreboard.pnlAbs < 0 ? 'text-danger' : 'text-default'">
              {{ challengeScoreboard.pnlAbs }}
            </span>
          </span>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.challengeSlPct') }}
            <UInput
              v-model="challengeSlPct"
              type="number"
              size="sm"
              class="w-20"
              data-testid="replay-challenge-sl"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-muted">
            {{ t('replay.challengeTpPct') }}
            <UInput
              v-model="challengeTpPct"
              type="number"
              size="sm"
              class="w-20"
              data-testid="replay-challenge-tp"
            />
          </label>
          <div class="flex gap-1">
            <UButton
              size="xs"
              color="warning"
              variant="soft"
              :loading="busy"
              icon="i-lucide-trending-up"
              data-testid="replay-challenge-long"
              @click="onDecision('LONG')"
            >
              {{ t('replay.challengeLong') }}
            </UButton>
            <UButton
              size="xs"
              color="info"
              variant="soft"
              :loading="busy"
              icon="i-lucide-trending-down"
              data-testid="replay-challenge-short"
              @click="onDecision('SHORT')"
            >
              {{ t('replay.challengeShort') }}
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              data-testid="replay-challenge-wait"
              @click="onDecision('WAIT')"
            >
              {{ t('replay.challengeWait') }}
            </UButton>
          </div>
          <p class="text-xs text-muted w-full">{{ t('replay.challengeDisclaimer') }}</p>
        </div>
      </div>

      <!-- Played candles -->
      <div
        v-if="session"
        class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3"
        data-testid="replay-events-card"
      >
        <div class="text-sm font-medium">{{ t('replay.played') }}</div>
        <div v-if="events.length" class="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table class="w-full text-sm" data-testid="replay-events">
            <thead class="sticky top-0 bg-default text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th class="py-1 pr-3">{{ t('replay.th_time') }}</th>
                <th class="py-1 pr-3 text-right">{{ t('replay.th_open') }}</th>
                <th class="py-1 pr-3 text-right">{{ t('replay.th_high') }}</th>
                <th class="py-1 pr-3 text-right">{{ t('replay.th_low') }}</th>
                <th class="py-1 pr-3 text-right">{{ t('replay.th_close') }}</th>
              </tr>
            </thead>
            <tbody data-testid="replay-events-body">
              <tr
                v-for="c in events"
                :key="c.openTime"
                class="border-t border-default/50"
                data-testid="replay-row"
              >
                <td class="py-1 pr-3 tabular-nums text-muted">{{ fmtCandleTime(c.openTime) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ fmtPrice(c.open) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ fmtPrice(c.high) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ fmtPrice(c.low) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ fmtPrice(c.close) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-sm text-muted">{{ t('replay.hint') }}</p>
      </div>

      <!-- Empty state (no session yet) -->
      <div v-else class="rounded-lg bg-default ring ring-default p-6">
        <AdminEmptyState
          :title="t('replay.empty')"
          :description="t('replay.emptyHint')"
          icon="i-lucide-history"
        />
      </div>
    </div>
  </BasePage>
</template>
