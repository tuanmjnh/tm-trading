// =============================================================================
//  TM TRADING — one clock abstraction for LIVE / REPLAY / BACKTEST (D18) and
//  the future-data guard (D17).
//
//  D17: only data with `eventTime <= clock.now()` may be consumed — engines,
//  stores and the UI all ask the clock, never Date.now() directly.
//  D18: live = system/event time; replay/backtest = simulated time moved
//  explicitly forward (monotonic — a replay never rewinds).
//
//  Live clock skew: exchange events carry EXCHANGE timestamps, so a local
//  clock lagging the exchange would make every live event look "from the
//  future" and the D17 gate would black-hole the whole feed. The server
//  measures `exchangeTime - localTime` (REST /time) and installs it via
//  setSkew() so `now() + skew` is the exchange-domain now. The gate itself
//  stays strict (eventTime <= now + skew); skew is ALWAYS 0 outside live
//  mode — replay/backtest keep the pure simulated clock (D17/D18).
// =============================================================================

export const CLOCK_MODES = Object.freeze(['live', 'replay', 'backtest'])

/**
 * @param {object} [opts]
 * @param {'live'|'replay'|'backtest'} [opts.mode='live']
 * @param {() => number} [opts.nowFn=Date.now]  live-time source (injectable in tests)
 * @param {number} [opts.start]                  simulated start for replay/backtest
 */
export function createTradingClock({ mode = 'live', nowFn = Date.now, start } = {}) {
  if (!CLOCK_MODES.includes(mode)) {
    throw new Error(`clock: mode must be one of ${CLOCK_MODES.join('|')} (got ${mode})`)
  }
  const initial = Number.isFinite(Number(start)) ? Number(start) : nowFn()
  if (!Number.isFinite(initial)) throw new Error('clock: start must be a finite timestamp')
  let sim = initial
  let skew = 0

  const clock = {
    mode: () => mode,
    /** Current time of this clock (ms, UTC epoch). */
    now: () => (mode === 'live' ? nowFn() : sim),
    /** Move simulated time FORWARD (replay/backtest only — D18). */
    setNow(ms) {
      if (mode === 'live') throw new Error('clock: setNow is only valid in replay/backtest mode')
      const t = Number(ms)
      if (!Number.isFinite(t)) throw new Error(`clock: setNow needs a finite ms (got ${ms})`)
      if (t < sim) throw new Error(`clock: time must not go backwards (${t} < ${sim})`)
      sim = t
      return sim
    },
    /** Exchange-vs-local offset in ms (live only; see header). */
    setSkew(ms) {
      if (mode !== 'live') throw new Error('clock: setSkew is only valid in live mode')
      const t = Number(ms)
      if (!Number.isFinite(t)) throw new Error(`clock: setSkew needs a finite ms (got ${ms})`)
      skew = t
      return skew
    },
    skew: () => skew,
    /** D17 gate: is this event visible at the current clock time? */
    canUse(eventTime) {
      const t = Number(eventTime)
      return Number.isFinite(t) && t <= clock.now() + skew
    }
  }
  return clock
}
