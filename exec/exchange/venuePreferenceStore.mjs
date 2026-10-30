// =============================================================================
//  VenuePreference store (roadmap §64.4/§64.5). Owner-scoped, fail-closed.
//
//  The environment is ALWAYS DEMO and the switch policy is ALWAYS
//  MANUAL_NEW_SESSION_ONLY — a caller cannot persist a preference that would
//  allow production execution or automatic execution-venue switching. Market
//  data failover is resolved through the pure policy engine (failover.mjs) and
//  is reference-only; it never changes the execution venue.
// =============================================================================

import { VenuePreference, MARKET_DATA_POLICIES, EXECUTION_SWITCH_POLICIES, PREFERENCE_VENUES } from '../../engine/models/venuePreference.mjs'
import { resolveMarketSource } from './failover.mjs'

const DEFAULTS = Object.freeze({
  preferredVenue: 'bybit',
  executionEnvironment: 'DEMO',
  marketDataPolicy: 'PREFERRED_ONLY',
  marketDataFallbackOrder: [],
  executionSwitchPolicy: 'MANUAL_NEW_SESSION_ONLY',
})

const prefId = (ownerId, accountId = 'default') => `${ownerId}:${accountId}`

function sanitize(input = {}) {
  const preferredVenue = PREFERENCE_VENUES.includes(input.preferredVenue) ? input.preferredVenue : DEFAULTS.preferredVenue
  const marketDataPolicy = MARKET_DATA_POLICIES.includes(input.marketDataPolicy) ? input.marketDataPolicy : DEFAULTS.marketDataPolicy
  // Fallback order: only known venues, deduped, never including the preferred venue.
  const seen = new Set()
  const marketDataFallbackOrder = (Array.isArray(input.marketDataFallbackOrder) ? input.marketDataFallbackOrder : [])
    .filter((v) => PREFERENCE_VENUES.includes(v) && v !== preferredVenue && !seen.has(v) && (seen.add(v), true))
  return {
    preferredVenue,
    executionEnvironment: 'DEMO', // forced — never production
    marketDataPolicy,
    marketDataFallbackOrder,
    executionSwitchPolicy: 'MANUAL_NEW_SESSION_ONLY', // forced — never auto-switch
  }
}

function publicView(row) {
  return {
    ownerId: row.ownerId, accountId: row.accountId, preferredVenue: row.preferredVenue,
    executionEnvironment: row.executionEnvironment ?? 'DEMO', marketDataPolicy: row.marketDataPolicy,
    marketDataFallbackOrder: row.marketDataFallbackOrder ?? [], executionSwitchPolicy: row.executionSwitchPolicy ?? 'MANUAL_NEW_SESSION_ONLY',
    pendingVenueSwitch: row.pendingVenueSwitch?.targetVenue ? { targetVenue: row.pendingVenueSwitch.targetVenue, requestedAt: row.pendingVenueSwitch.requestedAt, reason: row.pendingVenueSwitch.reason } : null,
  }
}

export async function getVenuePreference(ownerId, accountId = 'default') {
  const row = await VenuePreference.findOne({ _id: prefId(ownerId, accountId), ownerId }).lean()
  if (row) return publicView(row)
  return { ownerId, accountId, ...DEFAULTS, pendingVenueSwitch: null }
}

export async function saveVenuePreference(ownerId, input = {}, accountId = 'default') {
  const clean = sanitize(input)
  const row = await VenuePreference.findOneAndUpdate(
    { _id: prefId(ownerId, accountId), ownerId },
    { $set: { ...clean, accountId }, $setOnInsert: { _id: prefId(ownerId, accountId), ownerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  return publicView(row)
}

/**
 * Record an audited "switch venue for NEXT session" intent. This never changes
 * a running session's execution venue (see failover.assertExecutionVenueImmutable);
 * it only stages a target the next session start may apply after safety checks.
 */
export async function requestVenueSwitch(ownerId, { accountId = 'default', targetVenue, reason = null, now = Date.now() } = {}) {
  if (!PREFERENCE_VENUES.includes(targetVenue)) {
    throw Object.assign(new Error(`Unknown target venue ${String(targetVenue)}`), { code: 'exchange.invalid-venue' })
  }
  const current = await getVenuePreference(ownerId, accountId)
  if (current.preferredVenue === targetVenue) {
    throw Object.assign(new Error('Target venue is already the preferred venue'), { code: 'exchange.same-venue' })
  }
  const row = await VenuePreference.findOneAndUpdate(
    { _id: prefId(ownerId, accountId), ownerId },
    { $set: { pendingVenueSwitch: { targetVenue, requestedAt: Number(now), reason: reason == null ? null : String(reason).slice(0, 240) } } },
    { upsert: false, new: true },
  ).lean()
  if (!row) throw Object.assign(new Error('Venue preference not found'), { code: 'exchange.preference-not-found' })
  return publicView(row)
}

export async function clearVenueSwitch(ownerId, accountId = 'default') {
  await VenuePreference.updateOne({ _id: prefId(ownerId, accountId), ownerId }, { $set: { pendingVenueSwitch: { targetVenue: null, requestedAt: null, reason: null } } })
  return getVenuePreference(ownerId, accountId)
}

/**
 * Resolve the MARKET DATA source for a preference given per-venue market health.
 * Reference-only; never changes execution venue. Returns the failover.mjs result
 * (source, isFallback, labelled, pauseEntries, event?).
 */
export function resolveMarketDataForPreference(preference, { marketHealth, strategyRequiresNativeMark = false, at = Date.now() } = {}) {
  return resolveMarketSource({
    preferredVenue: preference?.preferredVenue,
    policy: preference?.marketDataPolicy,
    fallbackOrder: preference?.marketDataFallbackOrder ?? [],
    strategyRequiresNativeMark,
    marketHealth,
    at,
  })
}

export { sanitize as _sanitizeVenuePreference }
