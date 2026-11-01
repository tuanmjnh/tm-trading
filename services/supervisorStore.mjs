// =============================================================================
//  TM TRADING — SUPERVISOR STATE STORE (V4.2 §17.5–§17.7)
//
//  Durable state for the service supervisor: desired state, observed state,
//  operations, idempotency keys, leases and an audit trail.
//
//  Why a file and not Mongo yet: the supervisor is a SINGLE process on ONE
//  host (A1 — nssm/Task Scheduler on win32, systemd on Linux). A JSON file
//  written atomically is durable across supervisor restarts, needs no
//  connection at boot (the supervisor must be able to stop a wedged service
//  even when Mongo is down) and keeps the S1.3 contract testable without a
//  database. The Mongo adapter arrives in S2, when the API and the supervisor
//  become separate writers and need real multi-writer semantics.
//
//  Rules encoded here:
//
//    - every mutation is written to disk BEFORE the caller acknowledges it;
//    - a repeated idempotency key resolves to the same operation, and the same
//      key with a different action is a mismatch, never a silent replay;
//    - a lease blocks a second live instance for the same service+scope, and an
//      EXPIRED lease is reclaimable (a crashed supervisor must not lock the
//      service out forever);
//    - the audit trail is append-only and bounded, so the file cannot grow
//      without limit.
//
//  `file: null` gives an in-memory store for tests; everything else is
//  identical, so the tests exercise the real code path.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { writeFileAtomicSync } from './atomicFile.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Default state file — outside the dev watch path, next to the heartbeat. */
export const SUPERVISOR_STATE_FILE = join(ROOT, 'node_modules', '.cache', 'tm-trading', 'supervisor.json')

export const STORE_SCHEMA_VERSION = 'supervisor-store.v1'

/** How many audit rows are kept. Older rows are dropped, never rewritten. */
export const MAX_AUDIT_ROWS = 500

/** Service key = one lifecycle per service and ownership scope. */
export function serviceKey(serviceId, scopeKey = 'system') {
  return `${serviceId}::${scopeKey}`
}

/** Fresh, empty state. */
export function emptyState() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    updatedAt: '',
    revision: 0,
    services: {},
    operations: {},
    idempotency: {},
    audit: [],
  }
}

/** Default record for a service that has never been seen. */
export function emptyServiceRecord(serviceId, scopeKey = 'system') {
  return {
    serviceId,
    scopeKey,
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
    lastDurationMs: null,
    lastOutputCount: null,
    restartCount: 0,
    stopping: false,
    heartbeatLost: false,
    nextRestartAt: null,
    operationId: null,
    evidence: {},
    readiness: [],
    telemetry: null,
    lease: null,
    updatedAt: '',
  }
}

/** Fail-soft read: a missing/corrupt file is empty state, never a throw. */
export function readStateFile(file) {
  try {
    if (!existsSync(file)) return emptyState()
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object') return emptyState()
    return {
      ...emptyState(),
      ...raw,
      services: raw.services && typeof raw.services === 'object' ? raw.services : {},
      operations: raw.operations && typeof raw.operations === 'object' ? raw.operations : {},
      idempotency: raw.idempotency && typeof raw.idempotency === 'object' ? raw.idempotency : {},
      audit: Array.isArray(raw.audit) ? raw.audit : [],
    }
  } catch {
    return emptyState()
  }
}

/** Deep clone of a JSON-safe value (state never holds functions or dates). */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Create a store.
 *
 * @param {{ file?: string | null, now?: () => number, maxAudit?: number }} [options]
 */
export function createSupervisorStore(options = {}) {
  const file = options.file === undefined ? SUPERVISOR_STATE_FILE : options.file
  const now = options.now ?? (() => Date.now())
  const maxAudit = Number.isFinite(options.maxAudit) && options.maxAudit > 0 ? options.maxAudit : MAX_AUDIT_ROWS

  let state = file ? readStateFile(file) : emptyState()

  /**
   * Persist atomically (tmp, then rename).
   *
   * The rename goes through `writeFileAtomicSync()` because on win32 a
   * concurrent reader (the Operations API) can make `renameSync()` fail with
   * EPERM. A retry turns that transient contention into latency instead of a
   * crashed supervisor.
   */
  function save() {
    state.updatedAt = new Date(now()).toISOString()
    state.revision = (Number(state.revision) || 0) + 1
    if (!file) return state
    writeFileAtomicSync(file, JSON.stringify(state, null, 2))
    return state
  }

  function getService(serviceId, scopeKey = 'system') {
    return state.services[serviceKey(serviceId, scopeKey)] ?? null
  }

  /** Read-modify-write helper: the record always exists after this call. */
  function ensureService(serviceId, scopeKey = 'system') {
    const key = serviceKey(serviceId, scopeKey)
    if (!state.services[key]) state.services[key] = emptyServiceRecord(serviceId, scopeKey)
    return state.services[key]
  }

  function putService(record) {
    record.updatedAt = new Date(now()).toISOString()
    state.services[serviceKey(record.serviceId, record.scopeKey)] = record
    save()
    return record
  }

  function listServices() {
    return Object.values(state.services)
  }

  function getOperation(operationId) {
    return state.operations[operationId] ?? null
  }

  function putOperation(operation) {
    state.operations[operation.operationId] = operation
    save()
    return operation
  }

  function listOperations(options = {}) {
    const operations = Object.values(state.operations)
    const filtered = options.activeOnly
      ? operations.filter(operation => operation.state === 'QUEUED' || operation.state === 'RUNNING')
      : operations
    return filtered.sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0))
  }

  /** The one non-terminal operation for a service+scope, if any. */
  function activeOperationFor(serviceId, scopeKey = 'system') {
    return listOperations({ activeOnly: true })
      .find(operation => operation.serviceId === serviceId && operation.scopeKey === scopeKey) ?? null
  }

  function findOperationByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null
    const operationId = state.idempotency[idempotencyKey]
    return operationId ? getOperation(operationId) : null
  }

  function rememberIdempotencyKey(idempotencyKey, operationId) {
    if (idempotencyKey) state.idempotency[idempotencyKey] = operationId
  }

  function appendAudit(entry) {
    const row = { at: now(), ...entry, auditId: `aud_${randomUUID()}` }
    state.audit.push(row)
    if (state.audit.length > maxAudit) state.audit = state.audit.slice(-maxAudit)
    return row
  }

  /**
   * Claim the exclusive lease for one service+scope.
   *
   * @returns {{ ok: true, lease: object } | { ok: false, code: 'LEASE_HELD', lease: object }}
   */
  function claimLease({ serviceId, scopeKey = 'system', owner, serviceInstanceId, ttlMs, now: at }) {
    const record = ensureService(serviceId, scopeKey)
    const current = record.lease
    const ts = Number.isFinite(at) ? at : now()
    if (current && current.owner !== owner && Number(current.expiresAt) > ts) {
      return { ok: false, code: 'LEASE_HELD', lease: current }
    }
    record.lease = { owner, serviceInstanceId, expiresAt: ts + ttlMs, acquiredAt: ts }
    save()
    return { ok: true, lease: record.lease }
  }

  function renewLease({ serviceId, scopeKey = 'system', owner, ttlMs, now: at }) {
    const record = getService(serviceId, scopeKey)
    if (!record?.lease || record.lease.owner !== owner) return null
    const ts = Number.isFinite(at) ? at : now()
    record.lease.expiresAt = ts + ttlMs
    save()
    return record.lease
  }

  function releaseLease({ serviceId, scopeKey = 'system', owner }) {
    const record = getService(serviceId, scopeKey)
    if (!record?.lease) return false
    if (owner && record.lease.owner !== owner) return false
    record.lease = null
    save()
    return true
  }

  /** Drop expired leases; returns how many were released. */
  function expireLeases(at = now()) {
    let count = 0
    for (const record of listServices()) {
      if (record.lease && Number(record.lease.expiresAt) <= at) {
        record.lease = null
        count += 1
      }
    }
    if (count > 0) save()
    return count
  }

  /** Clone of everything the API/CLI may read. */
  function snapshot() {
    return {
      schemaVersion: state.schemaVersion,
      updatedAt: state.updatedAt,
      revision: state.revision,
      services: clone(listServices()),
      operations: clone(listOperations()),
      audit: clone(state.audit.slice(-100)),
    }
  }

  /** Re-read from disk (a reader process following the supervisor). */
  function reload() {
    if (file) state = readStateFile(file)
    return state
  }

  return {
    file,
    get state() { return state },
    save,
    reload,
    getService,
    ensureService,
    putService,
    listServices,
    getOperation,
    putOperation,
    listOperations,
    activeOperationFor,
    findOperationByIdempotencyKey,
    rememberIdempotencyKey,
    appendAudit,
    claimLease,
    renewLease,
    releaseLease,
    expireLeases,
    snapshot,
  }
}

/** Read-only convenience for API routes and the CLI. */
export function readSupervisorSnapshot(file = SUPERVISOR_STATE_FILE) {
  const store = createSupervisorStore({ file })
  return store.snapshot()
}
