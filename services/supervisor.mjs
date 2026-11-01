// =============================================================================
//  TM TRADING — SERVICE SUPERVISOR (V4.2 §17.5–§17.7)
//
//  One authoritative owner of service lifecycle. The supervisor:
//
//    request()  validates an action, persists the operation BEFORE returning,
//               resolves idempotency keys and rejects conflicting operations;
//    tick()     advances every queued operation, reconciles processes, expires
//               leases and schedules crash restarts;
//    snapshot() projects state for the Operations API/CLI.
//
//  Design rules that must not be broken:
//
//    - a START is not "done" when spawn returns: it is done when the worker
//      proves readiness (§17.4). Until then the operation stays RUNNING with a
//      phase, so the UI can show real progress;
//    - a STOP drains via an IPC `shutdown` message and only escalates to a kill
//      after the grace period, recording the escalation. `child.kill('SIGTERM')`
//      is NOT a graceful stop on win32;
//    - desired state is operator intent and is never inferred from a heartbeat;
//    - an unexpected exit schedules a bounded-backoff restart and is audited;
//    - the supervisor never spawns a service that another process still hosts
//      (`supervised: false`), because that would duplicate processing.
//
//  The engine is deterministic for a given clock: `now` is injected, the worker
//  adapter is injected, and no timer lives inside this module. The CLI owns the
//  loop; tests call `tick()` directly.
// =============================================================================

import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { consumeCommand, listCommands, listQuarantine, quarantineCommand, quarantineFile, resolveCommandsDir } from './commandInbox.mjs'
import { SERVICES, loadRegistry } from './registry.mjs'
import {
  deriveObservedState,
  deriveServiceHealth,
  evaluateReadiness,
  isDrifted,
  readinessOptions,
} from './readiness.mjs'
import { evaluateTelemetry } from './telemetry.mjs'
import { pickEvidence } from './workerProbes.mjs'
import {
  SUPERVISOR_STATE_FILE,
  createSupervisorStore,
  serviceKey,
} from './supervisorStore.mjs'

/** Version stamp (D1). */
export const SUPERVISOR_SCHEMA_VERSION = 'supervisor.v1'

/** Every control action the supervisor understands. */
export const SERVICE_ACTIONS = Object.freeze(['start', 'stop', 'restart', 'reset', 'probe', 'run-once'])

/** Operation states that are still moving. */
export const ACTIVE_OPERATION_STATES = Object.freeze(['QUEUED', 'RUNNING'])

export const DEFAULT_LEASE_TTL_MS = 30_000
export const DEFAULT_STOP_GRACE_MS = 15_000
export const DEFAULT_READINESS_TIMEOUT_MS = 120_000
export const DEFAULT_OPERATION_TIMEOUT_MS = 300_000
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90_000
export const MAX_RESTART_BACKOFF_MS = 60_000

/** True when an operation is still moving. */
export function isActiveOperation(operation) {
  return Boolean(operation) && ACTIVE_OPERATION_STATES.includes(operation.state)
}

/** Bounded exponential backoff: 2 s, 4 s, 8 s … capped. */
export function restartBackoffMs(restartCount) {
  const count = Math.max(1, Math.min(Number(restartCount) || 1, 6))
  return Math.min(MAX_RESTART_BACKOFF_MS, 1_000 * 2 ** count)
}

/**
 * Create the supervisor.
 *
 * @param {{
 *   store: ReturnType<typeof createSupervisorStore>,
 *   registry?: ReadonlyArray<import('../shared/types/service').ManagedServiceDefinition>,
 *   workers: {
 *     spawn: (input: object) => object,
 *     isAlive?: (pid: number) => boolean,
 *     adopt?: (pid: number) => object | null,
 *     kill?: (pid: number, signal?: string) => void,
 *   },
 *   now?: () => number,
 *   host?: string,
 *   leaseTtlMs?: number,
 *   stopGraceMs?: number,
 *   readinessTimeoutMs?: number,
 *   operationTimeoutMs?: number,
 *   heartbeatTimeoutMs?: number,
 *   readinessProvider?: (input: object) => object,
 * }} options
 */
export function createSupervisor(options = {}) {
  const {
    store,
    registry = SERVICES,
    workers,
    now = () => Date.now(),
    host = hostname(),
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    stopGraceMs = DEFAULT_STOP_GRACE_MS,
    readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    readinessProvider = defaultReadinessProvider,
    commandsDir = resolveCommandsDir(),
  } = options

  if (!store) throw new Error('createSupervisor: store is required')
  if (!workers?.spawn) throw new Error('createSupervisor: workers.spawn is required')

  const definitions = new Map(registry.map(definition => [definition.id, definition]))
  const supervisorId = options.supervisorId ?? `${host}:${process.pid}`
  /** key -> { handle, serviceId, scopeKey, instanceId } */
  const processes = new Map()
  /** operationId -> handle (one-shot run-once workers) */
  const onceHandles = new Map()
  /**
   * True while `drain()` is running.
   *
   * `drain()` is asynchronous (it waits for workers to exit), but the CLI loop
   * keeps calling `tick()` whenever the previous one returns. A tick landing
   * between the shutdown message and the exit event would re-derive readiness
   * from stale evidence and overwrite the drained record with READY — which then
   * made `onWorkerExit` judge the supervisor's own shutdown as a crash. A single
   * flag in the one place that mutates state is enough to close the window.
   */
  let draining = false

  const definitionOf = id => definitions.get(id)
  const keyOf = (serviceId, scopeKey) => serviceKey(serviceId, scopeKey)

  // ---------------------------------------------------------------------------
  //  Liveness and process bookkeeping.
  // ---------------------------------------------------------------------------

  function isAlive(record) {
    const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
    if (entry?.handle) {
      if (typeof entry.handle.alive === 'boolean') return entry.handle.alive
      if (typeof entry.handle.isAlive === 'function') return entry.handle.isAlive()
    }
    if (record.pid && typeof workers.isAlive === 'function') return workers.isAlive(record.pid)
    return false
  }

  function attachProcess(record, handle) {
    const entry = {
      handle,
      serviceId: record.serviceId,
      scopeKey: record.scopeKey,
      instanceId: handle?.instanceId ?? record.serviceInstanceId,
    }
    processes.set(keyOf(record.serviceId, record.scopeKey), entry)
    if (typeof handle?.onMessage === 'function') handle.onMessage(message => onWorkerMessage(entry, message))
    if (typeof handle?.onExit === 'function') handle.onExit(info => onWorkerExit(entry, info))
    return entry
  }

  function signalProcess(record, signal = 'SIGTERM') {
    const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
    if (typeof entry?.handle?.kill === 'function') {
      entry.handle.kill(signal)
      return true
    }
    if (record.pid && typeof workers.kill === 'function') {
      workers.kill(record.pid, signal)
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  //  Readiness projection.
  // ---------------------------------------------------------------------------

  /**
   * Recompute observed state from evidence the worker reported plus OS
   * liveness. Never writes; the caller persists.
   */
  function projectRecord(record, definition, at) {
    const alive = isAlive(record)
    const heartbeatAgeMs = record.lastHeartbeatAt === null ? null : at - record.lastHeartbeatAt
    const heartbeatLost = alive && heartbeatAgeMs !== null && heartbeatAgeMs > heartbeatTimeoutMs

    if (heartbeatLost && !record.heartbeatLost) {
      record.heartbeatLost = true
      store.appendAudit({
        actor: 'supervisor',
        action: 'heartbeat-lost',
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        operationId: record.operationId,
        detail: `no worker message for ${Math.round(heartbeatAgeMs / 1000)}s`,
      })
    } else if (!heartbeatLost && record.heartbeatLost) {
      record.heartbeatLost = false
    }

    let processAlive = null
    if (alive) processAlive = heartbeatLost ? false : true
    else if (record.pid) processAlive = false
    // The supervisor owns a supervised service: "nothing spawned" is proof the
    // process is not running, not an absence of evidence. Reporting UNKNOWN
    // here would hide a failed start behind a neutral badge.
    else if (definition.supervised !== false) processAlive = false

    const evidence = { ...record.evidence, processAlive }
    const report = evaluateReadiness(definition, evidence, { now: at, ...readinessOptions(definition) })
    const observed = deriveObservedState({
      desired: record.desired,
      processAlive,
      readiness: report,
      startedAt: record.startedAt,
      startupGraceMs: definition.startupGraceMs,
      now: at,
      stopping: record.stopping,
    })

    record.readiness = report.checks
    record.observed = observed
    record.health = deriveServiceHealth(observed)
    // Saturation is a health signal, not a lifecycle state: a READY service
    // whose event loop is saturated is still READY but must not look healthy.
    if (record.health === 'HEALTHY' && evaluateTelemetry(record.telemetry) === 'saturated') {
      record.health = 'DEGRADED'
    }
    return { observed, report, processAlive, heartbeatAgeMs }
  }

  /** Readiness evidence for a probe: OS liveness plus the last worker report. */
  function defaultReadinessProvider({ definition, record, now: at, alive }) {
    const processAlive = alive
      ? true
      : (record.pid || definition.supervised !== false ? false : null)
    const evidence = {
      ...record.evidence,
      processAlive,
    }
    const report = evaluateReadiness(definition, evidence, { now: at, ...readinessOptions(definition) })
    const observed = deriveObservedState({
      desired: record.desired,
      processAlive: evidence.processAlive,
      readiness: report,
      startedAt: record.startedAt,
      startupGraceMs: definition.startupGraceMs,
      now: at,
      stopping: record.stopping,
    })
    return {
      evidence,
      readiness: report,
      observed,
      health: deriveServiceHealth(observed),
      heartbeatAgeMs: record.lastHeartbeatAt === null ? null : at - record.lastHeartbeatAt,
      telemetry: record.telemetry,
    }
  }

  // ---------------------------------------------------------------------------
  //  Operation helpers.
  // ---------------------------------------------------------------------------

  function audit(action, op, detail, at = now()) {
    store.appendAudit({
      at,
      actor: op?.requestedBy ?? 'supervisor',
      action,
      serviceId: op?.serviceId ?? null,
      scopeKey: op?.scopeKey ?? null,
      operationId: op?.operationId ?? null,
      detail: detail ?? null,
    })
  }

  function complete(op, record, { result = {}, at = now() } = {}) {
    op.state = 'SUCCEEDED'
    op.phase = 'done'
    op.finishedAt = at
    op.result = { ...(op.result ?? {}), ...result }
    if (record.operationId === op.operationId) record.operationId = null
    store.putOperation(op)
    store.putService(record)
    audit('operation-succeeded', op, op.phase, at)
    return op
  }

  function fail(op, record, code, detail, { markFailed = false, at = now() } = {}) {
    op.state = 'FAILED'
    op.phase = 'failed'
    op.finishedAt = at
    op.error = `${code}: ${detail}`
    op.result = { ...(op.result ?? {}), code }
    if (record.operationId === op.operationId) record.operationId = null
    record.lastError = String(detail).slice(0, 300)
    record.lastErrorAt = at
    if (markFailed && !isAlive(record)) {
      record.observed = 'FAILED'
      record.health = 'UNHEALTHY'
    }
    store.putOperation(op)
    store.putService(record)
    audit('operation-failed', op, `${code}: ${detail}`, at)
    return op
  }

  /** Complete a start/restart/reset operation once readiness is proven. */
  function settleOperation(record, at) {
    if (!record.operationId) return
    const op = store.getOperation(record.operationId)
    if (!isActiveOperation(op)) return
    // A QUEUED operation has not been advanced yet, so the service being READY
    // proves nothing about it. Completing here would turn a `restart` into a
    // no-op (the current instance is READY, so it would never cycle) and would
    // hide the `alreadyRunning` / `alreadyStopped` outcomes that `advance()`
    // reports. `advance()` is the single place that decides a queued action.
    if (op.phase === 'queued') return
    if (op.action === 'restart' || op.action === 'reset') {
      // The stop phase still owns the operation.
      if (op.phase === 'stopping' || op.phase === 'draining') return
    }
    if (op.action === 'start' || op.action === 'restart' || op.action === 'reset') {
      if (record.observed === 'READY' || record.observed === 'DEGRADED') {
        complete(op, record, {
          at,
          result: {
            serviceInstanceId: record.serviceInstanceId,
            generation: record.generation,
            observed: record.observed,
            reset: op.action === 'reset',
            forced: op.result?.forced ?? false,
          },
        })
      }
      return
    }
    if (op.action === 'stop' && record.observed === 'STOPPED') {
      complete(op, record, { at, result: { forced: op.result?.forced ?? false } })
    }
  }

  function expireOperations(at) {
    for (const op of store.listOperations({ activeOnly: true })) {
      if (!Number.isFinite(op.deadlineAt) || at <= op.deadlineAt) continue
      const record = store.ensureService(op.serviceId, op.scopeKey)
      op.state = 'UNCONFIRMED'
      op.phase = 'timed-out'
      op.finishedAt = at
      op.error = 'operation timed out before a terminal state was proven'
      op.result = { ...(op.result ?? {}), code: 'OPERATION_TIMEOUT' }
      if (record.operationId === op.operationId) record.operationId = null
      store.putOperation(op)
      store.putService(record)
      audit('operation-unconfirmed', op, op.error, at)
    }
  }

  // ---------------------------------------------------------------------------
  //  Spawning.
  // ---------------------------------------------------------------------------

  function spawnService(op, record, definition, at, { reset = false, previousInstanceId = null } = {}) {
    const instanceId = `si_${randomUUID()}`
    const generation = (Number(record.generation) || 0) + 1
    const lease = store.claimLease({
      serviceId: record.serviceId,
      scopeKey: record.scopeKey,
      owner: supervisorId,
      serviceInstanceId: instanceId,
      ttlMs: leaseTtlMs,
      now: at,
    })
    if (!lease.ok) {
      return fail(op, record, 'LEASE_HELD', `lease held by ${lease.lease.owner} until ${lease.lease.expiresAt}`, { at })
    }

    let handle
    try {
      handle = workers.spawn({
        definition,
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        serviceInstanceId: instanceId,
        generation,
        mode: 'run',
        reset,
      })
    } catch (error) {
      store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
      return fail(op, record, 'SPAWN_FAILED', String(error?.message || error), { markFailed: true, at })
    }

    record.desired = 'RUNNING'
    record.serviceInstanceId = instanceId
    record.generation = generation
    record.pid = handle?.pid ?? null
    record.host = host
    record.startedAt = at
    record.lastHeartbeatAt = at
    record.stopping = false
    record.heartbeatLost = false
    record.nextRestartAt = null
    record.operationId = op.operationId
    record.evidence = {}
    record.observed = 'STARTING'
    record.health = 'UNKNOWN'

    op.state = 'RUNNING'
    op.phase = 'starting'
    op.startedAt = at
    op.result = {
      ...(op.result ?? {}),
      serviceInstanceId: instanceId,
      generation,
      reset,
      previousInstanceId,
    }

    if (handle) attachProcess(record, handle)
    store.putOperation(op)
    store.putService(record)
    audit('worker-spawned', op, `pid=${record.pid} generation=${generation} reset=${reset}`, at)
    return op
  }

  function spawnCrashRestart(record, definition, at) {
    const instanceId = `si_${randomUUID()}`
    const generation = (Number(record.generation) || 0) + 1
    const lease = store.claimLease({
      serviceId: record.serviceId,
      scopeKey: record.scopeKey,
      owner: supervisorId,
      serviceInstanceId: instanceId,
      ttlMs: leaseTtlMs,
      now: at,
    })
    if (!lease.ok) {
      record.nextRestartAt = at + restartBackoffMs(record.restartCount + 1)
      store.putService(record)
      return false
    }

    let handle
    try {
      handle = workers.spawn({
        definition,
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        serviceInstanceId: instanceId,
        generation,
        mode: 'run',
        reset: false,
        reason: 'crash-restart',
      })
    } catch (error) {
      store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
      record.nextRestartAt = at + restartBackoffMs(record.restartCount + 1)
      record.lastError = `crash restart failed: ${String(error?.message || error)}`.slice(0, 300)
      record.lastErrorAt = at
      store.putService(record)
      return false
    }

    record.serviceInstanceId = instanceId
    record.generation = generation
    record.pid = handle?.pid ?? null
    record.startedAt = at
    record.lastHeartbeatAt = at
    record.stopping = false
    record.heartbeatLost = false
    record.nextRestartAt = null
    record.observed = 'STARTING'
    record.health = 'UNKNOWN'
    record.evidence = {}
    if (handle) attachProcess(record, handle)
    store.putService(record)
    store.appendAudit({
      at,
      actor: 'supervisor',
      action: 'crash-restart',
      serviceId: record.serviceId,
      scopeKey: record.scopeKey,
      operationId: null,
      detail: `pid=${record.pid} generation=${generation}`,
    })
    return true
  }

  // ---------------------------------------------------------------------------
  //  Worker events.
  // ---------------------------------------------------------------------------

  function onWorkerMessage(entry, message) {
    if (!message || typeof message !== 'object') return
    const record = store.ensureService(entry.serviceId, entry.scopeKey)
    // A late message from an old generation must not overwrite the new one.
    if (message.instanceId && record.serviceInstanceId && message.instanceId !== record.serviceInstanceId) return
    if (entry.instanceId && record.serviceInstanceId && entry.instanceId !== record.serviceInstanceId) return

    const definition = definitionOf(record.serviceId)
    if (!definition) return
    const at = now()

    switch (message.type) {
      case 'hello': {
        if (record.pid === null && Number.isFinite(message.pid)) record.pid = message.pid
        if (record.startedAt === null && Number.isFinite(message.startedAt)) record.startedAt = message.startedAt
        record.lastHeartbeatAt = at
        break
      }
      case 'heartbeat': {
        record.lastHeartbeatAt = Number.isFinite(message.at) ? message.at : at
        if (message.telemetry) record.telemetry = message.telemetry
        record.evidence = { ...record.evidence, ...pickEvidence(message.evidence) }
        break
      }
      case 'cycle': {
        record.lastHeartbeatAt = at
        record.lastDurationMs = Number.isFinite(message.durationMs) ? message.durationMs : record.lastDurationMs
        if (message.skipped) {
          // A deliberate skip is a completed cycle that produced nothing. It
          // proves the loop is alive, not that the service works, so
          // `lastSuccessAt` stays untouched and `output-produced` gets no
          // evidence instead of a misleading zero. Any other evidence the
          // service observed on that pass is still real.
          record.lastError = null
          record.evidence = {
            ...record.evidence,
            ...pickEvidence(message.evidence),
            lastOutputCount: null,
          }
          record.lastOutputCount = null
          break
        }
        if (message.ok) {
          record.lastSuccessAt = Number.isFinite(message.at) ? message.at : at
          record.lastError = null
          record.evidence = {
            ...record.evidence,
            ...pickEvidence(message.evidence),
            lastSuccessAt: record.lastSuccessAt,
            lastOutputCount: Number.isFinite(message.outputCount) ? message.outputCount : null,
          }
          record.lastOutputCount = Number.isFinite(message.outputCount) ? message.outputCount : null
        } else {
          record.lastErrorAt = at
          record.lastError = String(message.error ?? 'cycle failed').slice(0, 300)
        }
        break
      }
      case 'ready': {
        record.lastHeartbeatAt = at
        record.evidence = { ...record.evidence, ...pickEvidence(message.evidence) }
        break
      }
      case 'stopped': {
        record.stopping = false
        record.pid = null
        record.observed = 'STOPPED'
        record.health = 'UNKNOWN'
        record.serviceInstanceId = null
        store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
        // The worker has finished. Falling through to `projectRecord()` here
        // would ask about a handle that is still open (the process has not been
        // reaped yet), read it as alive, and resurrect a stale READY over the
        // stop we just recorded. The last readiness checks stay as evidence of
        // what was true before the drain; the lifecycle state is STOPPED.
        store.putService(record)
        settleOperation(record, at)
        return
      }
      case 'operation-result': {
        const op = store.getOperation(message.operationId)
        if (op && isActiveOperation(op)) {
          if (message.evidence) {
            record.evidence = { ...record.evidence, ...pickEvidence(message.evidence) }
          }
          if (message.ok) complete(op, record, { at, result: { workerResult: message.result ?? null } })
          else fail(op, record, 'RUN_ONCE_FAILED', String(message.error ?? 'run-once failed'), { at })
        }
        return
      }
      case 'fatal': {
        record.lastError = String(message.error ?? 'worker fatal error').slice(0, 300)
        record.lastErrorAt = at
        record.observed = 'FAILED'
        record.health = 'UNHEALTHY'
        break
      }
      default:
        return
    }

    projectRecord(record, definition, at)
    store.putService(record)
    settleOperation(record, at)
  }

  function onWorkerExit(entry, info = {}) {
    const key = keyOf(entry.serviceId, entry.scopeKey)
    const current = processes.get(key)
    if (current && current.instanceId === entry.instanceId) processes.delete(key)

    const record = store.ensureService(entry.serviceId, entry.scopeKey)
    if (entry.instanceId && record.serviceInstanceId && entry.instanceId !== record.serviceInstanceId) return

    const definition = definitionOf(record.serviceId)
    if (!definition) return
    const at = now()

    // A deliberate drain records its own outcome: `drain()` persists STOPPED
    // because the exit event may arrive after the supervisor has already
    // finished cleaning up (and on win32 the handler can be queued as a
    // microtask that runs afterwards). Re-judging an already-stopped record
    // would report a clean shutdown as a crash, inflate `restartCount` on every
    // supervisor restart and schedule a restart the operator never asked for.
    // A late exit from a previous generation lands here too.
    if (record.observed === 'STOPPED' && record.pid === null) {
      if (record.stopping) {
        record.stopping = false
        store.putService(record)
      }
      return
    }

    record.pid = null

    const active = record.operationId ? store.getOperation(record.operationId) : null
    const restartHalf = Boolean(active)
      && isActiveOperation(active)
      && (active.action === 'restart' || active.action === 'reset')
      && (active.phase === 'stopping' || active.phase === 'draining')

    if (restartHalf) {
      // The stop half of a restart finished; the next tick spawns the new
      // generation. Keep the operation RUNNING and do not treat this exit as a
      // crash — it was requested.
      record.stopping = false
      record.pid = null
      store.putService(record)
      return
    }

    if (record.stopping || record.desired === 'STOPPED') {
      record.stopping = false
      record.observed = 'STOPPED'
      record.health = 'UNKNOWN'
      record.serviceInstanceId = null
      store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
      store.putService(record)
      if (active && isActiveOperation(active) && active.action === 'stop') {
        complete(active, record, { at, result: { forced: active.result?.forced ?? false } })
      }
      return
    }

    record.lastError = `worker exited (code=${info.code ?? 'null'}, signal=${info.signal ?? 'null'})`
    record.lastErrorAt = at
    record.restartCount = (Number(record.restartCount) || 0) + 1
    record.nextRestartAt = at + restartBackoffMs(record.restartCount)
    record.observed = 'FAILED'
    record.health = 'UNHEALTHY'
    record.serviceInstanceId = null
    store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
    store.putService(record)
    audit('worker-exited', active ?? { serviceId: record.serviceId, scopeKey: record.scopeKey, operationId: null, requestedBy: 'supervisor' }, record.lastError, at)

    if (active && isActiveOperation(active) && active.action !== 'stop') {
      fail(active, record, 'WORKER_EXITED', record.lastError, { at })
    }
  }

  // ---------------------------------------------------------------------------
  //  Operation advancement.
  // ---------------------------------------------------------------------------

  function evaluateDependencies(definition) {
    const blocked = []
    const waiting = []
    for (const dependency of definition.dependencies ?? []) {
      if (dependency.policy === 'OPTIONAL') continue
      // A dependency hosted by another process (`supervised: false`, e.g. the
      // market plane inside Nitro) can never be lifecycle-gated here: the
      // supervisor must not start it, so its observed state would stay UNKNOWN
      // forever and permanently block everything downstream. Those services
      // report their own `dependency-reachable` readiness evidence instead.
      if (definitionOf(dependency.serviceId)?.supervised === false) continue
      // Dependencies are system services; owner scope never changes that.
      const depRecord = store.getService(dependency.serviceId, 'system')
      const observed = depRecord?.observed ?? 'UNKNOWN'
      const desired = depRecord?.desired ?? 'STOPPED'
      if (observed === 'READY') continue
      if (observed === 'DEGRADED') {
        // DEGRADED is a settled state, not a transition: it may never become
        // READY, so REQUIRE_READY blocks now instead of parking forever.
        if (dependency.policy === 'DEGRADED_ALLOWED') continue
        blocked.push(`${dependency.serviceId}:${observed}`)
        continue
      }
      // A dependency the supervisor intends to run is not a hard block: it may be
      // mid-start, mid-restart, or recovering from a crash (observed FAILED with
      // desired RUNNING). Park the operation and re-check it next tick; the
      // operation TTL bounds the wait, so a dependency that never recovers ends
      // as OPERATION_TIMEOUT instead of a misleading "not ready, give up".
      if (desired === 'RUNNING') {
        waiting.push(dependency.serviceId)
        continue
      }
      blocked.push(`${dependency.serviceId}:${observed}`)
    }
    return { blocked, waiting }
  }

  function advanceStart(op, record, definition, at) {
    if (op.state === 'QUEUED') {
      if (isAlive(record) && (record.observed === 'READY' || record.observed === 'DEGRADED')) {
        return complete(op, record, {
          at,
          result: { alreadyRunning: true, serviceInstanceId: record.serviceInstanceId, generation: record.generation },
        })
      }
      const deps = evaluateDependencies(definition)
      if (deps.blocked.length > 0) {
        return fail(op, record, 'DEPENDENCY_NOT_READY', deps.blocked.join(', '), { at })
      }
      if (deps.waiting.length > 0) {
        op.state = 'RUNNING'
        op.phase = 'awaiting-dependency'
        op.result = { ...(op.result ?? {}), waitingFor: deps.waiting }
        store.putOperation(op)
        return op
      }
      return spawnService(op, record, definition, at)
    }

    // A start that was parked on a dependency must re-check it: the dependency
    // may have become ready (spawn now) or failed (report the block) since the
    // last tick. Without this, the parked operation would fall through to the
    // "worker exited" branch and be failed even though nothing was spawned.
    if (op.phase === 'awaiting-dependency') {
      const deps = evaluateDependencies(definition)
      if (deps.blocked.length > 0) {
        return fail(op, record, 'DEPENDENCY_NOT_READY', deps.blocked.join(', '), { at })
      }
      if (deps.waiting.length > 0) {
        op.result = { ...(op.result ?? {}), waitingFor: deps.waiting }
        store.putOperation(op)
        return op
      }
      return spawnService(op, record, definition, at)
    }

    if (record.observed === 'READY' || record.observed === 'DEGRADED') {
      return complete(op, record, {
        at,
        result: { serviceInstanceId: record.serviceInstanceId, generation: record.generation, observed: record.observed },
      })
    }
    if (!isAlive(record)) {
      return fail(op, record, 'WORKER_EXITED', 'worker exited before readiness', { markFailed: true, at })
    }
    const startedAt = op.startedAt ?? record.startedAt ?? at
    if (at - startedAt > readinessTimeoutMs) {
      signalProcess(record, 'SIGKILL')
      record.stopping = false
      return fail(op, record, 'READINESS_TIMEOUT', 'service did not prove readiness in time', { markFailed: true, at })
    }
    op.phase = 'awaiting-readiness'
    store.putOperation(op)
    return op
  }

  function advanceStop(op, record, definition, at) {
    if (op.state === 'QUEUED') {
      record.desired = 'STOPPED'
      if (!isAlive(record)) {
        record.observed = 'STOPPED'
        record.health = 'UNKNOWN'
        record.pid = null
        record.stopping = false
        record.serviceInstanceId = null
        store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
        return complete(op, record, { at, result: { alreadyStopped: true } })
      }
      record.stopping = true
      const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
      if (typeof entry?.handle?.send === 'function') {
        entry.handle.send({ type: 'shutdown', reason: op.operationId, graceMs: stopGraceMs })
      } else {
        signalProcess(record, 'SIGTERM')
      }
      // The worker may exit synchronously on some platforms; if it already did,
      // the exit handler completed this operation and we must not reopen it.
      if (!isActiveOperation(op)) return op
      op.state = 'RUNNING'
      op.phase = 'draining'
      op.startedAt = at
      op.result = { ...(op.result ?? {}), stopRequestedAt: at }
      store.putOperation(op)
      store.putService(record)
      audit('stop-requested', op, 'shutdown sent', at)
      return op
    }

    if (!isAlive(record)) {
      record.stopping = false
      record.observed = 'STOPPED'
      record.health = 'UNKNOWN'
      record.pid = null
      record.serviceInstanceId = null
      store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
      return complete(op, record, { at, result: { forced: op.result?.forced ?? false } })
    }

    const stopAt = op.result?.stopRequestedAt ?? op.startedAt ?? at
    if (at - stopAt > stopGraceMs) {
      signalProcess(record, 'SIGKILL')
      record.stopping = false
      record.observed = 'STOPPED'
      record.health = 'UNKNOWN'
      record.pid = null
      record.serviceInstanceId = null
      record.lastError = 'stop grace expired; forced termination'
      record.lastErrorAt = at
      store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
      const completed = complete(op, record, { at, result: { forced: true } })
      audit('stop-escalated', op, 'grace expired, killed', at)
      return completed
    }

    op.phase = 'draining'
    store.putOperation(op)
    return op
  }

  function advanceRestart(op, record, definition, at, { reset }) {
    if (op.state === 'QUEUED') {
      record.desired = 'RUNNING'
      if (!isAlive(record)) {
        return spawnService(op, record, definition, at, { reset, previousInstanceId: record.serviceInstanceId })
      }
      record.stopping = true
      const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
      if (typeof entry?.handle?.send === 'function') {
        entry.handle.send({ type: 'shutdown', reason: op.operationId, graceMs: stopGraceMs })
      } else {
        signalProcess(record, 'SIGTERM')
      }
      // A synchronous exit already moved the restart past its stop phase.
      if (!isActiveOperation(op)) return op
      op.state = 'RUNNING'
      op.phase = 'stopping'
      op.startedAt = at
      op.result = { ...(op.result ?? {}), stopRequestedAt: at, previousInstanceId: record.serviceInstanceId }
      store.putOperation(op)
      store.putService(record)
      audit(reset ? 'reset-requested' : 'restart-requested', op, 'shutdown sent', at)
      return op
    }

    if (op.phase === 'stopping' || op.phase === 'draining') {
      if (!isAlive(record)) {
        record.stopping = false
        store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
        return spawnService(op, record, definition, at, {
          reset,
          previousInstanceId: op.result?.previousInstanceId ?? null,
        })
      }
      const stopAt = op.result?.stopRequestedAt ?? op.startedAt ?? at
      if (at - stopAt > stopGraceMs) {
        signalProcess(record, 'SIGKILL')
        record.stopping = false
        op.result = { ...(op.result ?? {}), forced: true }
        store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
        audit('stop-escalated', op, 'grace expired, killed', at)
        return spawnService(op, record, definition, at, {
          reset,
          previousInstanceId: op.result?.previousInstanceId ?? null,
        })
      }
      return op
    }

    if (record.observed === 'READY' || record.observed === 'DEGRADED') {
      return complete(op, record, {
        at,
        result: {
          serviceInstanceId: record.serviceInstanceId,
          generation: record.generation,
          observed: record.observed,
          reset,
          forced: op.result?.forced ?? false,
        },
      })
    }
    if (!isAlive(record)) {
      return fail(op, record, 'WORKER_EXITED', 'worker exited before readiness', { markFailed: true, at })
    }
    if (at - (op.startedAt ?? at) > readinessTimeoutMs) {
      signalProcess(record, 'SIGKILL')
      return fail(op, record, 'READINESS_TIMEOUT', 'service did not prove readiness in time', { markFailed: true, at })
    }
    op.phase = 'awaiting-readiness'
    store.putOperation(op)
    return op
  }

  function advanceProbe(op, record, definition, at) {
    const alive = isAlive(record)
    const result = readinessProvider({ definition, record, now: at, alive })
    record.readiness = result.readiness?.checks ?? []
    record.observed = result.observed ?? record.observed
    record.health = result.health ?? record.health
    op.result = {
      ...(op.result ?? {}),
      observed: result.observed,
      health: result.health,
      readiness: result.readiness,
      heartbeatAgeMs: result.heartbeatAgeMs ?? null,
      telemetry: result.telemetry ?? null,
    }
    return complete(op, record, { at, result: { probe: op.result } })
  }

  function advanceRunOnce(op, record, definition, at) {
    if (op.state !== 'QUEUED') return op

    const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
    if (entry?.handle?.alive && typeof entry.handle.send === 'function') {
      entry.handle.send({ type: 'run-once', operationId: op.operationId })
      op.state = 'RUNNING'
      op.phase = 'running-once'
      op.startedAt = at
      store.putOperation(op)
      audit('run-once-dispatched', op, 'sent to the running worker', at)
      return op
    }

    const instanceId = `si_${randomUUID()}`
    let handle
    try {
      handle = workers.spawn({
        definition,
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        serviceInstanceId: instanceId,
        generation: record.generation,
        mode: 'once',
        reset: false,
        operationId: op.operationId,
      })
    } catch (error) {
      return fail(op, record, 'RUN_ONCE_UNSUPPORTED', String(error?.message || error), { at })
    }

    onceHandles.set(op.operationId, handle)
    const finish = info => {
      onceHandles.delete(op.operationId)
      const current = store.getOperation(op.operationId)
      if (!current || !isActiveOperation(current)) return
      const fresh = store.ensureService(current.serviceId, current.scopeKey)
      if (info?.code === 0) complete(current, fresh, { result: { exitCode: 0 } })
      else fail(current, fresh, 'RUN_ONCE_FAILED', `one-shot worker exited with code ${info?.code ?? 'null'}`)
    }
    if (typeof handle?.onMessage === 'function') {
      handle.onMessage(message => {
        if (message?.type === 'operation-result' && message.operationId === op.operationId) {
          const current = store.getOperation(op.operationId)
          if (current && isActiveOperation(current)) {
            const fresh = store.ensureService(current.serviceId, current.scopeKey)
            if (message.evidence) {
              fresh.evidence = { ...fresh.evidence, ...pickEvidence(message.evidence) }
            }
            if (message.ok) complete(current, fresh, { result: { workerResult: message.result ?? null } })
            else fail(current, fresh, 'RUN_ONCE_FAILED', String(message.error ?? 'run-once failed'))
          }
        }
      })
    }
    if (typeof handle?.onExit === 'function') handle.onExit(finish)

    op.state = 'RUNNING'
    op.phase = 'running-once'
    op.startedAt = at
    store.putOperation(op)
    audit('run-once-spawned', op, `one-shot pid=${handle?.pid ?? 'null'}`, at)
    return op
  }

  function advance(op, at) {
    const definition = definitionOf(op.serviceId)
    if (!definition) {
      const record = store.ensureService(op.serviceId, op.scopeKey)
      return fail(op, record, 'UNKNOWN_SERVICE', `no definition for ${op.serviceId}`, { at })
    }
    const record = store.ensureService(op.serviceId, op.scopeKey)
    switch (op.action) {
      case 'start': return advanceStart(op, record, definition, at)
      case 'stop': return advanceStop(op, record, definition, at)
      case 'restart': return advanceRestart(op, record, definition, at, { reset: false })
      case 'reset': return advanceRestart(op, record, definition, at, { reset: true })
      case 'probe': return advanceProbe(op, record, definition, at)
      case 'run-once': return advanceRunOnce(op, record, definition, at)
      default:
        return fail(op, record, 'ACTION_NOT_SUPPORTED', `unknown action ${op.action}`, { at })
    }
  }

  // ---------------------------------------------------------------------------
  //  Reconciliation.
  // ---------------------------------------------------------------------------

  function recoverServices(at) {
    for (const record of store.listServices()) {
      const definition = definitionOf(record.serviceId)
      if (!definition) continue

      // `stopping` is transient state, not operator intent. If the supervisor
      // died mid-drain, a stale flag would pin the service in STOPPING forever;
      // only an active stop/restart/reset operation may keep it.
      if (record.stopping) {
        const owner = record.operationId ? store.getOperation(record.operationId) : null
        const owned = Boolean(owner)
          && isActiveOperation(owner)
          && (owner.action === 'stop' || owner.action === 'restart' || owner.action === 'reset')
        if (!owned) {
          record.stopping = false
          store.putService(record)
        }
      }

      // A process that vanished while nobody was watching is an unexpected
      // exit, not a silent "unknown".
      if (record.pid && !record.stopping && !isAlive(record)) {
        onWorkerExit({
          handle: null,
          serviceId: record.serviceId,
          scopeKey: record.scopeKey,
          instanceId: record.serviceInstanceId,
        }, { code: null, signal: null })
        continue
      }

      projectRecord(record, definition, at)
      store.putService(record)
      settleOperation(record, at)

      if (
        record.desired === 'RUNNING'
        && !isAlive(record)
        && !record.operationId
        && record.nextRestartAt !== null
        && at >= record.nextRestartAt
      ) {
        spawnCrashRestart(record, definition, at)
      }
    }
  }

  /**
   * Restore operator intent after a supervisor restart.
   *
   * A desired-RUNNING service whose process died while no supervisor was
   * watching has no pending crash restart in the new process. Without this, a
   * routine supervisor restart (service restart, host reboot) would leave every
   * service stopped until an operator pressed Start again.
   *
   * Only a normal `start` operation is queued, so every dependency check,
   * readiness rule and audit entry still applies. One attempt per boot: a failed
   * start is reported to the operator instead of becoming a restart loop.
   *
   * @returns {string[]} operation ids queued
   */
  function reconcileDesired() {
    const at = now()
    const queued = []
    for (const record of store.listServices()) {
      const definition = definitionOf(record.serviceId)
      if (!definition || definition.supervised === false) continue
      if (record.desired !== 'RUNNING') continue
      if (isAlive(record)) continue
      const active = record.operationId ? store.getOperation(record.operationId) : null
      if (active && isActiveOperation(active)) continue

      const result = request({
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        action: 'start',
        actor: 'supervisor-recovery',
        idempotencyKey: `recovery:${record.serviceId}:${record.scopeKey}:${record.generation}:${at}`,
        reason: 'restore desired state after supervisor restart',
      })
      if (result.ok) queued.push(result.operation.operationId)
    }
    return queued
  }

  // ---------------------------------------------------------------------------
  //  Command inbox (V4.2 §17.7, option b).
  // ---------------------------------------------------------------------------

  /**
   * Perform the commands the Operations API enqueued.
   *
   * The API never writes service state; it drops a command file and the
   * supervisor performs it here. Delivery is at-least-once, which is safe
   * because `request()` is idempotent on the caller-minted `operationId`.
   *
   * A command is only removed when it has been acted on, was permanently
   * invalid, or expired — never while it is merely waiting for a busy service.
   *
   * @param {{ dir?: string }} [options]
   */
  function consumeInbox(options = {}) {
    const dir = options.dir ?? commandsDir
    const at = now()
    const { commands, invalid, expired } = listCommands({ dir, now: at })
    const result = { performed: [], deferred: [], rejected: [], expired: [], invalid: [] }

    for (const command of commands) {
      const outcome = request({
        operationId: command.operationId,
        serviceId: command.serviceId,
        action: command.action,
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        scopeKey: command.scopeKey,
        reason: command.reason,
      })
      if (outcome.ok) {
        consumeCommand(command.operationId, { dir })
        result.performed.push(command.operationId)
        continue
      }
      // A busy service is temporary: keep the command for a later tick.
      if (outcome.code === 'OPERATION_IN_PROGRESS') {
        result.deferred.push(command.operationId)
        continue
      }
      // Everything else is permanent (unknown/planned/unsupervised service, an
      // unsupported action). Quarantine it rather than delete it: the operator
      // needs to see what was refused and why (§17.11 dead-letter), never just
      // an inbox that silently emptied.
      quarantineCommand(command, {
        dir,
        now: at,
        reason: `rejected: ${outcome.code}${outcome.detail ? ` — ${outcome.detail}` : ''}`,
      })
      store.appendAudit({
        at,
        actor: command.actor,
        action: 'command-rejected',
        serviceId: command.serviceId,
        scopeKey: command.scopeKey,
        operationId: command.operationId,
        detail: `${outcome.code}: ${outcome.detail ?? ''}`.trim(),
      })
      result.rejected.push({ operationId: command.operationId, code: outcome.code })
    }

    for (const command of expired) {
      // Keep the expired command in quarantine: "it never ran" is a fact worth
      // being able to prove, especially when the supervisor was down.
      quarantineCommand(command, {
        dir,
        now: at,
        reason: 'expired: the supervisor did not pick it up before its deadline',
      })
      store.appendAudit({
        at,
        actor: command.actor,
        action: 'command-expired',
        serviceId: command.serviceId,
        scopeKey: command.scopeKey,
        operationId: command.operationId,
        detail: 'the supervisor did not pick it up before its deadline',
      })
      result.expired.push(command.operationId)
    }

    for (const bad of invalid) {
      // A file we cannot parse can never be performed; quarantine the exact
      // bytes (so it cannot wedge the queue, and so the corruption is still
      // inspectable) and record why.
      quarantineFile(bad.file, {
        dir,
        now: at,
        reason: `invalid: ${bad.errors.join(', ')}`,
      })
      store.appendAudit({
        at,
        actor: 'supervisor',
        action: 'command-invalid',
        serviceId: null,
        scopeKey: null,
        operationId: null,
        detail: `${bad.file}: ${bad.errors.join(', ')}`,
      })
      result.invalid.push(bad.file)
    }

    return result
  }

  // ---------------------------------------------------------------------------
  //  Public API.
  // ---------------------------------------------------------------------------

  /**
   * Persist a control request and return its operation.
   *
   * Nothing is spawned here: `tick()` advances it. The operation is on disk
   * before this function returns, so an acknowledged command is never lost.
   */
  function request(input = {}) {
    const { serviceId, action, actor, idempotencyKey, scopeKey = 'system', reason = null, operationId = null } = input
    const at = now()

    // The Operations API (option b) mints the operationId and enqueues a command,
    // so the screen can poll for it before this process has looked at the inbox.
    // Replaying a command therefore must resolve to the SAME operation.
    if (operationId !== null) {
      if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(operationId)) {
        return { ok: false, code: 'INVALID_OPERATION_ID', detail: 'operationId contains unsafe characters' }
      }
      const already = store.getOperation(operationId)
      if (already) return { ok: true, idempotent: true, operation: already }
    }

    if (typeof serviceId !== 'string' || serviceId.length === 0) {
      return { ok: false, code: 'INVALID_SERVICE_ID', detail: 'serviceId is required' }
    }
    if (!SERVICE_ACTIONS.includes(action)) {
      return { ok: false, code: 'INVALID_ACTION', detail: `unknown action ${action}` }
    }
    if (typeof actor !== 'string' || actor.length === 0) {
      return { ok: false, code: 'ACTOR_REQUIRED', detail: 'actor is required' }
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED', detail: 'idempotencyKey is required' }
    }

    const definition = definitionOf(serviceId)
    if (!definition) return { ok: false, code: 'UNKNOWN_SERVICE', detail: `no definition for ${serviceId}` }
    if (definition.planned && action !== 'probe') {
      return { ok: false, code: 'SERVICE_NOT_IMPLEMENTED', detail: `${serviceId} is a planned service` }
    }
    if (definition.supervised === false && action !== 'probe') {
      return {
        ok: false,
        code: 'SERVICE_NOT_SUPERVISED',
        detail: `${serviceId} is still hosted by another process; only probe is allowed`,
      }
    }
    if (!definition.supports.includes(action)) {
      return { ok: false, code: 'ACTION_NOT_SUPPORTED', detail: `${serviceId} does not support ${action}` }
    }

    const existing = store.findOperationByIdempotencyKey(idempotencyKey)
    if (existing) {
      if (existing.serviceId !== serviceId || existing.action !== action || existing.scopeKey !== scopeKey) {
        return { ok: false, code: 'IDEMPOTENCY_MISMATCH', operation: existing }
      }
      return { ok: true, idempotent: true, operation: existing }
    }

    const conflict = store.activeOperationFor(serviceId, scopeKey)
    if (conflict) {
      return { ok: false, code: 'OPERATION_IN_PROGRESS', operation: conflict }
    }

    const record = store.ensureService(serviceId, scopeKey)
    const operation = {
      operationId: operationId ?? `op_${randomUUID()}`,
      serviceId,
      scopeKey,
      action,
      requestedBy: actor,
      requestedAt: at,
      idempotencyKey,
      state: 'QUEUED',
      phase: 'queued',
      deadlineAt: at + operationTimeoutMs,
      result: reason ? { reason } : {},
    }

    if (action === 'start' || action === 'restart' || action === 'reset') record.desired = 'RUNNING'
    if (action === 'stop') record.desired = 'STOPPED'
    record.operationId = operation.operationId

    store.putOperation(operation)
    store.putService(record)
    store.rememberIdempotencyKey(idempotencyKey, operation.operationId)
    store.save()
    audit('operation-requested', operation, reason, at)
    store.save()

    return { ok: true, operation }
  }

  /**
   * Keep the exclusive lease alive for every instance this supervisor hosts.
   *
   * The lease is the only thing that stops the legacy orchestrator from running
   * a second copy of a service, so it has to outlive the instance rather than
   * just its spawn: claiming once and never renewing silently released a running
   * service after `leaseTtlMs`, which let `services/run.mjs` start duplicates
   * while the supervisor still reported the service as READY.
   *
   * Only instances this process actually holds a handle to are renewed, and a
   * lease still held by *another* live owner is respected until it expires (an
   * adopted instance from a previous supervisor keeps its claim for at most one
   * TTL, and is taken over afterwards).
   *
   * @returns {number} how many leases were refreshed or claimed
   */
  function renewHostedLeases(at) {
    let renewed = 0
    for (const entry of processes.values()) {
      const record = store.getService(entry.serviceId, entry.scopeKey)
      if (!record) continue
      const lease = record.lease
      if (lease?.owner === supervisorId) {
        if (store.renewLease({
          serviceId: record.serviceId,
          scopeKey: record.scopeKey,
          owner: supervisorId,
          ttlMs: leaseTtlMs,
          now: at,
        })) renewed += 1
        continue
      }
      // Someone else's unexpired claim: not ours to take yet.
      if (lease && Number(lease.expiresAt) > at) continue
      const claim = store.claimLease({
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        owner: supervisorId,
        serviceInstanceId: record.serviceInstanceId,
        ttlMs: leaseTtlMs,
        now: at,
      })
      if (claim.ok) renewed += 1
    }
    return renewed
  }

  /**
   * Advance every active operation and reconcile process state.
   *
   * Commands enqueued by the Operations API are performed first, so a command
   * accepted between two ticks is advanced within the same pass.
   *
   * @param {{ consumeCommands?: boolean, commandsDir?: string }} [options]
   * @returns {ReturnType<typeof snapshot>}
   */
  function tick(options = {}) {
    // A drain in flight owns the state until it finishes: re-deriving readiness
    // here would overwrite the drained records with stale READY verdicts and
    // make the workers' own exits look like crashes.
    if (draining) return snapshot()
    const at = now()
    if (options.consumeCommands !== false) consumeInbox(options.commandsDir ? { dir: options.commandsDir } : {})
    store.expireLeases(at)
    renewHostedLeases(at)
    expireOperations(at)
    recoverServices(at)
    for (const operation of store.listOperations({ activeOnly: true })) {
      // Re-read: a previous operation may have completed a later one.
      const current = store.getOperation(operation.operationId)
      if (!isActiveOperation(current)) continue
      try {
        advance(current, at)
      } catch (error) {
        const record = store.ensureService(current.serviceId, current.scopeKey)
        fail(current, record, 'SUPERVISOR_ERROR', String(error?.message || error), { at })
      }
    }
    return snapshot()
  }

  /** Projection for the Operations API and the CLI. */
  function snapshot() {
    const services = store.listServices().map((record) => {
      const definition = definitionOf(record.serviceId)
      return {
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        label: definition?.label ?? record.serviceId,
        desired: record.desired,
        observed: record.observed,
        health: record.health,
        drift: isDrifted(record.desired, record.observed),
        serviceInstanceId: record.serviceInstanceId,
        generation: record.generation,
        pid: record.pid,
        host: record.host,
        lastHeartbeatAt: record.lastHeartbeatAt,
        lastSuccessAt: record.lastSuccessAt,
        lastErrorAt: record.lastErrorAt,
        lastError: record.lastError,
        restartCount: record.restartCount,
        nextRestartAt: record.nextRestartAt,
        readiness: record.readiness,
        freshness: null,
        telemetry: record.telemetry,
        workload: {
          queueDepth: null,
          inFlight: null,
          lastDurationMs: record.lastDurationMs,
          lastOutputCount: record.lastOutputCount,
        },
        operationId: record.operationId,
      }
    })
    const operations = store.listOperations().slice(-100).reverse()
    return {
      schemaVersion: SUPERVISOR_SCHEMA_VERSION,
      at: now(),
      services,
      operations,
      audit: store.snapshot().audit,
    }
  }

  /**
   * Drain every live worker (supervisor shutdown). Does not change desired
   * state: operator intent survives a supervisor restart.
   */
  async function drain({ graceMs = stopGraceMs, pollMs = 100 } = {}) {
    draining = true
    try {
      const live = store.listServices().filter(record => isAlive(record))
      for (const record of live) {
        record.stopping = true
        const entry = processes.get(keyOf(record.serviceId, record.scopeKey))
        if (typeof entry?.handle?.send === 'function') {
          entry.handle.send({ type: 'shutdown', reason: 'supervisor-shutdown', graceMs })
        } else {
          signalProcess(record, 'SIGTERM')
        }
        store.putService(record)
      }

      const deadline = now() + graceMs
      while (now() < deadline && live.some(record => isAlive(record))) {
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      const killed = []
      for (const record of live) {
        if (!isAlive(record)) continue
        signalProcess(record, 'SIGKILL')
        killed.push(record.serviceId)
      }

      // Persist the drained outcome before the process exits. The IPC `stopped`
      // messages may not arrive before `process.exit()`, and a `stopping` flag
      // left on disk would otherwise pin the service in STOPPING after restart.
      // Desired state is deliberately untouched: operator intent survives.
      for (const record of live) {
        if (isAlive(record)) continue
        record.pid = null
        record.stopping = false
        record.observed = 'STOPPED'
        record.health = 'UNKNOWN'
        record.serviceInstanceId = null
        store.releaseLease({ serviceId: record.serviceId, scopeKey: record.scopeKey, owner: supervisorId })
        store.putService(record)
      }

      return { drained: live.filter(record => !isAlive(record)).length, killed }
    } finally {
      draining = false
    }
  }

  /** Re-attach to processes that survived a supervisor restart. */
  function adopt() {
    if (typeof workers.adopt !== 'function') return 0
    let adopted = 0
    for (const record of store.listServices()) {
      if (!record.pid || processes.has(keyOf(record.serviceId, record.scopeKey))) continue
      if (typeof workers.isAlive === 'function' && !workers.isAlive(record.pid)) continue
      const handle = workers.adopt(record.pid)
      if (!handle) continue
      const entry = {
        handle,
        serviceId: record.serviceId,
        scopeKey: record.scopeKey,
        instanceId: record.serviceInstanceId,
      }
      processes.set(keyOf(record.serviceId, record.scopeKey), entry)
      adopted += 1
    }
    return adopted
  }

  return {
    supervisorId,
    request,
    tick,
    snapshot,
    adopt,
    drain,
    reconcileDesired,
    consumeInbox,
    // Exposed for tests and the CLI.
    isAlive: record => isAlive(record),
    get processes() { return processes },
  }
}

// =============================================================================
//  Default worker adapter — one Node child process per service instance.
// =============================================================================

/**
 * Spawn `services/workerHost.mjs` as a child with an IPC channel.
 *
 * The child gets the parent's environment because the services need their
 * existing configuration (Mongo URI, provider keys). The supervisor never
 * logs or returns that environment.
 */
export function createProcessAdapter(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const forkImpl = options.forkImpl ?? fork
  const baseEnv = options.env ?? process.env

  return {
    spawn({ definition, serviceId, scopeKey, serviceInstanceId, generation, mode, reset, operationId }) {
      const child = forkImpl(join(cwd, 'services', 'workerHost.mjs'), [], {
        cwd,
        env: {
          ...baseEnv,
          TM_SERVICE_ID: definition.id,
          TM_SERVICE_INSTANCE_ID: serviceInstanceId,
          TM_SERVICE_GENERATION: String(generation),
          TM_SERVICE_MODE: mode,
          TM_SERVICE_RESET: reset ? '1' : '0',
          TM_SERVICE_SCOPE: scopeKey ?? 'system',
          ...(operationId ? { TM_OPERATION_ID: operationId } : {}),
        },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })

      const handle = {
        pid: child.pid ?? null,
        instanceId: serviceInstanceId,
        alive: true,
        send(message) {
          if (child.connected) child.send(message)
        },
        kill(signal = 'SIGTERM') {
          try {
            child.kill(signal)
          } catch {
            // Already gone.
          }
        },
        onMessage(callback) {
          child.on('message', callback)
        },
        onExit(callback) {
          child.on('exit', (code, signal) => {
            handle.alive = false
            callback({ code, signal })
          })
        },
      }
      return handle
    },

    isAlive(pid) {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },

    /**
     * Liveness-only adoption: a process forked by a previous supervisor has no
     * IPC channel here, so it can be killed but not drained gracefully.
     */
    adopt(pid) {
      try {
        process.kill(pid, 0)
      } catch {
        return null
      }
      return {
        pid,
        instanceId: null,
        alive: true,
        send: null,
        kill(signal = 'SIGTERM') {
          try {
            process.kill(pid, signal)
          } catch {
            // Already gone.
          }
        },
        onMessage() {},
        onExit() {},
      }
    },

    kill(pid, signal = 'SIGTERM') {
      try {
        process.kill(pid, signal)
      } catch {
        // Already gone.
      }
    },
  }
}

// =============================================================================
//  CLI — the first real control path before the S2 HTTP API exists.
// =============================================================================

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const store = createSupervisorStore({ file: process.env.TM_SUPERVISOR_STATE || SUPERVISOR_STATE_FILE })
  const { registry, source } = await loadRegistry()
  const supervisor = createSupervisor({ store, registry, workers: createProcessAdapter() })
  const command = process.argv[2] || 'status'
  const serviceId = process.argv[3]
  const flag = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

  if (command === 'status') {
    supervisor.adopt()
    // `status` is a read: it must never pick up and execute queued commands.
    const view = supervisor.tick({ consumeCommands: false })
    for (const service of view.services) {
      const mark = service.observed === 'READY' ? 'READY   ' : service.observed.padEnd(8)
      console.log(
        `${mark} ${service.serviceId.padEnd(14)} desired=${service.desired.padEnd(7)} health=${service.health.padEnd(9)}`
        + ` gen=${service.generation} pid=${service.pid ?? '-'}${service.lastError ? ` err=${service.lastError}` : ''}`,
      )
    }
    if (view.operations.length === 0) console.log('no operations recorded')
    process.exit(0)
  }

  if (command === 'tick') {
    supervisor.adopt()
    const view = supervisor.tick()
    console.log(JSON.stringify({ at: view.at, services: view.services.length, operations: view.operations.length }, null, 2))
    process.exit(0)
  }

  if (command === 'quarantine') {
    // The dead-letter box is where dropped commands go instead of vanishing.
    // Reading it is a pure read: no adopt, no tick, no side effects.
    const limit = Number(flag('limit')) || 20
    const entries = listQuarantine({ limit })
    if (entries.length === 0) console.log('quarantine is empty')
    for (const entry of entries) {
      const when = entry.quarantinedAt ? new Date(entry.quarantinedAt).toISOString() : 'unknown time'
      const what = entry.command
        ? `${entry.command.serviceId}/${entry.command.action}`
        : (entry.source ?? 'unreadable file')
      console.log(`${when}  ${what.padEnd(28)}  ${entry.reason}`)
    }
    process.exit(0)
  }

  if (command === 'run') {
    const tickMs = Number(process.env.SUPERVISOR_TICK_MS || 5_000)
    supervisor.adopt()
    // Restore operator intent that outlived the previous supervisor process.
    const recovered = supervisor.reconcileDesired()
    console.log(`[supervisor] ${supervisor.supervisorId} tick=${tickMs}ms state=${store.file} registry=${source} recovered=${recovered.length}`)
    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      console.log('[supervisor] draining workers ...')
      const result = await supervisor.drain()
      console.log(`[supervisor] drained=${result.drained} killed=${result.killed.join(',') || 'none'}`)
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    // win32 does not run a signal handler for `child.kill('SIGTERM')`, so an OS
    // wrapper or the drill harness asks for the same drain over IPC instead.
    process.on('message', (message) => {
      if (message?.type === 'shutdown') void shutdown()
    })
    for (;;) {
      try {
        supervisor.tick()
      } catch (error) {
        // A tick that throws must not kill the daemon: the alternative is that
        // every worker it owns is left unsupervised (and a crashed supervisor
        // cannot restart them). Log it, keep the loop alive, and let the next
        // tick retry — the state file write is retried internally, so reaching
        // here means something genuinely unexpected.
        console.error(`[supervisor] tick failed: ${String(error?.stack || error)}`)
      }
      await sleep(tickMs)
    }
  }

  const actions = ['start', 'stop', 'restart', 'reset', 'probe', 'run-once']
  if (actions.includes(command)) {
    if (!serviceId) {
      console.error(`usage: node services/supervisor.mjs ${command} <serviceId> [--scope=system] [--actor=cli] [--key=...]`)
      process.exit(2)
    }
    supervisor.adopt()
    const result = supervisor.request({
      serviceId,
      action: command,
      actor: flag('actor') || 'cli',
      idempotencyKey: flag('key') || `cli-${command}-${serviceId}-${Date.now()}`,
      scopeKey: flag('scope') || 'system',
      reason: flag('reason'),
    })
    if (!result.ok) {
      console.error(`[supervisor] rejected: ${result.code}${result.detail ? ` — ${result.detail}` : ''}`)
      if (result.operation) console.error(JSON.stringify(result.operation, null, 2))
      process.exit(1)
    }
    let operation = result.operation
    const deadline = Date.now() + Number(process.env.SUPERVISOR_COMMAND_TIMEOUT_MS || 180_000)
    while (isActiveOperation(operation) && Date.now() < deadline) {
      supervisor.tick()
      operation = store.getOperation(operation.operationId)
      if (isActiveOperation(operation)) await sleep(250)
    }
    console.log(JSON.stringify(operation, null, 2))
    process.exit(operation.state === 'SUCCEEDED' ? 0 : 1)
  }

  console.error(`unknown command: ${command} (status | tick | quarantine | run | ${actions.join(' | ')})`)
  process.exit(2)
}
