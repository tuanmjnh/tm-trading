// =============================================================================
//  TM TRADING — V3.9 bot/AI → EXCHANGE_DEMO integration bridge (goal F, §63.9/§63.10).
//
//  ONE seam that indicator-bot and AI-bot workers call when a session is bound
//  to EXCHANGE_DEMO. It resolves the owner's encrypted demo connection, builds
//  (or reuses) the per-venue adapter from a process-shared runtime, and routes
//  the validated intent through the deterministic pipeline (Risk Gate → capability
//  gate → adapter → idempotent persistence).
//
//  SAFETY:
//   - Non-EXCHANGE_DEMO sessions are NOT routed here (returns routed:false) so the
//     existing internal-paper path stays the default and is untouched.
//   - The venue comes from the SESSION (immutable), never from the intent/AI/tool.
//   - Credentials are resolved server-side from the owner's stored connection;
//     the caller (browser/AI) can never supply a host or credentials.
//   - AI output is a proposal; only this pipeline (after Risk Gate) can submit.
// =============================================================================

import { createExchangeRuntime } from './index.mjs'
import { executeExchangeDemoIntent } from './executeIntent.mjs'
import { resolveDemoCredentials } from '../exchangeDemoStore.mjs'

let sharedRuntime = null

/** Process-shared runtime (isolated per-venue health + throttle registries). */
export function getSharedRuntime(deps = {}) {
  if (!sharedRuntime) sharedRuntime = createExchangeRuntime(deps)
  return sharedRuntime
}

/** Test/ops hook: drop the shared runtime (e.g. after config change). */
export function resetSharedRuntime() { sharedRuntime = null }

/**
 * Route a session order-intent to its bound demo venue.
 * @param {object} p {
 *   ownerId, session, intent, connectionProfile, accountId='default',
 *   deps: { resolveCredentials, runtime, persist, checkOrder, riskConfig, fetchImpl, connectSocket, now },
 *   models
 * }
 * @returns {{ routed:boolean, reason?:string, result?:object }}
 */
export async function routeExchangeDemoIntent(p = {}) {
  const { ownerId, session, intent, connectionProfile, accountId = 'default', deps = {}, models } = p

  // Only EXCHANGE_DEMO sessions route to a venue; everything else keeps the
  // existing internal-paper behaviour (caller decides).
  if (session?.executionMode !== 'EXCHANGE_DEMO') {
    return { routed: false, reason: 'not-exchange-demo' }
  }
  const venue = session.executionVenue
  if (!venue) return { routed: false, reason: 'missing-execution-venue' }

  const runtime = deps.runtime ?? getSharedRuntime({ fetchImpl: deps.fetchImpl, connectSocket: deps.connectSocket, now: deps.now })
  const resolveCredentials = deps.resolveCredentials ?? resolveDemoCredentials
  const profileId = connectionProfile ?? `${venue}`

  // Resolve encrypted demo credentials server-side (owner-scoped). Throws when
  // no enabled connection exists — fail closed, never fabricate.
  const credentials = await resolveCredentials(ownerId, profileId)

  const adapter = runtime.getAdapter({
    ownerId, profileId, credentials, accountId,
    persist: deps.persist, canonicalMapper: deps.canonicalMapper,
  })

  const result = await executeExchangeDemoIntent({
    ownerId, session, intent, adapter, models,
    persist: deps.persist, now: deps.now?.() ?? Date.now(),
    ...(deps.checkOrder ? { checkOrder: deps.checkOrder } : {}),
    ...(deps.riskConfig ? { riskConfig: deps.riskConfig } : {}),
    ...(deps.clientOrderId ? { clientOrderId: deps.clientOrderId } : {}),
  })
  return { routed: true, venue, profileId, result }
}
