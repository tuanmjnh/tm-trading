import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { OPERATIONS_VIEW_SCHEMA_VERSION, buildOperationsView } from '../services/operationsView.mjs'
import { SERVICES } from '../services/registry.mjs'

// =============================================================================
//  V4.2 §17.9 — the Operations read model.
//
//  The screen must be able to render before a supervisor has ever run, so the
//  merge of registry + snapshot is the load-bearing rule under test:
//
//    1. every registry entry appears, even with no state  ("never started" must
//       not look like "stopped on purpose");
//    2. a snapshot carries proof (desired/observed/readiness/telemetry/audit);
//    3. nothing the supervisor tracks is silently dropped;
//    4. the summary can never disagree with the rows under it.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function record(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'news',
    scopeKey: 'system',
    desired: 'RUNNING',
    observed: 'READY',
    health: 'HEALTHY',
    generation: 3,
    pid: 4242,
    host: 'host-a',
    startedAt: NOW - 60_000,
    lastHeartbeatAt: NOW - 5_000,
    lastSuccessAt: NOW - 30_000,
    lastErrorAt: null,
    lastError: null,
    restartCount: 0,
    nextRestartAt: null,
    operationId: null,
    readiness: [{ id: 'process-alive', required: true, passed: true, detail: 'process is alive' }],
    telemetry: { pid: 4242 },
    lastDurationMs: 812,
    lastOutputCount: 7,
    lease: { owner: 'host-a:1', expiresAt: NOW + 30_000 },
    ...overrides,
  }
}

describe('buildOperationsView — registry only', () => {
  test('shows every registered service as never-started, never as an error', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW })
    assert.equal(view.schemaVersion, OPERATIONS_VIEW_SCHEMA_VERSION)
    assert.equal(view.services.length, SERVICES.length)
    assert.equal(view.operations.length, 0)
    assert.ok(view.services.every(service => service.registered === false))
    assert.ok(view.services.every(service => service.observed === 'UNKNOWN'))
    assert.ok(view.services.every(service => service.health === 'UNKNOWN'))
    assert.ok(view.services.every(service => service.drift === false), 'no intent expressed, no drift')
    assert.ok(view.services.every(service => service.heartbeatAgeMs === null))
  })

  test('carries the static registry facts the table and drawer need', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.ok(news)
    assert.equal(news.category, 'intelligence')
    assert.equal(news.scope, 'system')
    assert.equal(news.processGroup, 'intelligence')
    assert.equal(news.executionMode, 'periodic')
    assert.ok(news.supports.includes('start'))
    assert.ok(Array.isArray(news.dependencies))
    assert.equal(news.planned, false)
    assert.equal(news.supervised, true)
  })

  test('marks planned and unsupervised entries honestly', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW })
    const planned = view.services.filter(service => service.planned).map(service => service.serviceId)
    assert.deepEqual(planned.sort(), ['demo-runner', 'market-feeds', 'outlook'])
    const unsupervised = view.services.filter(service => !service.supervised).map(service => service.serviceId)
    assert.deepEqual(unsupervised.sort(), ['ai-agent', 'ai-review', 'bot-supervisor', 'market-plane'])
  })

  test('the summary agrees with the rows', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW })
    assert.equal(view.summary.total, view.services.length)
    assert.equal(view.summary.unknown, view.services.length)
    assert.equal(view.summary.ready, 0)
    assert.equal(view.summary.failed, 0)
    assert.equal(view.summary.drifting, 0)
    assert.equal(view.summary.planned, 3)
    assert.equal(view.summary.deadLetterCount, 0, 'no dead letters unless the loader reports some')
  })
})

describe('buildOperationsView — with a snapshot', () => {
  test('merges proof onto the registry row', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()] }, now: NOW })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.ok(news)
    assert.equal(news.registered, true)
    assert.equal(news.desired, 'RUNNING')
    assert.equal(news.observed, 'READY')
    assert.equal(news.health, 'HEALTHY')
    assert.equal(news.drift, false)
    assert.equal(news.generation, 3)
    assert.equal(news.pid, 4242)
    assert.equal(news.workload.lastDurationMs, 812)
    assert.equal(news.workload.lastOutputCount, 7)
    assert.equal(news.heartbeatAgeMs, 5_000)
    assert.equal(news.readiness.length, 1)
    assert.deepEqual(news.telemetry, { pid: 4242 })

    assert.equal(view.summary.ready, 1)
    assert.equal(view.summary.total, SERVICES.length)
  })

  test('drift is reported when the operator asked for something unproven', () => {
    const view = buildOperationsView({
      registry: SERVICES,
      snapshot: { services: [record({ observed: 'FAILED', health: 'UNHEALTHY' })] },
      now: NOW,
    })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.equal(news?.drift, true)
    assert.equal(view.summary.failed, 1)
    assert.equal(view.summary.drifting, 1)
  })

  test('a tracked service the registry does not know is still visible', () => {
    const view = buildOperationsView({
      registry: SERVICES,
      snapshot: { services: [record({ serviceId: 'ghost-worker' })] },
      now: NOW,
    })
    const ghost = view.services.find(service => service.serviceId === 'ghost-worker')
    assert.ok(ghost, 'a tracked process must never be silently dropped')
    assert.equal(ghost.registered, true)
    assert.equal(ghost.label, 'ghost-worker')
    assert.equal(view.services.length, SERVICES.length + 1)
  })

  test('operations are newest-first and capped', () => {
    const operations = Array.from({ length: 60 }, (_, index) => ({
      operationId: `op_${index}`,
      serviceId: 'news',
      action: 'start',
      state: 'SUCCEEDED',
      requestedAt: NOW + index,
    }))
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [], operations }, now: NOW, recentOperations: 10 })
    assert.equal(view.operations.length, 10)
    assert.equal(view.operations[0].operationId, 'op_59')
    assert.equal(view.operations[9].operationId, 'op_50')
  })

  test('audit rows pass through', () => {
    const view = buildOperationsView({
      registry: SERVICES,
      snapshot: { services: [], operations: [], audit: [{ action: 'worker-spawned' }] },
      now: NOW,
    })
    assert.equal(view.audit.length, 1)
    assert.equal(view.audit[0].action, 'worker-spawned')
  })
})

describe('buildOperationsView — pending commands', () => {
  test('a command the supervisor has not consumed is visible as QUEUED', () => {
    const view = buildOperationsView({
      registry: SERVICES,
      snapshot: { services: [], operations: [] },
      pendingOperations: [{
        operationId: 'op_pending',
        serviceId: 'news',
        action: 'start',
        state: 'QUEUED',
        phase: 'queued',
        requestedAt: NOW,
        requestedBy: 'user-1',
        pending: true,
      }],
      now: NOW,
    })
    assert.equal(view.operations.length, 1)
    assert.equal(view.operations[0].operationId, 'op_pending')
    assert.equal(view.operations[0].pending, true)
  })

  test('the authoritative record is never shadowed by a pending copy', () => {
    const view = buildOperationsView({
      registry: SERVICES,
      snapshot: { services: [], operations: [{ operationId: 'op_1', serviceId: 'news', state: 'RUNNING', requestedAt: NOW }] },
      pendingOperations: [{ operationId: 'op_1', serviceId: 'news', state: 'QUEUED', requestedAt: NOW }],
      now: NOW,
    })
    assert.equal(view.operations.length, 1)
    assert.equal(view.operations[0].state, 'RUNNING')
  })
})

describe('operations API surface', () => {
  test('the read endpoint authenticates and delegates to the view loader', () => {
    const source = readFileSync(
      new URL('../server/api/v1/operations/services/index.get.ts', import.meta.url),
      'utf8',
    )
    assert.match(source, /requireOwnerId\(event\)/, 'reads require identity')
    assert.match(source, /loadOperationsView\(now\)/, 'the route is a thin loader')
    assert.doesNotMatch(source, /requireRootEvent/, 'reads are not root-only; only mutations are')
  })
})

describe('buildOperationsView — control-plane latency', () => {
  test('a service with no finished operation has no control metric, not zero', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()] }, now: NOW })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.equal(news?.control, null)
  })

  test('the last terminal operation is timed, split into queue and run', () => {
    const operations = [{
      operationId: 'op_1',
      serviceId: 'news',
      action: 'restart',
      state: 'SUCCEEDED',
      requestedAt: NOW - 10_000,
      startedAt: NOW - 9_100,
      finishedAt: NOW - 4_000,
    }]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW })
    const control = view.services.find(service => service.serviceId === 'news')?.control
    assert.ok(control)
    assert.equal(control.action, 'restart')
    assert.equal(control.state, 'SUCCEEDED')
    assert.equal(control.queueMs, 900, 'time the command waited for the supervisor')
    assert.equal(control.runMs, 5_100, 'time the supervisor spent doing it')
    assert.equal(control.durationMs, 6_000, 'requested -> finished is what the operator felt')
  })

  test('an in-flight operation is not timed, because it has no finish', () => {
    const operations = [{ operationId: 'op_run', serviceId: 'news', state: 'RUNNING', requestedAt: NOW - 1_000 }]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW })
    assert.equal(view.services.find(service => service.serviceId === 'news')?.control, null)
  })

  test('newest terminal operation wins, regardless of arrival order', () => {
    const operations = [
      { operationId: 'op_old', serviceId: 'news', action: 'start', state: 'SUCCEEDED', requestedAt: NOW - 60_000, startedAt: NOW - 60_000, finishedAt: NOW - 59_000 },
      { operationId: 'op_new', serviceId: 'news', action: 'stop', state: 'FAILED', requestedAt: NOW - 5_000, startedAt: NOW - 4_000, finishedAt: NOW - 1_000 },
    ]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW })
    const control = view.services.find(service => service.serviceId === 'news')?.control
    assert.equal(control?.operationId, 'op_new')
    assert.equal(control?.action, 'stop')
    assert.equal(control?.state, 'FAILED')
  })

  test('an operation with no start still yields a total, with the halves null', () => {
    const operations = [{ operationId: 'op_nostart', serviceId: 'news', action: 'probe', state: 'CANCELLED', requestedAt: NOW - 2_000, finishedAt: NOW }]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW })
    const control = view.services.find(service => service.serviceId === 'news')?.control
    assert.equal(control?.durationMs, 2_000)
    assert.equal(control?.queueMs, null)
    assert.equal(control?.runMs, null)
  })

  test('a negative gap is clamped, never reported as negative latency', () => {
    const operations = [{ operationId: 'op_clock', serviceId: 'news', action: 'start', state: 'SUCCEEDED', requestedAt: NOW, startedAt: NOW - 100, finishedAt: NOW + 500 }]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW })
    const control = view.services.find(service => service.serviceId === 'news')?.control
    assert.equal(control?.queueMs, 0)
    assert.equal(control?.durationMs, 500)
  })

  test('an unregistered tracked process also carries its control metric', () => {
    const operations = [{ operationId: 'op_ghost', serviceId: 'ghost-worker', action: 'start', state: 'SUCCEEDED', requestedAt: NOW - 1_000, startedAt: NOW - 900, finishedAt: NOW - 500 }]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record({ serviceId: 'ghost-worker' })], operations }, now: NOW })
    const ghost = view.services.find(service => service.serviceId === 'ghost-worker')
    assert.equal(ghost?.control?.operationId, 'op_ghost')
  })

  test('the metric is read from the whole timeline, not only the capped slice', () => {
    const operations = [
      { operationId: 'op_keep', serviceId: 'news', action: 'start', state: 'SUCCEEDED', requestedAt: NOW - 1_000, startedAt: NOW - 900, finishedAt: NOW },
      ...Array.from({ length: 60 }, (_, index) => ({ operationId: `op_other_${index}`, serviceId: 'scanner', action: 'probe', state: 'SUCCEEDED', requestedAt: NOW - 2_000 - index, finishedAt: NOW - 2_000 - index })),
    ]
    const view = buildOperationsView({ registry: SERVICES, snapshot: { services: [record()], operations }, now: NOW, recentOperations: 5 })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.equal(news?.control?.operationId, 'op_keep', 'falling out of the recent list must not erase the metric')
    assert.equal(view.operations.length, 5)
  })
})
describe('buildOperationsView — dead-letter count', () => {
  test('the loader-reported count is carried into the summary', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW, deadLetterCount: 4 })
    assert.equal(view.summary.deadLetterCount, 4)
  })

  test('a negative or non-finite count is clamped, never shown as garbage', () => {
    assert.equal(buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW, deadLetterCount: -2 }).summary.deadLetterCount, 0)
    assert.equal(buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW, deadLetterCount: Number.NaN }).summary.deadLetterCount, 0)
  })
})