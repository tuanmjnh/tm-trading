// =============================================================================
//  TM TRADING — FEED HEALTH (roadmap V3.5 Slice F / §59.15 + D33 + §35) — PURE
//
//  The paper executor prices entries off REST klines, so "is the feed alive?"
//  for THAT process means: when did we last get data, and was it fresh when we
//  got it? This module measures exactly that from facts the caller observed —
//  it does no IO, no clock reads the caller did not pass, and it never turns
//  "no samples" into a healthy verdict (D12).
//
//  D33 connection loss is a STATE, not an error to hide. The states here map
//  onto qualityGates()'s `streamState` vocabulary (§35.1 blocks on anything
//  that is not a measured 'ok'):
//
//    ok            last fetch succeeded and the data it carried was fresh
//    degraded      last fetch succeeded but its data was beyond half the tf
//    stale         last fetch succeeded but the DATA is older than staleAfterMs
//    disconnected  every fetch since `failThreshold` attempts has failed
//    unknown       nothing observed yet (fail-closed: the gate blocks on it)
//
//  A "fetch succeeded" only counts while its bar/quote timestamp was fresh
//  enough — an endpoint that answers with old candles has not recovered.
//
//  Companion to exec/qualityGates.mjs: this module MEASURES the streamState
//  fact, qualityGates turns it (with the other §35 facts) into BLOCK/DEGRADED.
// =============================================================================

/** Version stamp (D1). */
export const FEED_HEALTH_SCHEMA_VERSION = 'feedHealth.v1'

/** D33 connection states (terminal vocabulary — no invented states). */
export const FEED_STATES = Object.freeze(['ok', 'degraded', 'stale', 'disconnected', 'unknown'])

export const FEED_DEFAULTS = Object.freeze({
  /** A fetch older than this (ms) is a failed fetch for state purposes. */
  staleAfterMs: 120_000,
  /** Consecutive failed fetches before the stream counts as disconnected. */
  failThreshold: 3,
  /** Data age beyond half the bar timeframe marks the stream degraded. */
  degradedAtBarFraction: 0.5,
})

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Track feed health per stream from OBSERVED fetch outcomes.
 *
 * @param {object} [opts]
 * @param {number} [opts.staleAfterMs]  fetch-data age that stops counting as fresh
 * @param {number} [opts.failThreshold] consecutive failures -> 'disconnected'
 * @param {number} [opts.tfMs]          bar timeframe (enables the degraded tier)
 * @param {() => number} [opts.now]     injectable clock (tests pass a fake)
 */
export function createFeedHealth(opts = {}) {
  const th = {
    staleAfterMs: num(opts.staleAfterMs) ?? FEED_DEFAULTS.staleAfterMs,
    failThreshold: Math.max(1, Math.floor(num(opts.failThreshold) ?? FEED_DEFAULTS.failThreshold)),
    tfMs: num(opts.tfMs),
    degradedAtBarFraction: num(opts.degradedAtBarFraction) ?? FEED_DEFAULTS.degradedAtBarFraction,
  }
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()

  /** @type {Map<string, {attempts:number, failures:number, lastOkAt:number|null, lastDataAt:number|null, lastAgeMs:number|null}>} */
  const streams = new Map()
  const slot = (stream) => {
    const key = String(stream ?? 'default')
    let s = streams.get(key)
    if (!s) { s = { attempts: 0, failures: 0, lastOkAt: null, lastDataAt: null, lastAgeMs: null }; streams.set(key, s) }
    return s
  }

  /**
   * Record one fetch attempt.
   * @param {string} stream    stream id (e.g. 'binance:fapi:kline1m:BTCUSDT')
   * @param {object} o
   * @param {boolean} o.ok            did the transport answer with usable data?
   * @param {number|null} [o.dataAt]  exchange/data timestamp carried by the data
   * @param {number} [o.at]           when WE observed it (default: now())
   * @returns {{ok:boolean, dataAgeMs:number|null}}
   */
  function record(stream, o = {}) {
    const s = slot(stream)
    const at = num(o.at) ?? now()
    const dataAt = num(o.dataAt)
    const dataAgeMs = dataAt == null ? null : Math.max(0, at - dataAt)
    s.attempts++
    // A transport answer whose data is beyond staleAfterMs is NOT a healthy
    // fetch — the endpoint responded, but the feed behind it has not.
    const fresh = o.ok === true && (dataAgeMs == null || dataAgeMs <= th.staleAfterMs)
    if (fresh) {
      s.failures = 0
      s.lastOkAt = at
      if (dataAt != null) s.lastDataAt = dataAt
      s.lastAgeMs = dataAgeMs
    } else {
      s.failures++
      s.lastAgeMs = dataAgeMs ?? s.lastAgeMs
    }
    return { ok: fresh, dataAgeMs }
  }

  /**
   * Current state of one stream (D33 vocabulary). Time is caller-supplied so
   * the verdict is deterministic.
   *
   * @param {string} stream
   * @param {{at?: number}} [o]
   * @returns {{state: 'ok'|'degraded'|'stale'|'disconnected'|'unknown', ageMs: number|null, failures: number, attempts: number, reasons: string[]}}
   */
  function state(stream, o = {}) {
    const s = streams.get(String(stream ?? 'default'))
    const at = num(o.at) ?? now()
    if (!s || s.attempts === 0) {
      return { state: 'unknown', ageMs: null, failures: 0, attempts: 0, reasons: ['no fetch observed yet'] }
    }
    const ageMs = s.lastDataAt != null ? Math.max(0, at - s.lastDataAt) : s.lastAgeMs
    const reasons = []
    if (s.failures >= th.failThreshold) {
      reasons.push(`${s.failures} consecutive failed fetches (threshold ${th.failThreshold})`)
      return { state: 'disconnected', ageMs, failures: s.failures, attempts: s.attempts, reasons }
    }
    if (s.failures > 0) {
      reasons.push(`${s.failures} recent failed fetch attempt(s)`)
      return { state: 'stale', ageMs, failures: s.failures, attempts: s.attempts, reasons }
    }
    if (ageMs != null && ageMs > th.staleAfterMs) {
      reasons.push(`newest data is ${ageMs}ms old > ${th.staleAfterMs}ms`)
      return { state: 'stale', ageMs, failures: s.failures, attempts: s.attempts, reasons }
    }
    if (th.tfMs != null && ageMs != null && ageMs > th.tfMs * th.degradedAtBarFraction) {
      reasons.push(`data age ${ageMs}ms > ${th.tfMs * th.degradedAtBarFraction}ms (half a bar)`)
      return { state: 'degraded', ageMs, failures: s.failures, attempts: s.attempts, reasons }
    }
    return { state: 'ok', ageMs, failures: s.failures, attempts: s.attempts, reasons }
  }

  return { record, state, thresholds: th, FEED_HEALTH_SCHEMA_VERSION }
}

/**
 * Candle-gap check between consecutive observed bars (§35.1
 * `candle_gap_unresolved`): a jump larger than one timeframe means the feed
 * skipped bars nobody filled in. Null-honest: fewer than two dated bars -> null
 * (unknown), never a fabricated false.
 *
 * @param {Array<number|null|undefined>} times  bar open times (ms), ascending
 * @param {number} tfMs
 * @returns {boolean|null}
 */
export function candleGapUnresolved(times, tfMs) {
  const list = (Array.isArray(times) ? times : []).map(num).filter((t) => t != null)
  const tf = num(tfMs)
  if (list.length < 2 || tf == null || tf <= 0) return null
  for (let i = 1; i < list.length; i++) {
    if (list[i] - list[i - 1] > tf) return true
  }
  return false
}
