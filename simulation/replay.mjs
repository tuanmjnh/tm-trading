// =============================================================================
//  TM TRADING — deterministic REPLAY player (Phase 7R2, roadmap §13).
//
//  A replay session consumes HISTORICAL closed candles in order and hands
//  them out one bar at a time on a simulated clock (market/clock.mjs,
//  mode 'replay') — the same clock abstraction live/backtest share (D18):
//
//    Historical bars → Simulated Clock → market.candle events → same
//    indicator engine / same methods / same fill model / same journal.
//
//  Hard rules (D17/D18) locked by simulation/test.mjs §14:
//    - FUTURE DATA NEVER LEAKS: the bars past the cursor live in a private
//      array; state()/takeEvents() expose ONLY what has been stepped past.
//    - The clock advances exactly to the emitted bar's eventTime and never
//      beyond it — canUse(future) stays false until the step that reaches it.
//    - Monotonic: the underlying clock refuses to rewind (D18).
//    - Deterministic: no Date.now(), no randomness — same bars + same steps
//      produce byte-identical events. That is the 7R2 acceptance: replay
//      shares simulation semantics with Live Paper instead of reinventing
//      them.
//
//  This module is pure (no IO, no timers): the server session manager owns
//  scheduling and calls step()/play()/pause() — keeping the player testable
//  without fake clocks.
// =============================================================================
import { createTradingClock } from '../market/clock.mjs'

/** Speeds are multipliers of wall-clock pacing (roadmap §22.4: 0.25x…10x). */
export const REPLAY_SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 5, 10])

/** ready = created, nothing played; done = every bar emitted (terminal). */
export const REPLAY_MODES = Object.freeze(['ready', 'playing', 'paused', 'done'])

/**
 * Normalize raw candle rows into the replay event shape:
 * CLOSED bars only (a forming candle is not replayable — its close is
 * future data), sorted ascending by openTime, deduped by openTime, with
 * eventTime = closeTime (D16: event time is the trade time of the close).
 */
export function normalizeReplayBars(rawBars) {
  if (!Array.isArray(rawBars)) throw new Error('replay: bars must be an array')
  const seen = new Set()
  const out = []
  for (const raw of rawBars) {
    if (!raw || typeof raw !== 'object') continue
    const openTime = Number(raw.openTime)
    const closeTime = Number(raw.closeTime)
    const open = Number(raw.open)
    const high = Number(raw.high)
    const low = Number(raw.low)
    const close = Number(raw.close)
    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) continue
    if (![open, high, low, close].every(Number.isFinite)) continue
    // Forming bars are future data: only closed candles may be played.
    if (raw.state === 'forming') continue
    if (seen.has(openTime)) continue
    seen.add(openTime)
    out.push({
      type: 'market.candle',
      source: raw.source ?? 'replay',
      symbol: raw.symbol,
      timeframe: raw.timeframe,
      state: 'closed',
      open, high, low, close,
      volume: Number(raw.volume) || 0,
      openTime,
      closeTime,
      eventTime: closeTime,
      ingestTime: Number(raw.ingestTime) || closeTime
    })
  }
  out.sort((a, b) => a.openTime - b.openTime)
  return out
}

/** '1m' | '4m' | '15m' | '1h' … → milliseconds (pacing base for play()). */
export function intervalToMs(interval) {
  const m = /^(\d+)([smhdw])$/.exec(String(interval ?? '').trim())
  if (!m) throw new Error(`replay: cannot parse interval "${interval}"`)
  const n = Number(m[1])
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]]
  return n * unit
}

/**
 * @param {object} o
 * @param {string} o.symbol       instrument (BTCUSDT…)
 * @param {string} o.timeframe    candle interval ('1m', '15m'…)
 * @param {Array}  o.bars         raw historical candles (closed + forming)
 * @returns player — see object literal below.
 */
export function createReplayPlayer({ symbol, timeframe, bars }) {
  const clean = normalizeReplayBars(bars)
  if (clean.length === 0) throw new Error('replay: no closed bars to play')

  // D18: simulated clock starting at the first bar; monotonic from here on.
  const clock = createTradingClock({ mode: 'replay', start: clean[0].openTime })

  let cursor = 0 // index of the NEXT bar — private future data
  let mode = 'ready'
  let speed = 1
  const emitted = [] // played events, in play order

  const player = {
    symbol,
    timeframe,

    state: () => ({
      symbol,
      timeframe,
      cursor,
      total: clean.length,
      mode,
      speed,
      now: clock.now()
    }),

    /** D17 gate: can an event at `eventTime` be consumed at the current clock? */
    canUse: (eventTime) => clock.canUse(eventTime),

    play() {
      if (mode === 'done') throw new Error('replay: session already finished')
      mode = 'playing'
      return mode
    },

    pause() {
      if (mode === 'playing') mode = 'paused'
      else if (mode === 'ready') mode = 'paused'
      return mode
    },

    setSpeed(next) {
      const s = Number(next)
      if (!REPLAY_SPEEDS.includes(s)) {
        throw new Error(`replay: speed must be one of ${REPLAY_SPEEDS.join('/')} (got ${next})`)
      }
      speed = s
      return speed
    },

    /**
     * Emit the next `n` bars (default 1). Advances the clock to each emitted
     * bar's eventTime — never past the last one. Stepping a finished session
     * returns [] (idempotent), stepping from 'ready' parks it in 'paused'
     * so play() can resume later.
     */
    step(n = 1) {
      const count = Number(n)
      if (!Number.isInteger(count) || count < 1) throw new Error(`replay: step needs a positive integer (got ${n})`)
      if (mode === 'done') return []
      const out = []
      while (out.length < count && cursor < clean.length) {
        const bar = clean[cursor]
        clock.setNow(bar.eventTime) // throws if ever backwards (D18)
        emitted.push(bar)
        out.push(bar)
        cursor++
      }
      if (cursor >= clean.length) mode = 'done'
      else if (mode === 'ready') mode = 'paused'
      return out
    },

    /** Events emitted so far, sliced from `since` (the client's cursor). */
    takeEvents: (since = 0) => {
      const from = Number(since)
      const start = Number.isInteger(from) && from > 0 ? from : 0
      return emitted.slice(start)
    },

    playedCount: () => emitted.length,

    /**
     * Latest played bar as a fill-model quote (same { last, time } shape
     * exec/paper.mjs quoteFor produces) — null until the first step, so a
     * fill attempt before any bar is refused instead of quoting the future.
     */
    quote() {
      if (emitted.length === 0) return null
      const last = emitted[emitted.length - 1]
      return { last: last.close, time: last.eventTime }
    },

    /** Wall-clock delay until the next auto-step at the current speed. */
    nextDelayMs: (candleMs) => Math.max(1, Math.round(Number(candleMs) / speed)),

    done: () => mode === 'done'
  }

  return player
}
