// =============================================================================
//  TM TRADING — V3.9 failover policy engine (§64.5/§64.6/§64.7).
//
//  TWO failover policies that must NEVER be conflated:
//
//   A. MARKET-DATA failover — may switch the analysis/reference price source to
//      a backup venue ONLY when the user AND strategy explicitly allow
//      ALLOW_REFERENCE_FAILOVER. The switch is labelled with its actual source,
//      emits a durable `market.source-switched` event, and is REFERENCE data:
//      it is never used as the execution venue's mark price, nor to reconcile
//      position PnL, nor as account/order/fill truth. If the strategy needs
//      venue-native marks/funding/order-book, we PAUSE ENTRIES instead of
//      switching those fields to another venue.
//
//   B. EXECUTION-VENUE failover — NEVER automatic. If the execution venue fails,
//      the session goes DEGRADED, new entries are blocked, read-only recovery is
//      retried with bounded backoff, uncertain orders are reconciled (never
//      blind-resent), and every open order/position KEEPS its original
//      venue/account ownership. Switching execution venue is an explicit,
//      audited, MANUAL action that starts a NEW session after safety checks
//      (flat + no pending orders for a simple switch). No path selects
//      production/mainnet endpoints.
//
//  Pure functions — no I/O, no clock (time injected). Fully unit-testable.
// =============================================================================

import { MARKET_DATA_POLICY, EXECUTION_SWITCH_POLICY, VENUES } from './profiles.mjs'
import { VENUE_STATUS } from './health.mjs'

// Re-export the policy enums so consumers import failover semantics from one place.
export { MARKET_DATA_POLICY, EXECUTION_SWITCH_POLICY }

/** Read-only reason codes surfaced to UI/audit (never success-shaped). */
export const FAILOVER_CODES = Object.freeze({
  MARKET_FALLBACK_DISABLED: 'market.fallback-disabled',
  MARKET_FALLBACK_USED: 'market.fallback-used',
  MARKET_NATIVE_REQUIRED_PAUSED: 'market.native-required-paused',
  MARKET_NO_HEALTHY_SOURCE: 'market.no-healthy-source',
  EXEC_DEGRADED: 'exec.degraded-block-entries',
  EXEC_IMMUTABLE_VIOLATION: 'exec.venue-immutable-violation',
  EXEC_SWITCH_REQUIRES_FLAT: 'exec.switch-requires-flat',
  EXEC_SWITCH_NEW_SESSION: 'exec.switch-new-session',
})

// ---------------------------------------------------------------------------
// A. MARKET-DATA failover
// ---------------------------------------------------------------------------

/**
 * Resolve which venue supplies market OBSERVATIONS (reference/analysis), and
 * whether entries must pause. This NEVER changes the execution venue.
 *
 * @param {object} input {
 *   preferredVenue, policy, fallbackOrder, strategyRequiresNativeMark,
 *   marketHealth: { [venue]: 'up'|'down'|'unknown' }, instrumentMapping, at
 * }
 * @returns {{ source, isFallback, labelled, reference, pauseEntries, code, event? }}
 */
export function resolveMarketSource(input = {}) {
  const {
    preferredVenue, policy = MARKET_DATA_POLICY.PREFERRED_ONLY, fallbackOrder = [],
    strategyRequiresNativeMark = false, marketHealth = {}, instrumentMapping = null, at = Date.now(),
  } = input

  const healthy = (v) => marketHealth[v] === 'up'
  const base = { reference: true, pauseEntries: false, event: null, instrumentMapping }

  if (healthy(preferredVenue)) {
    return { ...base, source: preferredVenue, isFallback: false, labelled: `MARKET DATA SOURCE: ${preferredVenue.toUpperCase()} (PREFERRED)`, code: null }
  }

  // Preferred is unhealthy. What we do depends on policy + strategy need.
  const allowFailover = policy === MARKET_DATA_POLICY.ALLOW_REFERENCE_FAILOVER
  const candidate = (fallbackOrder ?? []).find((v) => v !== preferredVenue && VENUES.includes(v) && healthy(v)) ?? null

  // If the strategy requires venue-native marks/funding/order-book, another
  // venue's price is NOT a substitute — pause entries rather than switch.
  if (strategyRequiresNativeMark) {
    return { ...base, source: preferredVenue, isFallback: false, labelled: `MARKET DATA SOURCE: ${String(preferredVenue).toUpperCase()} (STALE/UNAVAILABLE)`, pauseEntries: true, code: FAILOVER_CODES.MARKET_NATIVE_REQUIRED_PAUSED }
  }

  if (!allowFailover) {
    // PREFERRED_ONLY: no substitute. Entries pause; source stays preferred.
    return { ...base, source: preferredVenue, isFallback: false, labelled: `MARKET DATA SOURCE: ${String(preferredVenue).toUpperCase()} (UNAVAILABLE)`, pauseEntries: !healthy(preferredVenue), code: FAILOVER_CODES.MARKET_FALLBACK_DISABLED }
  }

  if (!candidate) {
    return { ...base, source: null, isFallback: false, labelled: 'MARKET DATA SOURCE: NONE HEALTHY', pauseEntries: true, code: FAILOVER_CODES.MARKET_NO_HEALTHY_SOURCE }
  }

  // ALLOW_REFERENCE_FAILOVER + a healthy backup: switch the REFERENCE source,
  // emit a durable event, and label it clearly as fallback reference data.
  const event = marketSourceSwitchedEvent({ from: preferredVenue, to: candidate, instrumentMapping, reason: 'preferred-unhealthy', quality: 'reference', strategyPolicy: policy, at })
  return {
    ...base, source: candidate, isFallback: true,
    labelled: `FALLBACK DATA SOURCE: ${candidate.toUpperCase()} (REFERENCE ONLY — not execution mark)`,
    code: FAILOVER_CODES.MARKET_FALLBACK_USED, event,
  }
}

/** Durable `market.source-switched` event (§64.5A). Secret-free. */
export function marketSourceSwitchedEvent({ from, to, instrumentMapping = null, reason, quality = 'reference', strategyPolicy, at = Date.now() }) {
  return {
    type: 'market.source-switched', at,
    previousVenue: from ?? null, newVenue: to ?? null,
    instrumentMapping, reason: String(reason ?? ''), quality, strategyPolicy,
    reference: true, // cross-venue prices are reference data, never execution truth
    note: 'Market-data source switch. Execution venue is unchanged. Do not use as mark/account/order/fill truth.',
  }
}

// ---------------------------------------------------------------------------
// B. EXECUTION-VENUE failover
// ---------------------------------------------------------------------------

/**
 * Handle an execution-venue failure WITHOUT switching venue. Marks DEGRADED,
 * blocks new entries, preserves venue/account ownership, and prescribes
 * read-only recovery + reconciliation. Never auto-switches, never touches
 * production endpoints.
 * @returns {{ sessionState, blockNewEntries, preserveVenueOwnership, switchVenue, recovery, code }}
 */
export function onExecutionVenueFailure(_input = {}) {
  return {
    sessionState: VENUE_STATUS.DEGRADED,
    blockNewEntries: true,
    preserveVenueOwnership: true,
    switchVenue: false, // NEVER automatic
    recovery: Object.freeze(['retry-readonly-with-backoff', 'reconcile-uncertain-orders-by-client-id', 'preserve-open-positions-under-original-venue', 'offer-manual-new-session-switch']),
    code: FAILOVER_CODES.EXEC_DEGRADED,
  }
}

/**
 * Guard the immutability of an ACTIVE session's execution venue (§64.5B/§64.8).
 * An active (non-terminal) session can NEVER change execution venue; a switch is
 * a NEW session. Returns { ok } or a rejection with a stable code.
 */
export function assertExecutionVenueImmutable({ session, requestedVenue, now = Date.now() } = {}) {
  const active = session && !['completed', 'failed', 'halted', 'stopped'].includes(String(session.state ?? '').toLowerCase())
  const current = String(session?.executionVenue ?? '')
  const requested = String(requestedVenue ?? '')
  if (active && requested && current && requested !== current) {
    return {
      ok: false, code: FAILOVER_CODES.EXEC_IMMUTABLE_VIOLATION, now,
      message: `Active session execution venue is immutable (${current}); switching to ${requested} requires a NEW session`,
      audit: { type: 'execution.switch-rejected', sessionId: session.sessionId ?? null, from: current, requested, at: now },
    }
  }
  return { ok: true, code: null, now }
}

/**
 * Safety gate for a MANUAL "switch venue for next session" action (§64.5B step 6).
 * A simple switch requires the current venue to be FLAT with no pending orders.
 * If not flat, the operator must reconcile/manage those demo positions first; a
 * migration workflow is out of scope. Target must be a known venue and the
 * switch policy must be MANUAL_NEW_SESSION_ONLY.
 */
export function canSwitchForNextSession({ currentVenue, targetVenue, openPositions = [], openOrders = [], switchPolicy = EXECUTION_SWITCH_POLICY.MANUAL_NEW_SESSION_ONLY } = {}) {
  if (switchPolicy !== EXECUTION_SWITCH_POLICY.MANUAL_NEW_SESSION_ONLY) {
    return { ok: false, code: FAILOVER_CODES.EXEC_SWITCH_REQUIRES_FLAT, reason: 'Only MANUAL_NEW_SESSION_ONLY switching is permitted' }
  }
  if (!VENUES.includes(String(targetVenue))) return { ok: false, code: FAILOVER_CODES.EXEC_SWITCH_REQUIRES_FLAT, reason: `Unknown target venue ${String(targetVenue)}` }
  if (String(targetVenue) === String(currentVenue)) return { ok: false, code: FAILOVER_CODES.EXEC_SWITCH_REQUIRES_FLAT, reason: 'Target venue is the same as the current venue' }
  const flat = (openPositions?.length ?? 0) === 0
  const noPending = (openOrders?.length ?? 0) === 0
  if (!flat || !noPending) {
    return {
      ok: false, code: FAILOVER_CODES.EXEC_SWITCH_REQUIRES_FLAT,
      reason: `Current venue must be flat with no pending orders (positions=${openPositions?.length ?? 0}, openOrders=${openOrders?.length ?? 0}). Reconcile/close them first; position migration is out of scope.`,
      requiresFlat: true,
    }
  }
  return { ok: true, code: null, requiresFlat: false }
}

/**
 * Build the audited manual switch plan. It NEVER migrates an open position or
 * merges PnL; it records an audit event and describes the NEW session to start.
 */
export function planVenueSwitch({ ownerId, accountId, sessionId, currentVenue, targetVenue, connectionId, productProfile, gate, now = Date.now() } = {}) {
  const allowed = gate?.ok === true
  return {
    allowed,
    startsNewSession: allowed, // execution switch is new-session-only
    migratesPositions: false, mergesPnl: false,
    audit: {
      type: allowed ? 'execution.switch-requested' : 'execution.switch-rejected',
      at: now, ownerId: ownerId ?? null, accountId: accountId ?? null, sessionId: sessionId ?? null,
      from: currentVenue ?? null, to: targetVenue ?? null, connectionId: connectionId ?? null, productProfile: productProfile ?? null,
      gateCode: gate?.code ?? null, gateReason: gate?.reason ?? null,
    },
    ...(allowed ? {} : { reason: gate?.reason ?? 'switch not permitted' }),
  }
}
