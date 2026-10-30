// =============================================================================
//  TM TRADING — V3.9 exchange DEMO runtime factory + public surface.
//
//  `createExchangeRuntime` owns the SHARED-but-ISOLATED health and throttle
//  registries (one bucket per profile; a venue failure never touches another)
//  and hands out adapters. The bot/AI runtime and API routes go through this so
//  health/capability/failover state is consistent and per-venue isolated.
// =============================================================================

import { createDemoAdapter } from './adapter.mjs'
import { createHealthRegistry } from './health.mjs'
import { createThrottleRegistry } from './throttle.mjs'

/**
 * @param {object} [deps] { fetchImpl, connectSocket, now }
 */
export function createExchangeRuntime(deps = {}) {
  const health = createHealthRegistry({ now: deps.now })
  const throttles = createThrottleRegistry({ now: deps.now })
  const adapters = new Map()

  return {
    health,
    throttles,

    /**
     * Get (or create) the adapter for one profile + credential set. Adapters are
     * cached per `ownerId:profileId` so health/throttle state is stable.
     */
    getAdapter({ ownerId, profileId, credentials, accountId = 'default', canonicalMapper, persist }) {
      const key = `${String(ownerId ?? 'anon')}:${String(profileId).toLowerCase()}:${String(accountId)}`
      if (adapters.has(key)) return adapters.get(key)
      const adapter = createDemoAdapter({
        profileId, credentials, accountId, canonicalMapper, persist,
        health, throttle: throttles.get(profileId),
        fetchImpl: deps.fetchImpl, connectSocket: deps.connectSocket, now: deps.now,
      })
      adapters.set(key, adapter)
      return adapter
    },

    /** Drop a cached adapter (e.g. after credential rotation / disconnect). */
    releaseAdapter({ ownerId, profileId, accountId = 'default' }) {
      adapters.delete(`${String(ownerId ?? 'anon')}:${String(profileId).toLowerCase()}:${String(accountId)}`)
    },

    /** Health snapshot across all venues the runtime has touched (for the UI). */
    healthSnapshot() { return health.snapshotAll() },
  }
}

// --- re-exports (single import site for consumers) ---------------------------
export { createDemoAdapter } from './adapter.mjs'
export {
  VENUE_PROFILES, PROFILE_IDS, VENUES, ENVIRONMENT, CAP, MARKET_DATA_POLICY, EXECUTION_SWITCH_POLICY,
  EXECUTION_REQUIRED_CAPS, PRODUCTION_HOSTS, resolveProfile, profilesForVenue, capabilityOk, capabilityGaps,
  assertDemoRestHost, assertDemoWsHost, assertMarketWsHost, assertSimulatedTradingHeader,
} from './profiles.mjs'
export { createHealthRegistry, VENUE_STATUS } from './health.mjs'
export { createThrottleRegistry, createVenueThrottle } from './throttle.mjs'
export { createStream, wsProtocol, STREAM_STATES } from './stream.mjs'
export { sanitizeText, looksSecret, venueError, normalizeVenueError, classifyError, correlationId } from './errors.mjs'
export { dedupeFills, reconcileOrders, reconcilePositions, buildReconciliationResult, execKey, orderKey } from './reconcile.mjs'
export {
  resolveMarketSource, marketSourceSwitchedEvent, onExecutionVenueFailure,
  assertExecutionVenueImmutable, canSwitchForNextSession, planVenueSwitch, FAILOVER_CODES,
} from './failover.mjs'
export { executeExchangeDemoIntent, INTENT_RESULTS } from './executeIntent.mjs'
export { routeExchangeDemoIntent, getSharedRuntime, resetSharedRuntime } from './botBridge.mjs'
export {
  persistEvent, persistExecutions, upsertOrderMapping, getOrderMapping, listEvents, idempotencyKeyFor,
} from './eventStore.mjs'
export {
  getVenuePreference, saveVenuePreference, requestVenueSwitch, clearVenueSwitch, resolveMarketDataForPreference,
} from './venuePreferenceStore.mjs'
export {
  normalizeAccount, normalizePositions, normalizeOrder, normalizeExecution,
  normalizeFeeSchedule, normalizeFundingObservation, normalizeInstrument,
} from './normalize.mjs'
