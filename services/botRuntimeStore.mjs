// services/botRuntimeStore.mjs
// =============================================================================
//  DURABLE BOT RUNTIME STORE (roadmap §61.7 / §61.17 Phase E)
//
//  The only place that writes supervisor state: owner lease, instance lease,
//  command inbox and instance transitions. Every mutation is a conditional
//  update on the CURRENT persisted state, so two workers or a retried command
//  can never apply the same transition twice.
//
//  Fail-soft reads (null / empty on Mongo blips) and explicit failure codes on
//  writes — the same discipline as services/signalStore.mjs.
// =============================================================================
import { connectMongo } from '../engine/db.mjs'
import {
  LEASE_TTL_MS,
  recoverOnBoot,
  supervisorId as supervisorKey,
} from '../engine/botSupervisor.mjs'

let memo = null

/** Models — null = Mongo down. Memo per process. */
export async function getBotRuntimeModels() {
  if (memo) return memo
  const mg = await connectMongo()
  if (!mg) return null
  const [inst, cmd, sup] = await Promise.all([
    import('../engine/models/botInstance.mjs'),
    import('../engine/models/botCommand.mjs'),
    import('../engine/models/botSupervisor.mjs'),
  ])
  memo = { BotInstance: inst.BotInstance, BotCommand: cmd.BotCommand, BotSupervisor: sup.BotSupervisor }
  return memo
}

// =============================================================================
//  Instance creation — the one store-level path the CLI and the desk share
// =============================================================================

/**
 * Create a queued bot instance from an enabled LIVE_PAPER profile.
 *
 * Until now only the seed script could create instances — running the desk for
 * real required hand-written documents. This is the store-level operation both
 * `tools/bot-worker.mjs create` and the desk auto-heal call; enqueueing the
 * `start` command stays the caller's job (a create without a start is valid —
 * the operator reviews before arming).
 *
 * Watermark semantics: `watermarkTs` is the bridge cursor (`lastSignalTs`).
 * Default = now → the instance only consumes signals that close AFTER creation;
 * pass an earlier ts to backfill (a demo affordance — a live desk should not
 * trade on stale signals).
 *
 * Account semantics: `accountId` is the paper book this run trades. It is
 * persisted on the instance because the worker rejects a second start with
 * `account_busy` per account — without it every instance looks like the
 * owner's single default book and only ONE bot per owner could ever run.
 *
 * Fail-soft (D33): never throws. Returns { ok, code } on failure.
 */
export async function createInstanceFromProfile({
  ownerId = null,
  profileId = null,
  watermarkTs = null,
  accountId = null,
  initialCapital = 10000,
  createdBy = 'cli',
  now = Date.now(),
} = {}) {
  if (!ownerId) return { ok: false, code: 'missing_owner' }
  const m = await getBotRuntimeModels()
  if (!m) return { ok: false, code: 'mongo_down' }
  try {
    const [{ BotProfile }, { StrategyVersion }, { hashOf }] = await Promise.all([
      import('../engine/models/botProfile.mjs'),
      import('../engine/models/strategyVersion.mjs'),
      import('../engine/version.mjs'),
    ])
    const profile = profileId
      ? await BotProfile.findOne({ profileId, ownerId }).lean()
      : await BotProfile.findOne({ ownerId, status: 'enabled', mode: 'LIVE_PAPER' }).lean()
    if (!profile) return { ok: false, code: 'profile_not_found' }
    const sv = await StrategyVersion.findOne({ _id: profile.strategyVersionId }).lean()
    if (!sv) return { ok: false, code: 'strategy_version_not_found', strategyVersionId: profile.strategyVersionId }

    const TERMINAL = new Set(['completed', 'failed', 'halted'])
    // The instance's paper account drives the worker's `account_busy` guard and
    // its per-account session map, so it MUST be persisted here. Explicit
    // override wins; otherwise the profile's account; a null account means the
    const baseId = `${profile.profileId}-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}`
    // The daily id may already exist. A NON-terminal instance means the desk is
    // already armed (nothing to do); a TERMINAL one (completed/failed/halted —
    // e.g. yesterday's run or a lease-recovery failure) must never be resumed,
    // so the fresh run takes the next free suffix (`-2`, `-3`, ...).
    let target = baseId
    for (let n = 2; n < 100; n++) {
      const existing = await m.BotInstance.findOne({ _id: target }).lean()
      if (!existing) break
      // Multi-tenant guard: _id is GLOBAL, so an id collision with ANOTHER
      // owner's instance must never be "adopted" — take the next suffix. The
      // desk shows only rows owned by the caller; adopting silently would make
      // the launch succeed while the instance stays invisible to its owner.
      if (String(existing.ownerId) === String(ownerId) && !TERMINAL.has(String(existing.state))) {
        return { ok: true, instanceId: String(existing._id), created: false, state: existing.state }
      }
      target = `${baseId}-${n}`
    }

    const resolvedAccountId = accountId || profile.simulatedAccountId || `bot-${target}`

    const inst = await m.BotInstance.create({
      _id: target,
      instanceId: target,
      ownerId,
      botProfileId: profile.profileId,
      strategyVersionId: profile.strategyVersionId,
      strategyFingerprint: hashOf({ strategyId: sv.strategyId, version: sv.version, paramsHash: profile.effectiveParamsHash ?? '' }),
      mode: profile.mode,
      accountId: resolvedAccountId,
      source: { kind: 'live', venue: 'binance', symbol: profile.instruments[0], tf: profile.timeframes[0] },
      instruments: profile.instruments,
      timeframes: profile.timeframes,
      subscriptions: profile.instruments, // Subscribe to all instruments in the profile
      state: 'queued',
      startedAt: now,
      stoppedAt: null,
      lastEventAt: now,
      eventLagMs: 0,
      counts: { signals: 0, orders: 0, trades: 0 },
      initialCapital: Number(initialCapital) || 10000,
      paperEquity: Number(initialCapital) || 10000,
      paperPnl: 0,
      riskState: { dailyLossUsedPct: 0, halted: false, openPositions: 0 },
      execution: profile.execution ?? null,
      health: 'ok',
      lastError: null,
      lastSignalTs: watermarkTs == null ? now : Number(watermarkTs),
      lastSignalKey: null,
      createdBy,
      demo: false,
      schemaVersion: 'botInstance.v1',
    })
    return { ok: true, instanceId: String(inst._id), created: true, state: inst.state }
  } catch (e) {
    return { ok: false, code: 'store_error', message: String(e?.message ?? e).slice(0, 200) }
  }
}

// =============================================================================
//  Owner lease — one logical supervisor per owner
// =============================================================================

/**
 * Claim the owner's supervisor lease. Succeeds when the lease is held by the
 * same holder (re-claim), expired, or absent. A live lease held by someone
 * else is reported, never stolen.
 */
export async function claimSupervisorLease({
  ownerId,
  supervisorId,
  now = Date.now(),
  ttlMs = LEASE_TTL_MS,
  engineVersion = null,
} = {}) {
  if (!ownerId) return { ok: false, code: 'missing_owner' }
  if (!supervisorId) return { ok: false, code: 'missing_supervisor' }
  const m = await getBotRuntimeModels()
  if (!m) return { ok: false, code: 'mongo_down' }

  const _id = supervisorKey(ownerId)
  const at = Number(now)
  const expiresAt = at + Number(ttlMs)
  try {
    const doc = await m.BotSupervisor.findOneAndUpdate(
      {
        _id,
        $or: [{ supervisorId }, { expiresAt: { $lte: at } }, { expiresAt: null }],
      },
      {
        $set: {
          ownerId,
          supervisorId,
          beatAt: at,
          expiresAt,
          ...(engineVersion == null ? {} : { engineVersion: String(engineVersion) }),
        },
        $setOnInsert: { claimedAt: at },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean()
    return { ok: true, lease: doc }
  } catch (e) {
    if (e?.code === 11000) {
      const current = await m.BotSupervisor.findById(_id).lean().catch(() => null)
      return {
        ok: false,
        code: 'lease_held',
        holderId: current?.supervisorId ?? null,
        expiresAt: current?.expiresAt ?? null,
      }
    }
    return { ok: false, code: 'store_error', message: String(e?.message || e) }
  }
}

/** Renew only while still the holder. Losing the lease must stop the worker. */
export async function renewSupervisorLease({
  ownerId,
  supervisorId,
  now = Date.now(),
  ttlMs = LEASE_TTL_MS,
} = {}) {
  const m = await getBotRuntimeModels()
  if (!m) return { ok: false, code: 'mongo_down' }
  const at = Number(now)
  try {
    const res = await m.BotSupervisor.updateOne(
      { _id: supervisorKey(ownerId), supervisorId },
      { $set: { beatAt: at, expiresAt: at + Number(ttlMs) } },
    )
    if (!res?.matchedCount) return { ok: false, code: 'lease_lost' }
    return { ok: true }
  } catch (e) {
    return { ok: false, code: 'store_error', message: String(e?.message || e) }
  }
}

/** Explicit hand-off on clean shutdown (best effort). */
export async function releaseSupervisorLease({ ownerId, supervisorId } = {}) {
  const m = await getBotRuntimeModels()
  if (!m) return false
  try {
    const res = await m.BotSupervisor.deleteOne({ _id: supervisorKey(ownerId), supervisorId })
    return (res?.deletedCount || 0) > 0
  } catch {
    return false
  }
}

// =============================================================================
//  Instances
// =============================================================================

/** Owner-scoped instance list. Demo rows are excluded unless asked for. */
export async function listOwnedInstances(ownerId, { states = null, limit = 100, includeDemo = false } = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId) return []
  const filter = { ownerId }
  if (!includeDemo) filter.demo = { $ne: true }
  if (Array.isArray(states) && states.length) filter.state = { $in: states }
  try {
    return await m.BotInstance.find(filter).sort({ createdAt: -1 }).limit(Math.max(1, Number(limit) || 100)).lean()
  } catch {
    return []
  }
}

export async function findOwnedInstance(ownerId, instanceId) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !instanceId) return null
  try {
    return await m.BotInstance.findOne({ ownerId, instanceId }).lean()
  } catch {
    return null
  }
}

/**
 * Boot recovery for one owner: fail orphaned active instances whose lease is
 * dead (or complete the ones already stopping). Guarded by `state: from`, so a
 * concurrent live worker that just re-claimed the instance wins safely.
 *
 * @returns {{instanceId:string, from:string, to:string, reasonCode:string}[]}
 */
export async function recoverOwnedInstances({ ownerId, now = Date.now(), ttlMs = LEASE_TTL_MS } = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId) return []
  const active = await listOwnedInstances(ownerId, {
    states: ['starting', 'running', 'paused', 'stopping'],
    limit: 500,
    includeDemo: true,
  }).catch(() => [])
  const changes = recoverOnBoot(active, { now, ttlMs })
  const applied = []
  for (const c of changes) {
    try {
      const res = await m.BotInstance.updateOne(
        { ownerId, instanceId: c.instanceId, state: c.from },
        {
          $set: {
            state: c.to,
            health: 'error',
            healthReason: c.reasonCode,
            stoppedAt: Number(now),
            'lease.supervisorId': null,
            'lease.beatAt': null,
            'lease.expiresAt': null,
          },
        },
      )
      if (res?.modifiedCount) applied.push(c)
    } catch {
      // A single failed recovery must not stop the others.
    }
  }
  return applied
}

/**
 * Conditional instance transition. Returns true only when the persisted state
 * still equals `from` — the caller must treat false as "someone else moved it".
 */
export async function transitionInstance({
  ownerId,
  instanceId,
  from,
  to,
  set = {},
  now = Date.now(),
} = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !instanceId) return false
  try {
    const res = await m.BotInstance.updateOne(
      { ownerId, instanceId, state: from },
      { $set: { state: to, lastEventAt: Number(now), ...set } },
    )
    return (res?.modifiedCount || 0) > 0
  } catch {
    return false
  }
}

/** Stamp the instance's lease when a worker starts driving it. */
export async function attachInstanceLease({
  ownerId,
  instanceId,
  supervisorId,
  now = Date.now(),
  ttlMs = LEASE_TTL_MS,
} = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !instanceId) return false
  const at = Number(now)
  try {
    const res = await m.BotInstance.updateOne(
      { ownerId, instanceId },
      {
        $set: {
          'lease.supervisorId': supervisorId,
          'lease.claimedAt': at,
          'lease.beatAt': at,
          'lease.expiresAt': at + Number(ttlMs),
          lastEventAt: at,
        },
      },
    )
    return (res?.matchedCount || 0) > 0
  } catch {
    return false
  }
}

/**
 * Heartbeat: only the current lease holder may beat. Extends the instance
 * lease and writes the whitelisted patch from engine/botSupervisor.mjs.
 */
export async function beatInstance({
  ownerId,
  instanceId,
  supervisorId,
  patch = {},
  now = Date.now(),
  ttlMs = LEASE_TTL_MS,
} = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !instanceId) return false
  const at = Number(now)
  try {
    const res = await m.BotInstance.updateOne(
      { ownerId, instanceId, 'lease.supervisorId': supervisorId },
      {
        $set: {
          ...patch,
          lastEventAt: at,
          'lease.beatAt': at,
          'lease.expiresAt': at + Number(ttlMs),
        },
      },
    )
    return (res?.matchedCount || 0) > 0
  } catch {
    return false
  }
}

// =============================================================================
//  Commands — durable, idempotent inbox
// =============================================================================

/**
 * Enqueue a command. `commandId` is the caller's idempotency key; a retry with
 * the same key returns `{ ok: true, duplicate: true }` instead of a second row.
 */
/**
 * Enqueue a command. `commandId` is the caller's idempotency key: the unique
 * `(ownerId, commandId)` index turns a retry into `{ ok: true, duplicate: true }`.
 *
 * @param {object} [input]
 * @param {string} input.ownerId
 * @param {string} input.instanceId
 * @param {string} input.type
 * @param {string} input.commandId
 * @param {object} [input.payload]
 * @param {string|null} [input.accountId]
 * @param {string|null} [input.botProfileId]
 * @param {number} [input.requestedAt]
 */
export async function enqueueCommand({
  ownerId,
  instanceId,
  type,
  commandId,
  payload = {},
  accountId = null,
  botProfileId = null,
  requestedAt = Date.now(),
} = {}) {
  if (!ownerId) return { ok: false, code: 'missing_owner' }
  if (!instanceId) return { ok: false, code: 'missing_instance' }
  if (!commandId) return { ok: false, code: 'missing_command_id' }
  const m = await getBotRuntimeModels()
  if (!m) return { ok: false, code: 'mongo_down' }
  try {
    const doc = await m.BotCommand.create({
      commandId,
      ownerId,
      instanceId,
      botProfileId,
      accountId,
      type,
      payload,
      status: 'pending',
      requestedAt,
    })
    return { ok: true, duplicate: false, command: doc.toObject() }
  } catch (e) {
    if (e?.code === 11000) return { ok: true, duplicate: true }
    return { ok: false, code: 'store_error', message: String(e?.message || e) }
  }
}

/** Pending commands for an owner, oldest first (stable application order). */
export async function listPendingCommands(ownerId, limit = 100) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId) return []
  try {
    return await m.BotCommand.find({ ownerId, status: 'pending' })
      .sort({ requestedAt: 1, _id: 1 })
      .limit(Math.max(1, Number(limit) || 100))
      .lean()
  } catch {
    return []
  }
}

/** pending -> applied. Guarded, so only one worker can win. */
export async function markCommandApplied({ ownerId, commandId, supervisorId, now = Date.now() } = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !commandId) return false
  try {
    const res = await m.BotCommand.updateOne(
      { ownerId, commandId, status: 'pending' },
      { $set: { status: 'applied', supervisorId, appliedAt: Number(now), reasonCode: null, message: null } },
    )
    return (res?.modifiedCount || 0) > 0
  } catch {
    return false
  }
}

/** pending -> rejected with a stable reason code (English). */
export async function markCommandRejected({
  ownerId,
  commandId,
  supervisorId,
  reasonCode,
  message = null,
  now = Date.now(),
} = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId || !commandId) return false
  try {
    const res = await m.BotCommand.updateOne(
      { ownerId, commandId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          supervisorId,
          appliedAt: Number(now),
          reasonCode: String(reasonCode || 'rejected'),
          message: message == null ? null : String(message),
        },
      },
    )
    return (res?.modifiedCount || 0) > 0
  } catch {
    return false
  }
}

/**
 * Recent command history for the UI/audit (owner-scoped).
 *
 * @param {string} ownerId
 * @param {{instanceId?: string|null, limit?: number}} [opts]
 */
export async function listCommands(ownerId, { instanceId = null, limit = 50 } = {}) {
  const m = await getBotRuntimeModels()
  if (!m || !ownerId) return []
  const filter = { ownerId }
  if (instanceId) filter.instanceId = instanceId
  try {
    return await m.BotCommand.find(filter).sort({ requestedAt: -1, _id: -1 }).limit(Math.max(1, Number(limit) || 50)).lean()
  } catch {
    return []
  }
}
