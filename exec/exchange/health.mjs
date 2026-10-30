// =============================================================================
//  TM TRADING — V3.9 per-venue health + capability verification (§63.13/§64.4/§64.7/§64.8).
//
//  Each profile owns an ISOLATED health record. A failure on one venue can never
//  mutate another venue's record (the historical cross-contamination finding).
//
//  Declared vs verified capabilities (§64.8): a profile DECLARES capabilities
//  from official docs, but an execution capability is only ENABLED after a live
//  probe VERIFIES it. `canExecute` fails closed until every required capability
//  is verified SUPPORTED. A connected public stream alone is never evidence that
//  authenticated demo execution works.
// =============================================================================

import { resolveProfile, CAP, EXECUTION_REQUIRED_CAPS, capabilityGaps } from './profiles.mjs'

/** Overall runtime status of one venue connection. */
export const VENUE_STATUS = Object.freeze({ READY: 'READY', DEGRADED: 'DEGRADED', STALE: 'STALE', DISCONNECTED: 'DISCONNECTED' })

const DEFAULT_TOLERANCE = Object.freeze({ clockSkewMs: 1000, marketMaxAgeMs: 15_000, privateMaxAgeMs: 30_000 })

function blankRecord(profileId, profile) {
  return {
    profileId, venue: profile.venue, environment: 'DEMO',
    restAccount: { status: 'unknown', latencyMs: null, lastCheckAt: null, errorCode: null },
    privateStream: { status: 'unknown', lastEventAt: null, reconnects: 0, authenticated: false },
    publicStream: { status: 'unknown', lastEventAt: null, reconnects: 0 },
    clockSkewMs: null,
    rateLimit: { remaining: null, budgetPerMinute: profile.rateLimit?.weightPerMinute ?? null },
    lastReconcileAt: null,
    reconcile: { missing: 0, duplicate: 0, unresolved: 0 },
    declared: { ...profile.capabilities },
    verified: {}, // capability -> { level, verifiedAt }
    status: VENUE_STATUS.DISCONNECTED,
    stale: { market: false, private: false },
  }
}

/**
 * Isolated health registry, one record per profile. `now` is injectable.
 */
export function createHealthRegistry(deps = {}) {
  const now = deps.now ?? (() => Date.now())
  const tolerance = { ...DEFAULT_TOLERANCE, ...(deps.tolerance ?? {}) }
  const records = new Map()

  function ensure(profileId) {
    const key = String(profileId).toLowerCase()
    if (!records.has(key)) records.set(key, blankRecord(key, resolveProfile(key)))
    return records.get(key)
  }

  function recompute(rec) {
    const marketAge = rec.publicStream.lastEventAt ? now() - rec.publicStream.lastEventAt : Infinity
    const privateAge = rec.privateStream.lastEventAt ? now() - rec.privateStream.lastEventAt : Infinity
    rec.stale.market = rec.publicStream.status === 'connected' && marketAge > tolerance.marketMaxAgeMs
    rec.stale.private = rec.privateStream.status === 'connected' && privateAge > tolerance.privateMaxAgeMs
    const skewBad = rec.clockSkewMs != null && Math.abs(rec.clockSkewMs) > tolerance.clockSkewMs

    if (rec.restAccount.status === 'down') rec.status = VENUE_STATUS.DEGRADED
    else if (rec.restAccount.status !== 'up') rec.status = VENUE_STATUS.DISCONNECTED
    else if (rec.stale.market || rec.stale.private) rec.status = VENUE_STATUS.STALE
    else if (skewBad || rec.reconcile.unresolved > 0) rec.status = VENUE_STATUS.DEGRADED
    else rec.status = VENUE_STATUS.READY
    return rec.status
  }

  return {
    ensure,
    has: (profileId) => records.has(String(profileId).toLowerCase()),

    setRestAccount(profileId, { status, latencyMs = null, errorCode = null }) {
      const rec = ensure(profileId)
      rec.restAccount = { status, latencyMs, lastCheckAt: now(), errorCode }
      return recompute(rec)
    },
    setPrivateStream(profileId, { status, reconnects, authenticated }) {
      const rec = ensure(profileId)
      rec.privateStream = { ...rec.privateStream, status, reconnects: reconnects ?? rec.privateStream.reconnects, authenticated: authenticated ?? rec.privateStream.authenticated }
      return recompute(rec)
    },
    setPublicStream(profileId, { status, reconnects }) {
      const rec = ensure(profileId)
      rec.publicStream = { ...rec.publicStream, status, reconnects: reconnects ?? rec.publicStream.reconnects }
      return recompute(rec)
    },
    markPrivateEvent(profileId) { const rec = ensure(profileId); rec.privateStream.lastEventAt = now(); return recompute(rec) },
    markPublicEvent(profileId) { const rec = ensure(profileId); rec.publicStream.lastEventAt = now(); return recompute(rec) },
    setClockSkew(profileId, skewMs) { const rec = ensure(profileId); rec.clockSkewMs = Number(skewMs); return recompute(rec) },
    setRateRemaining(profileId, remaining) { const rec = ensure(profileId); rec.rateLimit.remaining = Number(remaining); return rec.status },
    markReconciled(profileId, { missing = 0, duplicate = 0, unresolved = 0 } = {}) {
      const rec = ensure(profileId)
      rec.lastReconcileAt = now()
      rec.reconcile = { missing, duplicate, unresolved }
      return recompute(rec)
    },

    /**
     * Promote a DECLARED capability to VERIFIED after a successful live probe.
     * Only SUPPORTED verifications enable execution; a failed probe records the
     * true level (UNSUPPORTED/UNKNOWN) and keeps the capability fail-closed.
     */
    verifyCapability(profileId, capability, level) {
      const rec = ensure(profileId)
      rec.verified[capability] = { level: level === CAP.SUPPORTED ? CAP.SUPPORTED : (level || CAP.UNKNOWN), verifiedAt: now() }
      return recompute(rec)
    },
    verifyMany(profileId, map) { for (const [k, v] of Object.entries(map ?? {})) this.verifyCapability(profileId, k, v) },

    /** Effective capability = verified when present, else declared, else UNKNOWN. */
    effectiveCapability(profileId, capability) {
      const rec = ensure(profileId)
      if (rec.verified[capability]) return rec.verified[capability].level
      return rec.declared[capability] ?? CAP.UNKNOWN
    },
    effectiveCapabilities(profileId) {
      const rec = ensure(profileId)
      const out = {}
      for (const k of Object.keys(rec.declared)) out[k] = this.effectiveCapability(profileId, k)
      for (const k of Object.keys(rec.verified)) out[k] = this.effectiveCapability(profileId, k)
      return out
    },

    /** Fail-closed: execution allowed only when every required cap is VERIFIED SUPPORTED. */
    canExecute(profileId) {
      const rec = ensure(profileId)
      const verifiedLevels = {}
      for (const k of EXECUTION_REQUIRED_CAPS) verifiedLevels[k] = rec.verified[k]?.level ?? CAP.UNKNOWN
      const ok = EXECUTION_REQUIRED_CAPS.every((k) => verifiedLevels[k] === CAP.SUPPORTED)
      return { ok, gaps: capabilityGaps(verifiedLevels, EXECUTION_REQUIRED_CAPS), verified: rec.verified }
    },

    getHealth(profileId) { const rec = ensure(profileId); recompute(rec); return structuredClone(rec) },
    snapshotAll() { return [...records.values()].map((r) => { recompute(r); return structuredClone(r) }) },
    /** Test/ops: recompute freshness now (e.g. after time passes). */
    refresh(profileId) { return recompute(ensure(profileId)) },
  }
}
