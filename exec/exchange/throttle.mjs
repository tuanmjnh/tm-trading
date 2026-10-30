// =============================================================================
//  TM TRADING — V3.9 per-venue throttle / backoff / clock-skew (§63.13/§64.7).
//
//  Each profile owns an ISOLATED budget + backoff + clock-skew record. One
//  venue hitting a rate limit or a banned window can NEVER consume or poison
//  another venue's budget (the historical cross-contaminated -1003/418 finding).
//  Pure in-memory state keyed by profileId; injectable clock for tests.
// =============================================================================

import { resolveProfile } from './profiles.mjs'

/**
 * Create an isolated throttle/backoff/clock state bucket for one profile.
 * @param {string} profileId
 * @param {object} [deps] { now }
 */
export function createVenueThrottle(profileId, deps = {}) {
  const now = deps.now ?? (() => Date.now())
  const profile = resolveProfile(profileId)
  const budget = Number(profile.rateLimit?.weightPerMinute ?? 1200)
  const state = {
    profileId,
    venue: profile.venue,
    budgetPerMinute: budget,
    usedWeight: 0,
    windowStart: now(),
    retryAfterMs: 0, // set when the venue asks us to back off (429/418/-1003)
    backoffAttempt: 0,
    clockSkewMs: 0, // venueTime - localTime, measured from server-time endpoint
    lastErrorAt: null,
    lastErrorCode: null,
  }

  function rollWindow() {
    const t = now()
    if (t - state.windowStart >= 60_000) {
      state.windowStart = t
      state.usedWeight = 0
    }
  }

  return {
    get state() { return { ...state } },
    profileId,
    venue: state.venue,

    /** Remaining request-weight budget in the current minute window. */
    remaining() { rollWindow(); return Math.max(0, state.budgetPerMinute - state.usedWeight) },

    /**
     * Reserve `weight` from THIS venue's budget only. Returns {ok, waitMs}.
     * Never touches another profile's bucket.
     */
    reserve(weight = 1) {
      rollWindow()
      const t = now()
      if (state.retryAfterMs > 0) {
        const wait = state.retryAfterMs - t
        if (wait > 0) return { ok: false, waitMs: wait, reason: 'retry-after' }
        state.retryAfterMs = 0
        state.backoffAttempt = 0
      }
      if (state.usedWeight + weight > state.budgetPerMinute) {
        return { ok: false, waitMs: Math.max(0, 60_000 - (t - state.windowStart)), reason: 'budget' }
      }
      state.usedWeight += weight
      return { ok: true, waitMs: 0 }
    },

    /** Record a measured used-weight from a venue response header. */
    observeUsedWeight(value) {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) { rollWindow(); state.usedWeight = n }
    },

    /**
     * Apply bounded exponential backoff with jitter after a retryable failure.
     * Isolated to this profile. `retryAfterMs` from a 429/418 header wins.
     */
    backoff({ retryAfterMs = null, attempt = null } = {}) {
      state.backoffAttempt = attempt == null ? state.backoffAttempt + 1 : Number(attempt)
      const t = now()
      let wait
      if (retryAfterMs != null && Number.isFinite(Number(retryAfterMs))) {
        wait = Number(retryAfterMs)
      } else {
        const base = Math.min(30_000, 250 * 2 ** Math.min(state.backoffAttempt, 7))
        wait = base + Math.floor(base * 0.2 * ((t % 1000) / 1000)) // deterministic-ish jitter
      }
      state.retryAfterMs = t + wait
      state.lastErrorAt = t
      return wait
    },

    /** Record an error code (sanitized upstream) for health reporting. */
    noteError(code) { state.lastErrorAt = now(); state.lastErrorCode = String(code ?? null) },

    /** Measure clock skew from a venue server-time response. */
    setClockSkew(venueTimeMs) {
      const v = Number(venueTimeMs)
      if (Number.isFinite(v)) state.clockSkewMs = v - now()
    },

    /** Reset transient backoff (e.g. after a successful reconcile). */
    reset() { state.retryAfterMs = 0; state.backoffAttempt = 0; state.usedWeight = 0; state.windowStart = now() },
  }
}

/**
 * A registry of isolated throttles, one per profile. Getting a throttle for a
 * profile never creates or touches another profile's state.
 */
export function createThrottleRegistry(deps = {}) {
  const map = new Map()
  return {
    get(profileId) {
      const key = String(profileId).toLowerCase()
      if (!map.has(key)) map.set(key, createVenueThrottle(key, deps))
      return map.get(key)
    },
    has(profileId) { return map.has(String(profileId).toLowerCase()) },
    snapshot() { return [...map.values()].map((t) => t.state) },
    reset(profileId) { const t = map.get(String(profileId).toLowerCase()); if (t) t.reset() },
  }
}
