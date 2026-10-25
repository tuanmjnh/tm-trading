#!/usr/bin/env node
// =============================================================================
//  TM TRADING - BOT SUPERVISOR CONTRACT  (roadmap §61.7 / §61.17 Phase E)
//
//  WHY THIS FILE EXISTS: `engine/models/botInstance.mjs` only defines the
//  persisted shape; its own comment says "the supervisor owns transitions".
//  There was no supervisor. This module is the deterministic, mongoose-free
//  contract every supervisor (worker process, child process or container)
//  must obey: which transitions are legal, who may issue a command, when a
//  lease is dead, and what a restart must do with an orphaned run.
//
//  PURE CONTRACT (no mongoose, no DB, no timers): the store layer
//  (`services/botRuntimeStore.mjs`) and the worker (`services/botWorker.mjs`)
//  both derive their decisions from these functions, so a policy change is a
//  reviewable diff here instead of a branch buried in a loop.
//
//  ROADMAP §61.7 STATE MAPPING: the roadmap names DRAFT/VALIDATING/READY and
//  DEGRADED/RETIRED, but `bot_instances.state` is a persisted enum already
//  pinned by tests/bots.test.ts. We map instead of churning the enum:
//    DRAFT/VALIDATING/READY -> queued      DEGRADED -> running + health
//    STARTING -> starting                  RETIRED  -> halted
//    RUNNING  -> running                   STOPPED  -> completed
//  `health` carries the degraded signal so no consumer has to invent a state.
// =============================================================================

import { createHash } from 'node:crypto'

/** Version of this contract. Any policy/shape change bumps this. */
export const SUPERVISOR_SCHEMA_VERSION = '1'

/** Default lease lifetime. A beat every cycle keeps it live. */
export const LEASE_TTL_MS = 30_000

/** Commands a user (or operator) may enqueue for an instance. */
export const SUPERVISOR_COMMANDS = Object.freeze(['start', 'pause', 'resume', 'stop'])

/** Health values written to `bot_instances.health`. */
export const HEALTH_STATES = Object.freeze(['ok', 'degraded', 'error', 'unknown'])

/**
 * Legal lifecycle edges. MUST stay in sync with `BOT_INSTANCE_STATES` in
 * `engine/models/botInstance.mjs` (pinned by tests/botSupervisor.test.ts).
 * Terminal states have no outgoing edge — a retired run is never resumed.
 */
export const BOT_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['starting', 'stopping', 'failed', 'halted']),
  starting: Object.freeze(['running', 'paused', 'stopping', 'failed', 'halted']),
  running: Object.freeze(['paused', 'stopping', 'completed', 'failed', 'halted']),
  paused: Object.freeze(['running', 'stopping', 'completed', 'failed', 'halted']),
  stopping: Object.freeze(['completed', 'failed', 'halted']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  halted: Object.freeze([]),
})

/** Command -> target state. */
const COMMAND_TARGET = Object.freeze({
  start: 'starting',
  pause: 'paused',
  resume: 'running',
  stop: 'stopping',
})

/**
 * Repeating a command whose target is already reached is a no-op success
 * (command delivery is at-least-once; the UI must not see a failure for a
 * retried request). Keyed by command, listing states that already satisfy it.
 */
const IDEMPOTENT_STATES = Object.freeze({
  start: Object.freeze(['starting', 'running']),
  pause: Object.freeze(['paused']),
  resume: Object.freeze(['running']),
  stop: Object.freeze(['stopping']),
})

/** States a supervisor must never resume. */
export const SUPERVISOR_TERMINAL_STATES = Object.freeze(['completed', 'failed', 'halted'])

/** States whose lease must be live for work to continue. */
export const SUPERVISOR_ACTIVE_STATES = Object.freeze(['starting', 'running', 'paused', 'stopping'])

export function isTerminalState(state) {
  return SUPERVISOR_TERMINAL_STATES.includes(state)
}

export function isActiveState(state) {
  return SUPERVISOR_ACTIVE_STATES.includes(state)
}

/** True when `from -> to` is a legal edge (a self-edge is never legal). */
export function canTransition(from, to) {
  const edges = BOT_TRANSITIONS[from]
  return Array.isArray(edges) && edges.includes(to)
}

/**
 * Stable supervisor identity: one logical supervisor per owner. `nonce` makes
 * two processes of the same owner distinguishable so the lease is exclusive.
 */
export function supervisorId(ownerId, nonce = '') {
  const owner = String(ownerId ?? '')
  if (owner === '') throw new Error('supervisorId: ownerId is required')
  const h = createHash('sha256').update(owner).digest('hex').slice(0, 16)
  const tail = nonce === '' ? '' : `_${String(nonce).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}`
  return `sup_${h}${tail}`
}

/**
 * Fresh lease document. `claimedAt` is preserved by the store on renewal
 * (`$set` only touches `beatAt`/`expiresAt`/`supervisorId`).
 */
export function leaseDoc({ supervisorId: sid, now = Date.now(), ttlMs = LEASE_TTL_MS } = {}) {
  if (typeof sid !== 'string' || sid === '') throw new Error('leaseDoc: supervisorId is required')
  const at = Number(now)
  if (!Number.isFinite(at)) throw new Error('leaseDoc: now must be a finite epoch ms')
  return { supervisorId: sid, claimedAt: at, beatAt: at, expiresAt: at + Number(ttlMs) }
}

/**
 * A lease is live when it has not expired. Missing/blank lease = dead.
 * `now >= expiresAt` is dead: an expired lease must never authorize work.
 */
export function leaseIsLive(lease, now = Date.now(), ttlMs = LEASE_TTL_MS) {
  const expiresAt = Number(lease?.expiresAt)
  if (!Number.isFinite(expiresAt)) return false
  const at = Number(now)
  if (!Number.isFinite(at)) return false
  // Defensive: a lease with no beat timestamp is not trustworthy.
  if (!Number.isFinite(Number(lease?.beatAt))) return false
  return at < expiresAt
}

/** Inverse helper for recovery scans. */
export function leaseExpired(lease, now = Date.now(), ttlMs = LEASE_TTL_MS) {
  return !leaseIsLive(lease, now, ttlMs)
}

/**
 * Validate a command against a loaded instance BEFORE it is persisted.
 * Returns `{ ok: true, to, noop }` or `{ ok: false, code }`.
 *
 * Codes are stable, English, and safe to surface:
 *   missing_instance | not_owner | missing_command_id | unknown_command
 *   terminal_instance | account_mismatch | invalid_transition
 */
export function validateCommand({ instance, command, commandId, ownerId, accountId } = {}) {
  if (!instance || typeof instance !== 'object') return { ok: false, code: 'missing_instance' }

  const cmd = typeof command === 'string' ? command.trim().toLowerCase() : ''
  if (cmd === '') return { ok: false, code: 'unknown_command' }
  if (!SUPERVISOR_COMMANDS.includes(cmd)) return { ok: false, code: 'unknown_command' }

  // Tenancy is checked against the persisted owner, never a client claim.
  const instanceOwner = instance.ownerId == null ? null : String(instance.ownerId)
  if (ownerId == null || String(ownerId) !== instanceOwner) return { ok: false, code: 'not_owner' }

  // A command needs an idempotency key supplied by the caller (UI/CLI). The
  // store makes `(ownerId, commandId)` unique, so a retry is a no-op.
  if (typeof commandId !== 'string' || commandId.trim() === '') {
    return { ok: false, code: 'missing_command_id' }
  }

  if (accountId != null && instance.accountId != null && String(accountId) !== String(instance.accountId)) {
    return { ok: false, code: 'account_mismatch' }
  }

  const from = String(instance.state ?? '')
  if (isTerminalState(from)) return { ok: false, code: 'terminal_instance' }

  const to = COMMAND_TARGET[cmd]
  const idempotent = IDEMPOTENT_STATES[cmd] || []
  if (from === to || idempotent.includes(from)) {
    return { ok: true, to, noop: true }
  }

  if (!canTransition(from, to)) return { ok: false, code: 'invalid_transition' }

  return { ok: true, to, noop: false }
}

/**
 * Boot recovery: any active instance whose lease is dead was orphaned by a
 * crash/host restart. It must fail explicitly (or complete if it was already
 * stopping) so no consumer keeps showing a phantom RUNNING bot.
 *
 * @returns {{instanceId:string, from:string, to:string, reasonCode:string}[]}
 */
export function recoverOnBoot(instances = [], { now = Date.now(), ttlMs = LEASE_TTL_MS } = {}) {
  const changes = []
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst || typeof inst !== 'object') continue
    const from = String(inst.state ?? '')
    if (!isActiveState(from)) continue
    if (leaseIsLive(inst.lease, now, ttlMs)) continue
    const to = from === 'stopping' ? 'completed' : 'failed'
    changes.push({
      instanceId: String(inst.instanceId ?? inst._id ?? ''),
      from,
      to,
      reasonCode: from === 'stopping' ? 'lease_expired_stopping' : 'lease_expired',
    })
  }
  return changes
}

/**
 * Health policy. Mongo down or a worker error is an ERROR (never "quiet");
 * event lag over the budget is DEGRADED (safe: the worker pauses new entries).
 */
export function evaluateHealth({ lagMs = null, maxLagMs = 60_000, mongoDown = false, lastError = null } = {}) {
  if (mongoDown) return { health: 'error', reasonCode: 'mongo_down' }
  if (lastError) return { health: 'error', reasonCode: 'worker_error' }
  const lag = Number(lagMs)
  if (Number.isFinite(lag) && lag > Number(maxLagMs)) return { health: 'degraded', reasonCode: 'event_lag' }
  return { health: 'ok', reasonCode: null }
}

/**
 * Fields a beat writes onto the instance. Only whitelisted, additive fields —
 * callers cannot smuggle arbitrary keys into the document.
 */
export function heartbeatPatch({
  now = Date.now(),
  health = 'ok',
  healthReason = null,
  lagMs = null,
  engineVersion = null,
  subscriptions = null,
  lastSignalKey = null,
} = {}) {
  if (!HEALTH_STATES.includes(health)) throw new Error(`heartbeatPatch: unknown health "${health}"`)
  const patch = {
    lastEventAt: Number(now),
    health,
    healthReason: healthReason == null ? null : String(healthReason),
    eventLagMs: lagMs == null ? null : Number.isFinite(Number(lagMs)) ? Number(lagMs) : null,
  }
  if (engineVersion != null) patch.engineVersion = String(engineVersion)
  if (Array.isArray(subscriptions)) patch.subscriptions = subscriptions.map((s) => String(s))
  if (lastSignalKey != null) patch.lastSignalKey = String(lastSignalKey)
  return patch
}

/** True when the instance beat within the lease window. */
export function heartbeatIsFresh(instance, now = Date.now(), ttlMs = LEASE_TTL_MS) {
  const at = Number(instance?.lastEventAt)
  if (!Number.isFinite(at)) return false
  return Number(now) - at < Number(ttlMs)
}
