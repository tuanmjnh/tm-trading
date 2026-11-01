import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SERVICE_ACTIONS,
  SUPERVISOR_SCHEMA_VERSION,
  createSupervisor,
  isActiveOperation,
  restartBackoffMs,
} from '../services/supervisor.mjs'
import {
  MAX_AUDIT_ROWS,
  STORE_SCHEMA_VERSION,
  createSupervisorStore,
  emptyServiceRecord,
  emptyState,
  readStateFile,
  serviceKey,
} from '../services/supervisorStore.mjs'
import { SERVICES } from '../services/registry.mjs'
import { overlappingSupervisorLeases } from '../services/orchestratorGuard.mjs'
import {
  enqueueCommand,
  listCommands,
  normaliseCommand,
  pendingOperations,
  validateCommand,
} from '../services/commandInbox.mjs'

// =============================================================================
//  V4.2 §17.5–§17.7 supervisor contract.
//
//  The supervisor is the single owner of service lifecycle, so the rules under
//  test are the ones an operator's command relies on:
//
//    1. a request is persisted BEFORE it is acknowledged, and a repeated
//       idempotency key resolves to the same operation;
//    2. START is not done until readiness is PROVEN, and a worker that never
//       proves it is failed on a bounded timeout;
//    3. STOP drains via IPC and only escalates to a kill after the grace period;
//    4. RESTART yields a new generation, and an unexpected exit schedules a
//       bounded-backoff restart rather than a silent UNKNOWN;
//    5. a service another process still hosts is never spawned (it may only be
//       probed), and a planned service is never presented as runnable.
//
//  Everything is driven through an injected clock and a fake worker adapter, so
//  no test waits on wall-clock time or starts a real child process.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

const READINESS = {
  processAlive: { id: 'process-alive', label: 'Process is alive', required: true },
  dependencyReachable: { id: 'dependency-reachable', label: 'Dependencies reachable', required: true },
  recentSuccess: { id: 'recent-success', label: 'A cycle completed within the allowed window', required: true },
  outputProduced: { id: 'output-produced', label: 'The last cycle produced output', required: false },
}

function serviceDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alpha',
    label: 'Alpha service',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/alpha.mjs',
    runExport: 'runAlpha',
    outputCountKeys: ['checked'],
    intervalSec: 900,
    intervalEnv: 'ALPHA_INTERVAL',
    startupGraceMs: 60_000,
    dependencies: [],
    readiness: [READINESS.processAlive, READINESS.recentSuccess, READINESS.outputProduced],
    supports: ['start', 'stop', 'restart', 'reset', 'run-once', 'probe'],
    ...overrides,
  }
}

const ALPHA = serviceDefinition()
const BETA = serviceDefinition({
  id: 'beta',
  label: 'Beta service',
  dependencies: [{ serviceId: 'alpha', policy: 'REQUIRE_READY' }],
  readiness: [READINESS.processAlive, READINESS.dependencyReachable, READINESS.recentSuccess],
})
const DEFAULT_REGISTRY = [ALPHA, BETA]

/** One microtask flush per queued callback (exit is delivered asynchronously). */
async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

interface FakeHandle {
  pid: number
  instanceId: string | null
  input: Record<string, unknown>
  alive: boolean
  sent: Array<Record<string, unknown>>
  kills: string[]
  send(message: Record<string, unknown>): void
  kill(signal?: string): void
  onSupervisorMessage(cb: (message: Record<string, unknown>) => void): void
  onMessage(cb: (message: Record<string, unknown>) => void): void
  onExit(cb: (info: { code?: number | null, signal?: string | null }) => void): void
  emit(message: Record<string, unknown>): void
  exit(info?: { code?: number | null, signal?: string | null }): void
}

function makeHandle(input: Record<string, unknown>, pid: number): FakeHandle {
  const messageCbs: Array<(message: Record<string, unknown>) => void> = []
  const exitCbs: Array<(info: { code?: number | null, signal?: string | null }) => void> = []
  const supervisorMessageCbs: Array<(message: Record<string, unknown>) => void> = []

  const handle: FakeHandle = {
    pid,
    instanceId: (input.serviceInstanceId as string) ?? null,
    input,
    alive: true,
    sent: [],
    kills: [],
    send(message) {
      handle.sent.push(message)
      for (const cb of supervisorMessageCbs.slice()) cb(message)
    },
    kill(signal = 'SIGTERM') {
      handle.kills.push(signal)
      // SIGKILL cannot be caught: the stub process dies at once.
      if (signal === 'SIGKILL') handle.exit({ code: null, signal: 'SIGKILL' })
    },
    onSupervisorMessage(cb) { supervisorMessageCbs.push(cb) },
    onMessage(cb) { messageCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
    emit(message) { for (const cb of messageCbs.slice()) cb(message) },
    exit(info = { code: 0, signal: null }) {
      if (!handle.alive) return
      handle.alive = false
      queueMicrotask(() => { for (const cb of exitCbs.slice()) cb(info) })
    },
  }
  return handle
}

/** A worker that obeys a drain request by exiting cleanly. */
function obedient(handle: FakeHandle) {
  handle.onSupervisorMessage((message) => {
    if (message.type === 'shutdown') handle.exit({ code: 0, signal: null })
  })
}

interface HarnessOptions {
  registry?: ReadonlyArray<Record<string, unknown>>
  behaviour?: (handle: FakeHandle, input: Record<string, unknown>) => void
  supervisor?: Record<string, unknown>
  commandsDir?: string
}

function makeHarness(options: HarnessOptions = {}) {
  let clock = NOW
  const store = createSupervisorStore({ file: null, now: () => clock })
  const spawned: FakeHandle[] = []
  let pid = 5000

  const workers = {
    spawn(input: Record<string, unknown>) {
      const handle = makeHandle(input, pid++)
      spawned.push(handle)
      ;(options.behaviour ?? obedient)(handle, input)
      return handle
    },
    isAlive(target: number) { return spawned.some(handle => handle.pid === target && handle.alive) },
    kill(target: number, signal = 'SIGTERM') { spawned.find(handle => handle.pid === target)?.kill(signal) },
    adopt(target: number) {
      const handle = spawned.find(candidate => candidate.pid === target && candidate.alive)
      if (!handle) return null
      return {
        pid: target,
        instanceId: handle.instanceId,
        alive: true,
        send: () => {},
        kill: () => {},
        onMessage: () => {},
        onExit: () => {},
      }
    },
  }

  // Every harness gets its own inbox so a test can never see another test's
  // commands (or a real supervisor's, if one is running on the machine).
  const commandsDir = options.commandsDir ?? mkdtempSync(join(tmpdir(), 'tm-cmd-harness-'))

  const supervisor = createSupervisor({
    store,
    registry: options.registry ?? DEFAULT_REGISTRY,
    workers,
    now: () => clock,
    host: 'test-host',
    supervisorId: 'test-host:1',
    commandsDir,
    ...options.supervisor,
  })

  return {
    supervisor,
    store,
    spawned,
    workers,
    commandsDir,
    now: () => clock,
    setClock: (value: number) => { clock = value },
    advance: (ms: number) => { clock += ms },
  }
}

type Harness = ReturnType<typeof makeHarness>

/** Report the evidence that makes `alpha` READY: a dependency answer and a cycle. */
function becomeReady(handle: FakeHandle, { at = NOW, outputCount = 3, evidence }: {
  at?: number
  outputCount?: number | null
  evidence?: Record<string, unknown>
} = {}) {
  handle.emit({
    type: 'heartbeat',
    instanceId: handle.instanceId,
    at,
    telemetry: { pid: handle.pid },
    evidence: evidence ?? { dependenciesReachable: true },
  })
  handle.emit({
    type: 'cycle',
    instanceId: handle.instanceId,
    at,
    ok: true,
    durationMs: 7,
    outputCount,
  })
}

function startService(harness: Harness, serviceId = 'alpha', key = `k-${serviceId}`) {
  const result = harness.supervisor.request({
    serviceId,
    action: 'start',
    actor: 'tester',
    idempotencyKey: key,
  })
  assert.equal(result.ok, true, `start ${serviceId} should be accepted`)
  return result.operation
}

// =============================================================================
//  Request validation and idempotency.
// =============================================================================

describe('request — validation', () => {
  test('rejects a missing service id, action, actor or idempotency key', () => {
    const { supervisor } = makeHarness()
    assert.equal(supervisor.request({ action: 'start', actor: 'a', idempotencyKey: 'k' }).code, 'INVALID_SERVICE_ID')
    assert.equal(supervisor.request({ serviceId: 'alpha', action: 'nope', actor: 'a', idempotencyKey: 'k' }).code, 'INVALID_ACTION')
    assert.equal(supervisor.request({ serviceId: 'alpha', action: 'start', idempotencyKey: 'k' }).code, 'ACTOR_REQUIRED')
    assert.equal(supervisor.request({ serviceId: 'alpha', action: 'start', actor: 'a' }).code, 'IDEMPOTENCY_KEY_REQUIRED')
  })

  test('rejects an unknown service and an unsupported action', () => {
    const { supervisor } = makeHarness({
      registry: [serviceDefinition({ supports: ['start'] })],
    })
    assert.equal(
      supervisor.request({ serviceId: 'ghost', action: 'start', actor: 'a', idempotencyKey: 'k1' }).code,
      'UNKNOWN_SERVICE',
    )
    assert.equal(
      supervisor.request({ serviceId: 'alpha', action: 'stop', actor: 'a', idempotencyKey: 'k2' }).code,
      'ACTION_NOT_SUPPORTED',
    )
  })

  test('every advertised action is understood', () => {
    for (const action of SERVICE_ACTIONS) {
      const { supervisor } = makeHarness()
      const result = supervisor.request({
        serviceId: 'alpha',
        action,
        actor: 'a',
        idempotencyKey: `k-${action}`,
      })
      assert.equal(result.ok, true, `${action} should be accepted`)
      assert.equal(result.operation.action, action)
    }
  })

  test('a repeated idempotency key resolves to the same operation', () => {
    const { supervisor } = makeHarness()
    const first = supervisor.request({ serviceId: 'alpha', action: 'start', actor: 'a', idempotencyKey: 'same' })
    const second = supervisor.request({ serviceId: 'alpha', action: 'start', actor: 'a', idempotencyKey: 'same' })
    assert.equal(second.ok, true)
    assert.equal(second.idempotent, true)
    assert.equal(second.operation.operationId, first.operation.operationId)
  })

  test('the same key with a different action is a mismatch, not a replay', () => {
    const { supervisor } = makeHarness()
    supervisor.request({ serviceId: 'alpha', action: 'start', actor: 'a', idempotencyKey: 'same' })
    const mismatch = supervisor.request({ serviceId: 'alpha', action: 'stop', actor: 'a', idempotencyKey: 'same' })
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.code, 'IDEMPOTENCY_MISMATCH')
  })

  test('a second command for a busy service is refused with the active operation', () => {
    const { supervisor } = makeHarness()
    supervisor.request({ serviceId: 'alpha', action: 'start', actor: 'a', idempotencyKey: 'k1' })
    const conflict = supervisor.request({ serviceId: 'alpha', action: 'stop', actor: 'a', idempotencyKey: 'k2' })
    assert.equal(conflict.ok, false)
    assert.equal(conflict.code, 'OPERATION_IN_PROGRESS')
    assert.ok(conflict.operation)
  })

  test('desired state is set at request time, before anything is spawned', () => {
    const harness = makeHarness()
    const operation = startService(harness)
    assert.equal(harness.store.getService('alpha', 'system').desired, 'RUNNING')
    assert.equal(harness.store.getOperation(operation.operationId).state, 'QUEUED')
    assert.equal(harness.spawned.length, 0, 'request must not spawn; tick does')
  })
})

// =============================================================================
//  Start, readiness and timeout.
// =============================================================================

describe('start — readiness', () => {
  test('spawns a worker, stays RUNNING until readiness is proven, then succeeds', async () => {
    const harness = makeHarness()
    const operation = startService(harness)

    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1, 'tick spawns exactly one worker')
    const running = harness.store.getOperation(operation.operationId)
    assert.equal(running.state, 'RUNNING')
    assert.equal(running.phase, 'starting')

    becomeReady(harness.spawned[0])

    const done = harness.store.getOperation(operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.phase, 'done')

    const service = harness.store.getService('alpha', 'system')
    assert.equal(service.observed, 'READY')
    assert.equal(service.health, 'HEALTHY')
    assert.equal(service.generation, 1)
    assert.equal(service.operationId, null)
    assert.equal(service.startedAt, NOW)
  })

  test('does not treat a skip as a success', async () => {
    const harness = makeHarness()
    const operation = startService(harness)
    harness.supervisor.tick()

    harness.spawned[0].emit({
      type: 'cycle',
      instanceId: harness.spawned[0].instanceId,
      at: NOW,
      ok: true,
      skipped: 'outside-window',
      outputCount: null,
    })

    const service = harness.store.getService('alpha', 'system')
    assert.equal(service.lastSuccessAt, null, 'a skip never proves success')
    assert.equal(service.lastOutputCount, null)
    assert.equal(harness.store.getOperation(operation.operationId).state, 'RUNNING')
  })

  test('fails a worker that never proves readiness, and kills it', () => {
    const harness = makeHarness({ supervisor: { readinessTimeoutMs: 10_000 } })
    const operation = startService(harness)
    harness.supervisor.tick()

    harness.advance(20_000)
    harness.supervisor.tick()

    const failed = harness.store.getOperation(operation.operationId)
    assert.equal(failed.state, 'FAILED')
    assert.match(String(failed.error), /READINESS_TIMEOUT/)
    assert.deepEqual(harness.spawned[0].kills, ['SIGKILL'])
    assert.equal(harness.store.getService('alpha', 'system').observed, 'FAILED')
  })

  test('a start on an already-ready service is a no-op success', async () => {
    const harness = makeHarness()
    const first = startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])
    assert.equal(harness.store.getOperation(first.operationId).state, 'SUCCEEDED')

    const second = startService(harness, 'alpha', 'k2')
    harness.supervisor.tick()
    const done = harness.store.getOperation(second.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.alreadyRunning, true)
    assert.equal(harness.spawned.length, 1, 'no second worker is spawned')
  })

  test('an untouched registry reads as no services', () => {
    const harness = makeHarness()
    const view = harness.supervisor.tick()
    assert.equal(view.services.length, 0, 'a service is only known once it is touched')
  })

  test('a requested RUNNING service reads as drift until a process proves it', () => {
    const harness = makeHarness()
    startService(harness)
    const alpha = harness.supervisor.snapshot().services.find(service => service.serviceId === 'alpha')
    assert.ok(alpha)
    assert.equal(alpha.desired, 'RUNNING')
    assert.equal(alpha.observed, 'UNKNOWN', 'no tick has spawned anything yet')
    assert.equal(alpha.drift, true, 'RUNNING desired with no proof of life is drift')
  })
})

// =============================================================================
//  Stop and restart.
// =============================================================================

describe('stop — drain then escalate', () => {
  test('drains via IPC and completes once the worker exits', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const stop = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'stop',
      actor: 'tester',
      idempotencyKey: 'stop-1',
    })
    assert.equal(stop.ok, true)

    harness.supervisor.tick()
    assert.ok(
      harness.spawned[0].sent.some(message => message.type === 'shutdown'),
      'a graceful stop sends shutdown, not a signal',
    )
    assert.deepEqual(harness.spawned[0].kills, [], 'no kill before the grace period')

    await flush()
    const done = harness.store.getOperation(stop.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')

    const service = harness.store.getService('alpha', 'system')
    assert.equal(service.observed, 'STOPPED')
    assert.equal(service.desired, 'STOPPED')
    assert.equal(service.lease, null, 'the lease is released on stop')
  })

  test('escalates to SIGKILL when the worker ignores the drain', async () => {
    const harness = makeHarness({
      behaviour: () => {}, // stubborn: ignores shutdown
      supervisor: { stopGraceMs: 5_000 },
    })
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const stop = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'stop',
      actor: 'tester',
      idempotencyKey: 'stop-1',
    })
    harness.supervisor.tick()
    assert.deepEqual(harness.spawned[0].kills, [])

    harness.advance(10_000)
    harness.supervisor.tick()
    await flush()

    assert.ok(harness.spawned[0].kills.includes('SIGKILL'), 'grace expiry forces termination')
    const done = harness.store.getOperation(stop.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.forced, true)
  })

  test('stopping a service that is not running completes immediately', () => {
    const harness = makeHarness()
    const stop = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'stop',
      actor: 'tester',
      idempotencyKey: 'stop-idle',
    })
    harness.supervisor.tick()
    const done = harness.store.getOperation(stop.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.alreadyStopped, true)
  })
})

describe('restart / reset', () => {
  test('a restart drains the old generation and starts a new one', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])
    const firstInstance = harness.store.getService('alpha', 'system').serviceInstanceId

    const restart = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'restart',
      actor: 'tester',
      idempotencyKey: 'restart-1',
    })
    harness.supervisor.tick()
    await flush()
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 2, 'a new worker replaces the old one')

    becomeReady(harness.spawned[1])
    const done = harness.store.getOperation(restart.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')

    const service = harness.store.getService('alpha', 'system')
    assert.equal(service.generation, 2)
    assert.notEqual(service.serviceInstanceId, firstInstance)
    assert.equal(done.result.previousInstanceId, firstInstance)
  })

  test('a reset records that ephemeral state was cleared', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const reset = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'reset',
      actor: 'tester',
      idempotencyKey: 'reset-1',
    })
    harness.supervisor.tick()
    await flush()
    harness.supervisor.tick()
    becomeReady(harness.spawned[1])

    const done = harness.store.getOperation(reset.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.reset, true)
    assert.equal(harness.spawned[1].input.reset, true, 'the worker is told to reset')
  })
})

// =============================================================================
//  Crash recovery and backoff.
// =============================================================================

describe('unexpected exit', () => {
  test('marks the service FAILED and schedules a bounded-backoff restart', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    harness.spawned[0].exit({ code: 1, signal: null })
    await flush()

    let service = harness.store.getService('alpha', 'system')
    assert.equal(service.observed, 'FAILED')
    assert.equal(service.health, 'UNHEALTHY')
    assert.equal(service.restartCount, 1)
    assert.equal(service.nextRestartAt, NOW + restartBackoffMs(1))

    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1, 'the backoff has not elapsed')

    harness.advance(1_000)
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1, 'still inside the backoff window')

    harness.advance(2_000)
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 2, 'the restart fires after the backoff')

    service = harness.store.getService('alpha', 'system')
    assert.equal(service.generation, 2)
    assert.equal(service.nextRestartAt, null)

    becomeReady(harness.spawned[1])
    assert.equal(harness.store.getService('alpha', 'system').observed, 'READY')
    assert.ok(
      harness.store.snapshot().audit.some(row => row.action === 'crash-restart'),
      'the restart is audited',
    )
  })

  test('restartBackoffMs is bounded', () => {
    assert.equal(restartBackoffMs(1), 2_000)
    assert.equal(restartBackoffMs(2), 4_000)
    assert.equal(restartBackoffMs(99), 60_000)
  })
})

// =============================================================================
//  Dependencies, planned services and unsupervised hosts.
// =============================================================================

describe('dependency gate', () => {
  test('refuses to start when a required dependency is not ready', () => {
    const harness = makeHarness()
    const result = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    const failed = harness.store.getOperation(result.operation.operationId)
    assert.equal(failed.state, 'FAILED')
    assert.match(String(failed.error), /DEPENDENCY_NOT_READY/)
    assert.equal(harness.spawned.length, 0, 'nothing is spawned behind a blocked dependency')
  })

  test('waits, rather than fails, while a dependency is still starting', () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick() // alpha is RUNNING but not yet READY

    const beta = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    const waiting = harness.store.getOperation(beta.operation.operationId)
    assert.equal(waiting.state, 'RUNNING')
    assert.equal(waiting.phase, 'awaiting-dependency')
    assert.deepEqual(waiting.result.waitingFor, ['alpha'])
    assert.equal(harness.spawned.length, 1, 'beta is not spawned yet')

    becomeReady(harness.spawned[0])
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 2, 'beta starts once alpha is ready')
  })

  // Regression: after a supervisor restart (or a batch cold start) every service
  // is re-queued in one tick, so a dependency that crashed earlier is observed
  // FAILED while its own start is still queued. That is a *wait*, not a block —
  // otherwise dependents would fail permanently on every recovery, which is
  // exactly when the ordering is arbitrary.
  test('waits while a required dependency is FAILED but still desired RUNNING', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    harness.spawned[0].exit({ code: 1, signal: null })
    await flush()
    assert.equal(harness.store.getService('alpha', 'system').observed, 'FAILED')
    assert.equal(harness.store.getService('alpha', 'system').desired, 'RUNNING')

    const beta = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    const waiting = harness.store.getOperation(beta.operation.operationId)
    assert.equal(waiting.state, 'RUNNING', 'a recovering dependency is not a hard block')
    assert.equal(waiting.phase, 'awaiting-dependency')
    assert.deepEqual(waiting.result.waitingFor, ['alpha'])
    assert.equal(harness.spawned.length, 1)

    // The dependency comes back (bounded backoff), then beta is released.
    harness.advance(5_000)
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 2, 'alpha restarted after the backoff')
    becomeReady(harness.spawned[1])
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 3, 'beta starts once the dependency is ready')

    // A start is not done when the worker is spawned: beta must prove readiness.
    becomeReady(harness.spawned[2])
    harness.supervisor.tick()
    assert.equal(harness.store.getOperation(beta.operation.operationId).state, 'SUCCEEDED')
  })

  // Regression: a dependency the supervisor cannot start (hosted inside Nitro,
  // `supervised: false`) would sit at UNKNOWN forever, so gating on it would
  // permanently block the signal producer.
  test('ignores a dependency that another process hosts', () => {
    const harness = makeHarness({
      registry: [
        serviceDefinition({ id: 'alpha', supervised: false, supports: ['probe'] }),
        BETA,
      ],
    })
    const beta = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1, 'beta is not gated on an externally hosted dependency')
    assert.equal(
      harness.store.getService('alpha', 'system')?.observed ?? 'UNKNOWN',
      'UNKNOWN',
      'the external dependency really is unobserved here',
    )
    becomeReady(harness.spawned[0])
    harness.supervisor.tick()
    assert.equal(harness.store.getOperation(beta.operation.operationId).state, 'SUCCEEDED')
  })

  test('still refuses when the dependency is stopped on purpose', () => {

    const harness = makeHarness()
    // Nobody intends to run alpha: desired is STOPPED and it never started.
    const beta = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    const failed = harness.store.getOperation(beta.operation.operationId)
    assert.equal(failed.state, 'FAILED')
    assert.match(String(failed.error), /DEPENDENCY_NOT_READY/)
    assert.equal(harness.spawned.length, 0)
  })
})

describe('capability gate', () => {
  test('a planned service is read-only', () => {
    const harness = makeHarness({ registry: SERVICES })
    const start = harness.supervisor.request({
      serviceId: 'market-feeds',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'p1',
    })
    assert.equal(start.ok, false)
    assert.equal(start.code, 'SERVICE_NOT_IMPLEMENTED')

    const probe = harness.supervisor.request({
      serviceId: 'market-feeds',
      action: 'probe',
      actor: 'tester',
      idempotencyKey: 'p2',
    })
    assert.equal(probe.ok, true, 'a planned service may still be probed')
  })

  test('a service hosted by another process may only be probed', () => {
    const harness = makeHarness({ registry: SERVICES })
    for (const serviceId of ['market-plane', 'ai-agent', 'ai-review', 'bot-supervisor']) {
      const start = harness.supervisor.request({
        serviceId,
        action: 'start',
        actor: 'tester',
        idempotencyKey: `${serviceId}-start`,
      })
      assert.equal(start.code, 'SERVICE_NOT_SUPERVISED', `${serviceId} must not be spawned here`)
      assert.equal(harness.spawned.length, 0)
    }
    const probe = harness.supervisor.request({
      serviceId: 'market-plane',
      action: 'probe',
      actor: 'tester',
      idempotencyKey: 'mp-probe',
    })
    assert.equal(probe.ok, true)
  })
})

// =============================================================================
//  Probe, run-once and operation timeout.
// =============================================================================

describe('probe', () => {
  test('answers with a readiness verdict without spawning anything', () => {
    const harness = makeHarness()
    const probe = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'probe',
      actor: 'tester',
      idempotencyKey: 'probe-1',
    })
    harness.supervisor.tick()
    const done = harness.store.getOperation(probe.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.probe.observed, 'STOPPED')
    assert.equal(harness.spawned.length, 0)
  })
})

describe('run-once', () => {
  test('is dispatched to the running worker when one exists', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const once = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'run-once',
      actor: 'tester',
      idempotencyKey: 'once-1',
    })
    harness.supervisor.tick()
    const dispatched = harness.spawned[0].sent.find(message => message.type === 'run-once')
    assert.ok(dispatched, 'the running worker receives the request')
    assert.equal(dispatched?.operationId, once.operation.operationId)
    assert.equal(harness.spawned.length, 1, 'no extra process is forked')

    harness.spawned[0].emit({
      type: 'operation-result',
      instanceId: harness.spawned[0].instanceId,
      operationId: once.operation.operationId,
      ok: true,
      result: { outputCount: 4 },
    })
    const done = harness.store.getOperation(once.operation.operationId)
    assert.equal(done.state, 'SUCCEEDED')
    assert.equal(done.result.workerResult.outputCount, 4)
  })

  test('spawns a one-shot worker when the service is not running', () => {
    const harness = makeHarness()
    const once = harness.supervisor.request({
      serviceId: 'alpha',
      action: 'run-once',
      actor: 'tester',
      idempotencyKey: 'once-2',
    })
    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1)
    assert.equal(harness.spawned[0].input.mode, 'once')
    assert.equal(harness.spawned[0].input.operationId, once.operation.operationId)

    harness.spawned[0].emit({
      type: 'operation-result',
      operationId: once.operation.operationId,
      ok: false,
      error: 'cycle reported failure',
    })
    const done = harness.store.getOperation(once.operation.operationId)
    assert.equal(done.state, 'FAILED')
    assert.match(String(done.error), /RUN_ONCE_FAILED/)
  })
})

describe('operation timeout', () => {
  test('an operation that never reaches a terminal state is marked UNCONFIRMED', () => {
    const harness = makeHarness({ supervisor: { operationTimeoutMs: 5_000 } })
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()

    const beta = harness.supervisor.request({
      serviceId: 'beta',
      action: 'start',
      actor: 'tester',
      idempotencyKey: 'beta-1',
    })
    harness.supervisor.tick()
    assert.equal(harness.store.getOperation(beta.operation.operationId).phase, 'awaiting-dependency')

    harness.advance(10_000)
    harness.supervisor.tick()

    const expired = harness.store.getOperation(beta.operation.operationId)
    assert.equal(expired.state, 'UNCONFIRMED')
    assert.equal(expired.result.code, 'OPERATION_TIMEOUT')
    assert.equal(harness.store.getService('beta', 'system').operationId, null)
  })
})

// =============================================================================
//  Snapshot, adoption and drain.
// =============================================================================

describe('snapshot', () => {
  test('projects the operator view with drift and audit', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const view = harness.supervisor.tick()
    assert.equal(view.schemaVersion, SUPERVISOR_SCHEMA_VERSION)
    const alpha = view.services.find(service => service.serviceId === 'alpha')
    assert.ok(alpha)
    assert.equal(alpha.observed, 'READY')
    assert.equal(alpha.drift, false)
    assert.equal(alpha.workload.lastOutputCount, 3)
    assert.ok(Array.isArray(alpha.readiness))
    assert.ok(view.audit.some(row => row.action === 'worker-spawned'))
    assert.ok(view.operations.some(operation => operation.state === 'SUCCEEDED'))
  })
})

describe('adopt', () => {
  test('re-attaches to a process that outlived a supervisor restart', () => {
    const store = createSupervisorStore({ file: null, now: () => NOW })
    const record = store.ensureService('alpha', 'system')
    Object.assign(record, {
      desired: 'RUNNING',
      observed: 'READY',
      health: 'HEALTHY',
      pid: 777,
      serviceInstanceId: 'si_old',
      startedAt: NOW - 1_000,
      lastHeartbeatAt: NOW,
      evidence: { dependenciesReachable: true, lastSuccessAt: NOW - 1_000, lastOutputCount: 5 },
    })
    store.putService(record)

    const workers = {
      spawn() { throw new Error('no spawn expected') },
      isAlive: (pid: number) => pid === 777,
      adopt: (pid: number) => ({ pid, instanceId: 'si_old', alive: true, send: () => {}, kill: () => {}, onMessage: () => {}, onExit: () => {} }),
      kill: () => {},
    }
    const supervisor = createSupervisor({
      store,
      registry: DEFAULT_REGISTRY,
      workers,
      now: () => NOW,
      supervisorId: 'restarted:1',
    })

    assert.equal(supervisor.adopt(), 1)
    assert.ok(supervisor.processes.has(serviceKey('alpha', 'system')))

    const view = supervisor.tick()
    const alpha = view.services.find(service => service.serviceId === 'alpha')
    assert.equal(alpha.observed, 'READY', 'the adopted process keeps its readiness')
    assert.equal(alpha.drift, false)
  })

  test('drain reports what it stopped', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const result = await harness.supervisor.drain({ graceMs: 1_000, pollMs: 1 })
    assert.equal(result.drained, 1)
    assert.deepEqual(result.killed, [])
    assert.equal(harness.spawned[0].sent.some(message => message.type === 'shutdown'), true)
  })
})

// =============================================================================
//  Store: durability, leases, idempotency and audit bound.
// =============================================================================

describe('supervisor store', () => {
  test('in-memory and file-backed stores behave identically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-supervisor-'))
    const file = join(dir, 'supervisor.json')
    try {
      const store = createSupervisorStore({ file, now: () => NOW })
      store.ensureService('alpha', 'system')
      store.putOperation({
        operationId: 'op_1',
        serviceId: 'alpha',
        scopeKey: 'system',
        action: 'start',
        state: 'QUEUED',
        requestedAt: NOW,
      })

      const reloaded = createSupervisorStore({ file, now: () => NOW })
      assert.equal(reloaded.getService('alpha', 'system').serviceId, 'alpha')
      assert.equal(reloaded.getOperation('op_1').action, 'start')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a corrupt file fails soft to empty state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-supervisor-'))
    const file = join(dir, 'supervisor.json')
    try {
      writeFileSync(file, '{ not json')
      const state = readStateFile(file)
      assert.equal(state.schemaVersion, STORE_SCHEMA_VERSION)
      assert.deepEqual(state.services, {})
      assert.deepEqual(state.audit, [])
      assert.deepEqual(state, emptyState())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('idempotency keys survive a reload', () => {
    const store = createSupervisorStore({ file: null, now: () => NOW })
    store.putOperation({ operationId: 'op_1', serviceId: 'alpha', scopeKey: 'system', action: 'start', state: 'SUCCEEDED', requestedAt: NOW })
    store.rememberIdempotencyKey('key-1', 'op_1')
    assert.equal(store.findOperationByIdempotencyKey('key-1').operationId, 'op_1')
    assert.equal(store.findOperationByIdempotencyKey('missing'), null)
  })

  test('a lease blocks a second owner until it expires, then is reclaimable', () => {
    let clock = NOW
    const store = createSupervisorStore({ file: null, now: () => clock })
    assert.equal(store.claimLease({ serviceId: 'alpha', owner: 'A', serviceInstanceId: 'si_a', ttlMs: 30_000, now: clock }).ok, true)

    const held = store.claimLease({ serviceId: 'alpha', owner: 'B', serviceInstanceId: 'si_b', ttlMs: 30_000, now: clock })
    assert.equal(held.ok, false)
    assert.equal(held.code, 'LEASE_HELD')
    assert.equal(held.lease.owner, 'A')

    clock += 31_000
    assert.equal(store.expireLeases(clock), 1)
    assert.equal(store.claimLease({ serviceId: 'alpha', owner: 'B', serviceInstanceId: 'si_b', ttlMs: 30_000, now: clock }).ok, true)
  })

  test('a start behind another owner lease fails LEASE_HELD', () => {
    const harness = makeHarness()
    harness.store.claimLease({
      serviceId: 'alpha',
      owner: 'another-supervisor',
      serviceInstanceId: 'si_other',
      ttlMs: 60_000,
      now: NOW,
    })
    const operation = startService(harness)
    harness.supervisor.tick()
    const failed = harness.store.getOperation(operation.operationId)
    assert.equal(failed.state, 'FAILED')
    assert.match(String(failed.error), /LEASE_HELD/)
    assert.equal(harness.spawned.length, 0)
  })

  // Regression: the lease is what stops `services/run.mjs` from running a second
  // copy, so it must be renewed while the instance lives. Claiming only at spawn
  // released a healthy service after one TTL and the guard then let duplicates
  // through — the exact overlap §17.15-O4 forbids.
  test('the lease is renewed while the instance is alive, so the guard keeps blocking', () => {
    const harness = makeHarness()
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])

    const claimed = harness.store.getService('alpha', 'system')
    assert.equal(claimed.lease.owner, 'test-host:1')
    assert.equal(claimed.lease.expiresAt, NOW + 30_000)

    // Two ticks well past the original TTL: without renewal the lease would have
    // expired here and the legacy orchestrator would see nothing to skip.
    harness.advance(20_000)
    harness.supervisor.tick()
    harness.advance(30_000)
    harness.supervisor.tick()

    const live = harness.store.getService('alpha', 'system')
    assert.equal(live.observed, 'READY')
    assert.ok(live.lease, 'a running instance keeps its lease')
    assert.equal(live.lease.owner, 'test-host:1')
    assert.ok(Number(live.lease.expiresAt) > harness.now(), 'the lease is still fresh')

    const blocked = overlappingSupervisorLeases({
      store: harness.store,
      serviceIds: ['alpha'],
      now: harness.now(),
    })
    assert.deepEqual(blocked.map(entry => entry.serviceId), ['alpha'])
    assert.equal(blocked[0].owner, 'test-host:1')
  })

  test('the audit trail is append-only and bounded', () => {
    const store = createSupervisorStore({ file: null, now: () => NOW, maxAudit: 3 })
    for (let index = 0; index < 6; index += 1) store.appendAudit({ action: `row-${index}` })
    assert.equal(store.state.audit.length, 3)
    assert.deepEqual(store.state.audit.map(row => row.action), ['row-3', 'row-4', 'row-5'])
    assert.ok(MAX_AUDIT_ROWS >= 3)
  })

  test('the audit trail is bounded by MAX_AUDIT_ROWS by default', () => {
    const store = createSupervisorStore({ file: null, now: () => NOW })
    assert.ok(MAX_AUDIT_ROWS >= 100)
    for (let index = 0; index < MAX_AUDIT_ROWS + 10; index += 1) store.appendAudit({ action: 'x' })
    assert.equal(store.state.audit.length, MAX_AUDIT_ROWS)
  })

  test('activeOnly lists only moving operations, oldest first', () => {
    const store = createSupervisorStore({ file: null, now: () => NOW })
    store.putOperation({ operationId: 'op_b', serviceId: 'a', scopeKey: 'system', action: 'start', state: 'RUNNING', requestedAt: NOW + 2 })
    store.putOperation({ operationId: 'op_a', serviceId: 'a', scopeKey: 'system', action: 'start', state: 'QUEUED', requestedAt: NOW + 1 })
    store.putOperation({ operationId: 'op_c', serviceId: 'a', scopeKey: 'system', action: 'start', state: 'SUCCEEDED', requestedAt: NOW })
    assert.deepEqual(store.listOperations({ activeOnly: true }).map(operation => operation.operationId), ['op_a', 'op_b'])
    assert.equal(store.activeOperationFor('a', 'system').operationId, 'op_a', 'the oldest moving operation wins')
    assert.equal(isActiveOperation(store.getOperation('op_c')), false)
  })
})

// =============================================================================
//  Command inbox (V4.2 §17.7, option b).
//
//  The Operations API cannot write service state, so it enqueues commands and
//  the supervisor consumes them. Delivery is at-least-once; these tests pin that
//  it is also safe (idempotent), honest (rejections are audited) and
//  non-destructive (a busy service defers, it does not drop the command).
// =============================================================================

function withCommandDir(fn: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'tm-cmd-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function commandFor(overrides: Record<string, unknown> = {}) {
  return normaliseCommand({
    operationId: `op_${Math.random().toString(16).slice(2)}`,
    serviceId: 'alpha',
    action: 'start',
    actor: 'tester',
    idempotencyKey: 'cmd-key',
    now: NOW,
    ...overrides,
  })
}

describe('command inbox — shape', () => {
  test('a normalised command is valid and carries its deadline', () => {
    const command = commandFor()
    assert.equal(validateCommand(command).ok, true)
    assert.equal(command.scopeKey, 'system')
    assert.equal(command.deadlineAt, NOW + 300_000)
  })

  test('validation rejects a missing field or an unsafe id', () => {
    assert.equal(validateCommand({}).ok, false)
    const unsafe = commandFor({ operationId: '../escape' })
    assert.equal(validateCommand(unsafe).ok, false)
    assert.match(validateCommand(unsafe).errors.join(' '), /unsafe/)
  })

  test('enqueue is atomic and idempotent on the operationId', () => {
    withCommandDir((dir) => {
      const command = commandFor()
      enqueueCommand(command, { dir })
      enqueueCommand(command, { dir })
      const { commands, invalid } = listCommands({ dir, now: NOW })
      assert.equal(invalid.length, 0)
      assert.equal(commands.length, 1, 'one file per command, overwritten safely')
    })
  })

  test('a corrupt file is reported, not thrown', () => {
    withCommandDir((dir) => {
      writeFileSync(join(dir, 'bad.json'), '{ not json')
      enqueueCommand(commandFor(), { dir })
      const { commands, invalid } = listCommands({ dir, now: NOW })
      assert.equal(commands.length, 1, 'the good command is still readable')
      assert.equal(invalid.length, 1)
      assert.equal(invalid[0].file, 'bad.json')
    })
  })

  test('expired commands are separated from live ones', () => {
    withCommandDir((dir) => {
      enqueueCommand(commandFor({ operationId: 'op_old', ttlMs: 1_000, now: NOW }), { dir })
      const { commands, expired } = listCommands({ dir, now: NOW + 5_000 })
      assert.equal(commands.length, 0)
      assert.equal(expired.length, 1)
      assert.equal(expired[0].operationId, 'op_old')
    })
  })

  test('pending commands project as QUEUED operations', () => {
    withCommandDir((dir) => {
      enqueueCommand(commandFor({ operationId: 'op_pending', reason: 'pilot' }), { dir })
      const pending = pendingOperations({ dir, now: NOW })
      assert.equal(pending.length, 1)
      assert.equal(pending[0].operationId, 'op_pending')
      assert.equal(pending[0].state, 'QUEUED')
      assert.equal(pending[0].pending, true)
      assert.deepEqual(pending[0].result, { reason: 'pilot' })
    })
  })
})

describe('supervisor consumes the inbox', () => {
  test('performs an enqueued start and uses the caller-minted operationId', () => {
    const harness = makeHarness()
    enqueueCommand(commandFor({ operationId: 'op_api_1', serviceId: 'alpha' }), { dir: harness.commandsDir })

    harness.supervisor.tick()

    const operation = harness.store.getOperation('op_api_1')
    assert.ok(operation, 'the API operationId is the one the supervisor used')
    assert.equal(operation.state, 'RUNNING')
    assert.equal(harness.spawned.length, 1, 'the command actually started the worker')
    assert.equal(listCommands({ dir: harness.commandsDir, now: NOW }).commands.length, 0, 'the command is consumed')

    becomeReady(harness.spawned[0])
    assert.equal(harness.store.getOperation('op_api_1').state, 'SUCCEEDED')
  })

  test('replaying the same command is idempotent, never a second operation', () => {
    const harness = makeHarness()
    const command = commandFor({ operationId: 'op_replay', serviceId: 'alpha' })
    enqueueCommand(command, { dir: harness.commandsDir })
    harness.supervisor.tick()

    // The supervisor crashed before deleting the file and re-reads it.
    enqueueCommand(command, { dir: harness.commandsDir })
    const result = harness.supervisor.consumeInbox()

    const operations = harness.store.listOperations().filter(operation => operation.serviceId === 'alpha')
    assert.equal(operations.length, 1, 'no duplicate operation')
    assert.equal(harness.spawned.length, 1, 'no duplicate worker')
    assert.deepEqual(result.performed, ['op_replay'])
  })

  test('a busy service defers the command instead of dropping it', () => {
    const harness = makeHarness()
    // alpha starts (not yet ready) so beta's start parks on its dependency,
    // leaving an ACTIVE operation on beta.
    startService(harness, 'alpha', 'k1')
    harness.supervisor.tick()
    harness.supervisor.request({ serviceId: 'beta', action: 'start', actor: 'tester', idempotencyKey: 'busy' })
    harness.supervisor.tick()
    assert.equal(harness.store.activeOperationFor('beta', 'system')?.phase, 'awaiting-dependency')

    enqueueCommand(commandFor({ operationId: 'op_busy', serviceId: 'beta', action: 'stop' }), { dir: harness.commandsDir })
    const result = harness.supervisor.consumeInbox()

    assert.deepEqual(result.deferred, ['op_busy'])
    assert.equal(result.rejected.length, 0)
    assert.equal(listCommands({ dir: harness.commandsDir, now: NOW }).commands.length, 1, 'the command survives for a later tick')
  })

  test('an unknown service is rejected and audited, never silently', () => {
    const harness = makeHarness()
    enqueueCommand(commandFor({ operationId: 'op_ghost', serviceId: 'ghost' }), { dir: harness.commandsDir })

    const result = harness.supervisor.consumeInbox()
    assert.deepEqual(result.rejected, [{ operationId: 'op_ghost', code: 'UNKNOWN_SERVICE' }])
    assert.equal(listCommands({ dir: harness.commandsDir, now: NOW }).commands.length, 0, 'a permanent failure is not retried forever')
    assert.ok(
      harness.store.snapshot().audit.some(row => row.action === 'command-rejected' && row.operationId === 'op_ghost'),
      'the rejection is audited',
    )
  })

  test('an expired command is dropped and audited', () => {
    const harness = makeHarness()
    enqueueCommand(commandFor({ operationId: 'op_late', ttlMs: 1_000, now: NOW }), { dir: harness.commandsDir })

    // The supervisor only looks at the inbox after the command's deadline.
    harness.advance(2_000)
    const result = harness.supervisor.consumeInbox()
    assert.deepEqual(result.expired, ['op_late'])
    assert.equal(harness.spawned.length, 0)
    assert.ok(harness.store.snapshot().audit.some(row => row.action === 'command-expired'))
  })

  test('an unparseable command file cannot wedge the queue', () => {
    const harness = makeHarness()
    writeFileSync(join(harness.commandsDir, 'bad.json'), 'not json at all')
    enqueueCommand(commandFor({ operationId: 'op_ok' }), { dir: harness.commandsDir })

    const result = harness.supervisor.consumeInbox()
    assert.deepEqual(result.invalid, ['bad.json'])
    assert.deepEqual(result.performed, ['op_ok'], 'the good command is still performed')
    assert.equal(listCommands({ dir: harness.commandsDir, now: NOW }).invalid.length, 0, 'the bad file was removed')
  })

  test('status does not consume the inbox', () => {
    const harness = makeHarness()
    enqueueCommand(commandFor({ operationId: 'op_status' }), { dir: harness.commandsDir })
    harness.supervisor.tick({ consumeCommands: false })
    assert.equal(harness.spawned.length, 0)
    assert.equal(listCommands({ dir: harness.commandsDir, now: NOW }).commands.length, 1)
    assert.equal(harness.store.getOperation('op_status'), null)
  })
})

// =============================================================================
//  Supervisor restart — operator intent must survive the control plane.
//
//  Found by `npm run drills`: a graceful supervisor shutdown left every worker
//  drained but desired=RUNNING on disk, and the next supervisor process did
//  nothing with it. Every service stayed down until someone pressed Start.
// =============================================================================

describe('supervisor restart — recovery and drain', () => {
  test('drain stops the workers but keeps operator intent', async () => {
    const harness = makeHarness()
    startService(harness, 'alpha')
    harness.supervisor.tick()
    becomeReady(harness.spawned[0])
    harness.supervisor.tick()
    assert.equal(harness.store.getService('alpha', 'system').observed, 'READY')

    const result = await harness.supervisor.drain()

    assert.equal(result.drained, 1)
    const record = harness.store.getService('alpha', 'system')
    assert.equal(record.pid, null, 'a drained service has no pid')
    assert.equal(record.observed, 'STOPPED')
    assert.equal(record.desired, 'RUNNING', 'shutdown is not an operator Stop')
    assert.equal(record.stopping, false, 'a stale stopping flag would pin the next supervisor')
    assert.equal(record.serviceInstanceId, null)
  })

  test('reconcileDesired queues one normal start per desired-RUNNING service', () => {
    const harness = makeHarness()
    harness.store.putService({
      ...emptyServiceRecord('alpha', 'system'),
      desired: 'RUNNING',
      observed: 'STOPPED',
      generation: 3,
    })

    const queued = harness.supervisor.reconcileDesired()
    assert.equal(queued.length, 1)

    const operation = harness.store.getOperation(queued[0])
    assert.equal(operation.action, 'start', 'recovery reuses the normal start path, with all its gates')
    assert.equal(operation.requestedBy, 'supervisor-recovery')
    assert.equal(operation.state, 'QUEUED', 'a tick is required to act on it')

    harness.supervisor.tick()
    assert.equal(harness.spawned.length, 1, 'recovery actually started the worker')
  })

  test('reconcileDesired ignores STOPPED intent, live processes and active operations', () => {
    const harness = makeHarness()

    harness.store.putService({
      ...emptyServiceRecord('alpha', 'system'),
      desired: 'STOPPED',
      observed: 'STOPPED',
    })
    assert.deepEqual(harness.supervisor.reconcileDesired(), [], 'a service the operator stopped stays stopped')

    startService(harness, 'alpha')
    harness.supervisor.tick()
    assert.deepEqual(harness.supervisor.reconcileDesired(), [], 'a live process is not restarted')
    assert.equal(harness.spawned.length, 1)
  })

  test('reconcileDesired skips a service another process still hosts', () => {
    const harness = makeHarness({
      registry: [serviceDefinition({ supervised: false, supports: ['probe'] })],
    })
    harness.store.putService({
      ...emptyServiceRecord('alpha', 'system'),
      desired: 'RUNNING',
      observed: 'STOPPED',
    })
    assert.deepEqual(harness.supervisor.reconcileDesired(), [])
  })

  test('a record left mid-drain is not pinned in STOPPING forever', () => {
    const harness = makeHarness()
    // Simulates a supervisor killed between writing `stopping` and draining.
    harness.store.putService({
      ...emptyServiceRecord('alpha', 'system'),
      desired: 'STOPPED',
      observed: 'STOPPING',
      stopping: true,
      operationId: null,
    })

    harness.supervisor.adopt()
    harness.supervisor.tick()

    assert.equal(harness.store.getService('alpha', 'system').stopping, false)
  })

  test('a restarting supervisor restores RUNNING from the state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-supervisor-restart-'))
    const file = join(dir, 'supervisor.json')
    try {
      const harness = makeHarness()
      // Supervisor #1 writes to a real file, so #2 can only know what is on disk.
      const storeA = createSupervisorStore({ file, now: harness.now })
      const supervisorA = createSupervisor({
        store: storeA,
        registry: DEFAULT_REGISTRY,
        workers: harness.workers,
        now: harness.now,
        host: 'test-host',
        supervisorId: 'test-host:1',
        commandsDir: harness.commandsDir,
      })
      supervisorA.request({ serviceId: 'alpha', action: 'start', actor: 'tester', idempotencyKey: 'k1' })
      supervisorA.tick()
      becomeReady(harness.spawned[0])
      supervisorA.tick()
      assert.equal(storeA.getService('alpha', 'system').observed, 'READY')
      await supervisorA.drain()

      // Supervisor #2 starts from the file alone.
      const storeB = createSupervisorStore({ file, now: harness.now })
      const drained = storeB.getService('alpha', 'system')
      assert.equal(drained.desired, 'RUNNING')
      assert.equal(drained.observed, 'STOPPED')
      assert.equal(drained.pid, null)

      const supervisorB = createSupervisor({
        store: storeB,
        registry: DEFAULT_REGISTRY,
        workers: harness.workers,
        now: harness.now,
        host: 'test-host',
        supervisorId: 'test-host:2',
        commandsDir: harness.commandsDir,
      })
      supervisorB.adopt()
      assert.equal(supervisorB.reconcileDesired().length, 1)

      supervisorB.tick()
      assert.equal(harness.spawned.length, 2, 'a second worker was spawned')
      becomeReady(harness.spawned[1])
      supervisorB.tick()

      const restored = storeB.getService('alpha', 'system')
      assert.equal(restored.observed, 'READY')
      assert.equal(restored.restartCount, 0, 'recovery is not a crash restart')
      assert.ok(
        supervisorB.snapshot().audit.some(row => row.actor === 'supervisor-recovery' && row.action === 'operation-requested'),
        'recovery is audited',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
