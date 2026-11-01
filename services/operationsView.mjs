// =============================================================================
//  TM TRADING — OPERATIONS VIEW (V4.2 §17.9)
//
//  The Operations screen needs two things at once:
//
//    1. the REGISTRY, so it can show every unit of work even before a
//       supervisor has ever run (planned services, unsupervised hosts, the
//       dependency graph, the actions each service supports);
//    2. the SUPERVISOR SNAPSHOT, so it can show proof: desired vs observed,
//       readiness checks, telemetry and the operation timeline.
//
//  This module merges them into one read model and nothing else. It never
//  probes, spawns or writes — the API is read-only here, and mutations are
//  supervisor operations. Keeping the merge pure means the API route is a thin
//  loader and the shape is testable without a database or a running supervisor.
//
//  Honesty rules:
//
//    - a service that is in the registry but absent from the snapshot is
//      `registered: false, observed: 'UNKNOWN'` — "never started" must not look
//      like "stopped on purpose";
//    - the summary counts mirror the per-service verdicts, so a number on a
//      card can never disagree with the table under it.
// =============================================================================

import { SERVICES } from './registry.mjs'
import { isDrifted } from './readiness.mjs'
import { evaluateSlo } from './slo.mjs'

/** Version stamp (D1). */
export const OPERATIONS_VIEW_SCHEMA_VERSION = 'operations-view.v1'

/** How many recent operations the view carries. The store keeps the audit too. */
export const DEFAULT_RECENT_OPERATIONS = 50

/** Lifecycle states that mean "something is running or about to be". */
const ACTIVE_STATES = new Set(['STARTING', 'READY', 'DEGRADED', 'STOPPING'])

/**
 * Operation states that are over. Only a finished operation can be timed: an
 * in-flight one has no finish, so reporting a duration for it would be a guess.
 */
const TERMINAL_OPERATION_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCONFIRMED'])

/**
 * Flatten one store record for the table.
 *
 * @param {object | null} record
 */
function serviceStateOf(record) {
  if (!record) {
    return {
      desired: 'STOPPED',
      observed: 'UNKNOWN',
      health: 'UNKNOWN',
      serviceInstanceId: null,
      generation: 0,
      pid: null,
      host: null,
      startedAt: null,
      lastHeartbeatAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      restartCount: 0,
      nextRestartAt: null,
      operationId: null,
      readiness: [],
      telemetry: null,
      lastDurationMs: null,
      lastOutputCount: null,
      lease: null,
    }
  }
  return {
    desired: record.desired ?? 'STOPPED',
    observed: record.observed ?? 'UNKNOWN',
    health: record.health ?? 'UNKNOWN',
    serviceInstanceId: record.serviceInstanceId ?? null,
    generation: record.generation ?? 0,
    pid: record.pid ?? null,
    host: record.host ?? null,
    startedAt: record.startedAt ?? null,
    lastHeartbeatAt: record.lastHeartbeatAt ?? null,
    lastSuccessAt: record.lastSuccessAt ?? null,
    lastErrorAt: record.lastErrorAt ?? null,
    lastError: record.lastError ?? null,
    restartCount: record.restartCount ?? 0,
    nextRestartAt: record.nextRestartAt ?? null,
    operationId: record.operationId ?? null,
    readiness: Array.isArray(record.readiness) ? record.readiness : [],
    telemetry: record.telemetry ?? null,
    lastDurationMs: record.lastDurationMs ?? null,
    lastOutputCount: record.lastOutputCount ?? null,
    lease: record.lease ?? null,
  }
}

/**
 * The most recent terminal operation per service, timed (§17.13).
 *
 * Control-plane latency is derived from the operation timeline the supervisor
 * already records — no new measurement and no sampling. Two numbers fall out of
 * the three timestamps, and they mean different things:
 *
 *   - `queueMs` (requested → started) is how long a command waited for the
 *     supervisor to get to it;
 *   - `runMs` (started → finished) is how long the supervisor then spent.
 *
 * `durationMs` is the sum, which is what the operator actually felt. A service
 * with no terminal operation has no latency, so it maps to nothing rather than
 * to zero.
 *
 * @param {ReadonlyArray<object>} operations newest-first
 */
function latestControlByService(operations) {
  const controls = new Map()
  for (const operation of operations) {
    const serviceId = operation?.serviceId
    if (!serviceId || controls.has(serviceId)) continue
    if (!TERMINAL_OPERATION_STATES.has(operation?.state)) continue
    const requestedAt = Number.isFinite(operation.requestedAt) ? operation.requestedAt : null
    const finishedAt = Number.isFinite(operation.finishedAt) ? operation.finishedAt : null
    if (requestedAt === null || finishedAt === null) continue
    const startedAt = Number.isFinite(operation.startedAt) ? operation.startedAt : null
    controls.set(serviceId, {
      operationId: operation.operationId,
      action: operation.action,
      state: operation.state,
      requestedAt,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - requestedAt),
      queueMs: startedAt === null ? null : Math.max(0, startedAt - requestedAt),
      runMs: startedAt === null ? null : Math.max(0, finishedAt - startedAt),
    })
  }
  return controls
}

/**
 * Merge one registry definition with its store record.
 *
 * @param {import('../shared/types/service').ManagedServiceDefinition} definition
 * @param {object | null} record
 * @param {number} now
 * @param {ReadonlyArray<object>} audit
 * @param {object | null} [control] latest terminal operation, timed
 */
function serviceRow(definition, record, now, audit = [], control = null) {
  const state = serviceStateOf(record)
  return {
    // SLOs (§17.13) are evaluated from the same evidence the row shows, so the
    // verdict can always be explained by the fields beside it.
    slo: evaluateSlo({ definition, record, audit, now }),
    control,
    serviceId: definition.id,
    label: definition.label,
    description: definition.description ?? null,
    category: definition.category,
    scope: definition.scope,
    processGroup: definition.processGroup,
    executionMode: definition.executionMode,
    intervalSec: definition.intervalSec,
    intervalEnv: definition.intervalEnv ?? null,
    planned: definition.planned === true,
    supervised: definition.supervised !== false,
    supports: definition.supports ?? [],
    dependencies: definition.dependencies ?? [],
    readiness: state.readiness,
    registered: Boolean(record),
    desired: state.desired,
    observed: state.observed,
    health: state.health,
    // Drift means "the operator asked for something we cannot prove". A service
    // nobody ever touched expressed no intent, so it is not drifting even though
    // its observed state is UNKNOWN.
    drift: record ? isDrifted(state.desired, state.observed) : false,
    active: ACTIVE_STATES.has(state.observed),
    serviceInstanceId: state.serviceInstanceId,
    generation: state.generation,
    pid: state.pid,
    host: state.host,
    startedAt: state.startedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastSuccessAt: state.lastSuccessAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    restartCount: state.restartCount,
    nextRestartAt: state.nextRestartAt,
    operationId: state.operationId,
    telemetry: state.telemetry,
    lease: state.lease,
    workload: {
      // Queue depth and in-flight work have no producer yet (A5: no queue).
      queueDepth: null,
      inFlight: null,
      lastDurationMs: state.lastDurationMs,
      lastOutputCount: state.lastOutputCount,
    },
    // Readiness freshness is derived from the heartbeat by the UI, not here:
    // the API returns timestamps, the screen decides how to age them.
    heartbeatAgeMs: state.lastHeartbeatAt === null ? null : Math.max(0, now - state.lastHeartbeatAt),
  }
}

/**
 * Build the Operations read model.
 *
 * @param {{
 *   registry?: ReadonlyArray<import('../shared/types/service').ManagedServiceDefinition>,
 *   snapshot?: { services?: object[], operations?: object[], audit?: object[] } | null,
 *   pendingOperations?: object[],
 *   now?: number,
 *   recentOperations?: number,
 *   deadLetterCount?: number,
 * }} [input]
 */
export function buildOperationsView(input = {}) {
  const {
    registry = SERVICES,
    snapshot = null,
    now = Date.now(),
    recentOperations = DEFAULT_RECENT_OPERATIONS,
    deadLetterCount = 0,
  } = input

  const records = new Map()
  for (const record of snapshot?.services ?? []) {
    if (record?.serviceId) records.set(`${record.serviceId}::${record.scopeKey ?? 'system'}`, record)
  }

  const audit = snapshot?.audit ?? []

  // A command the supervisor has not consumed yet is still real to the operator:
  // it was accepted and will be performed. Merge it in so a click is visible
  // immediately, without ever shadowing the authoritative record.
  const operations = [...(snapshot?.operations ?? [])]
  const seenOperations = new Set(operations.map(operation => operation?.operationId).filter(Boolean))
  for (const pending of input.pendingOperations ?? []) {
    if (!pending?.operationId || seenOperations.has(pending.operationId)) continue
    operations.push({ ...pending, pending: true })
  }
  operations.sort((a, b) => (b?.requestedAt ?? 0) - (a?.requestedAt ?? 0))
  const recent = operations.slice(0, Math.max(0, recentOperations))

  // Control-plane latency is read from the full timeline, not the capped slice,
  // so an older service keeps its last measured control time even after it falls
  // out of the recent list.
  const controls = latestControlByService(operations)

  const services = registry.map(definition =>
    serviceRow(definition, records.get(`${definition.id}::system`) ?? null, now, audit, controls.get(definition.id) ?? null),
  )

  // A record the registry does not know about must still be visible rather than
  // silently dropped; it is a real process the supervisor tracks.
  const known = new Set(registry.map(definition => definition.id))
  for (const record of snapshot?.services ?? []) {
    if (!record?.serviceId || known.has(record.serviceId)) continue
    const state = serviceStateOf(record)
    services.push({
      serviceId: record.serviceId,
      label: record.serviceId,
      description: null,
      category: 'platform',
      scope: record.scopeKey ?? 'system',
      processGroup: null,
      executionMode: 'on-demand',
      intervalSec: null,
      intervalEnv: null,
      planned: false,
      supervised: true,
      supports: ['probe'],
      dependencies: [],
      readiness: state.readiness,
      slo: evaluateSlo({ definition: { id: record.serviceId, intervalSec: null }, record, audit, now }),
      control: controls.get(record.serviceId) ?? null,
      registered: true,
      desired: state.desired,
      observed: state.observed,
      health: state.health,
      drift: isDrifted(state.desired, state.observed),
      active: ACTIVE_STATES.has(state.observed),
      serviceInstanceId: state.serviceInstanceId,
      generation: state.generation,
      pid: state.pid,
      host: state.host,
      startedAt: state.startedAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastSuccessAt: state.lastSuccessAt,
      lastErrorAt: state.lastErrorAt,
      lastError: state.lastError,
      restartCount: state.restartCount,
      nextRestartAt: state.nextRestartAt,
      operationId: state.operationId,
      telemetry: state.telemetry,
      lease: state.lease,
      workload: {
        queueDepth: null,
        inFlight: null,
        lastDurationMs: state.lastDurationMs,
        lastOutputCount: state.lastOutputCount,
      },
      heartbeatAgeMs: state.lastHeartbeatAt === null ? null : Math.max(0, now - state.lastHeartbeatAt),
    })
  }

  const summary = {
    total: services.length,
    ready: services.filter(s => s.observed === 'READY').length,
    degraded: services.filter(s => s.observed === 'DEGRADED').length,
    failed: services.filter(s => s.observed === 'FAILED').length,
    active: services.filter(s => s.active).length,
    stopped: services.filter(s => s.observed === 'STOPPED').length,
    unknown: services.filter(s => s.observed === 'UNKNOWN').length,
    drifting: services.filter(s => s.drift).length,
    planned: services.filter(s => s.planned).length,
    // SLO roll-up (§17.13). `unknown` is reported separately — it must never be
    // folded into "ok" and quietly turn a blind spot into a green number.
    sloBreached: services.filter(s => s.slo?.status === 'breached').length,
    sloAtRisk: services.filter(s => s.slo?.status === 'at-risk').length,
    sloUnknown: services.filter(s => s.slo?.status === 'unknown').length,
    // Dead-letter count (§17.13): commands dropped and kept for inspection.
    // Reported explicitly so a silent queue cannot look healthy.
    deadLetterCount: Number.isFinite(deadLetterCount) ? Math.max(0, Math.trunc(deadLetterCount)) : 0,
  }

  return {
    schemaVersion: OPERATIONS_VIEW_SCHEMA_VERSION,
    at: now,
    services,
    operations: recent,
    summary,
    audit: (snapshot?.audit ?? []).slice(-DEFAULT_RECENT_OPERATIONS),
  }
}
