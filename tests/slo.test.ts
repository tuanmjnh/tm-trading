import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RESTART_BREACH,
  DEFAULT_RESTART_WARN,
  FLAP_WINDOW_MS,
  SLO_SCHEMA_VERSION,
  SLO_STATUSES,
  countUnhealthyExits,
  evaluateSlo,
  freshnessWindowMs,
  serviceHasDuty,
} from '../services/slo.mjs'
import { buildOperationsView } from '../services/operationsView.mjs'
import { SERVICES } from '../services/registry.mjs'

// =============================================================================
//  V4.2 §17.13 — per-service SLOs.
//
//  An SLO is a promise. A promise that cannot be measured is either marketing or
//  a lie, so each objective here is fed by evidence the supervisor already
//  records, and `unknown` is a first-class verdict that never counts as a pass:
//
//    1. a stopped service has no duty — it must not look like an outage;
//    2. freshness is triaged against `factor x interval`, with a floor;
//    3. flapping counts restart-shaped audit rows inside the window only;
//    4. saturation is the telemetry verdict, never a re-guess;
//    5. the service verdict is the worst objective verdict.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

type SloResult = {
  schemaVersion: string
  status: string
  objectives: Array<{ id: string, status: string, detail: string }>
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'news',
    scopeKey: 'system',
    desired: 'RUNNING',
    observed: 'READY',
    health: 'HEALTHY',
    lastSuccessAt: NOW - 30_000,
    // A quiet, healthy loop: 2 ms p95 delay and 10 % utilization.
    telemetry: { eventLoopDelayMs: { p95: 2 }, utilization: 0.1 },
    ...overrides,
  }
}

function auditRows(action: string, count: number, at = NOW - 60_000, serviceId = 'news') {
  return Array.from({ length: count }, () => ({ action, serviceId, at }))
}

function objective(slo: SloResult, id: string) {
  const found = slo.objectives.find(entry => entry.id === id)
  assert.ok(found, `objective ${id} must be present`)
  return found
}

const NEWS = SERVICES.find(service => service.id === 'news')
// The freshness tests need a real periodic definition with its own interval.

describe('serviceHasDuty', () => {
  test('an unknown service has no duty', () => {
    assert.equal(serviceHasDuty(null), false)
    assert.equal(serviceHasDuty(undefined), false)
  })

  test('a stopped service has no duty, so it is not an outage', () => {
    assert.equal(serviceHasDuty(record({ desired: 'STOPPED' })), false)
  })

  test('a running service has duty', () => {
    assert.equal(serviceHasDuty(record()), true)
  })
})

describe('freshnessWindowMs', () => {
  test('a 60 s service is never judged per minute', () => {
    // The floor exists so ordinary jitter cannot breach a short interval:
    // 3 x 60 s = 180 s sits below the 300 s floor.
    assert.equal(freshnessWindowMs({ intervalSec: 60 }), 300_000)
  })

  test('a long interval scales by the factor', () => {
    assert.equal(freshnessWindowMs({ intervalSec: 900 }), 2_700_000)
  })

  test('honours a custom factor', () => {
    assert.equal(freshnessWindowMs({ intervalSec: 900 }, 2), 1_800_000)
  })

  test('a missing or invalid interval falls back to the floor', () => {
    assert.equal(freshnessWindowMs({}), 300_000)
    assert.equal(freshnessWindowMs({ intervalSec: null }), 300_000)
    assert.equal(freshnessWindowMs({ intervalSec: 0 }), 300_000)
    assert.equal(freshnessWindowMs({ intervalSec: -5 }), 300_000)
    assert.equal(freshnessWindowMs(null), 300_000)
  })
})

describe('countUnhealthyExits', () => {
  test('counts only restart-shaped actions', () => {
    const audit = [
      ...auditRows('crash-restart', 1),
      ...auditRows('worker-exited', 2),
      ...auditRows('worker-spawned', 5),
      ...auditRows('command-accepted', 3),
      ...auditRows('service-stopped', 1),
    ]
    assert.equal(countUnhealthyExits(audit, NOW), 3)
  })

  test('a healthy spawn or a command is not a flap', () => {
    assert.equal(countUnhealthyExits(auditRows('worker-spawned', 40), NOW), 0)
    assert.equal(countUnhealthyExits(auditRows('command-accepted', 40), NOW), 0)
    assert.equal(countUnhealthyExits([], NOW), 0)
    assert.equal(countUnhealthyExits(null, NOW), 0)
  })

  test('rows older than the window do not count', () => {
    const audit = [
      ...auditRows('crash-restart', 3, NOW - FLAP_WINDOW_MS - 1),
      ...auditRows('crash-restart', 1, NOW - 1_000),
    ]
    assert.equal(countUnhealthyExits(audit, NOW), 1)
  })

  test('a row with no timestamp is not guessed at', () => {
    assert.equal(countUnhealthyExits([{ action: 'crash-restart' }], NOW), 0)
    assert.equal(countUnhealthyExits([{ action: 'crash-restart', at: 'yesterday' }], NOW), 0)
  })
  test('another service\'s restarts do not count against this one', () => {
    const audit = [
      ...auditRows('crash-restart', 5, NOW - 1_000, 'scanner'),
      ...auditRows('crash-restart', 1, NOW - 1_000, 'news'),
    ]
    assert.equal(countUnhealthyExits(audit, NOW, undefined, 'news'), 1)
  })
})

describe('evaluateSlo', () => {
  test('a healthy service meets every objective', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit: [], now: NOW }) as SloResult
    assert.equal(slo.schemaVersion, SLO_SCHEMA_VERSION)
    assert.equal(slo.status, 'ok')
    assert.equal(objective(slo, 'freshness').status, 'ok')
    assert.equal(objective(slo, 'flapping').status, 'ok')
    assert.equal(objective(slo, 'saturation').status, 'ok')
  })

  test('it always reports the same three objectives, in order', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit: [], now: NOW }) as SloResult
    assert.deepEqual(slo.objectives.map(entry => entry.id), ['freshness', 'flapping', 'saturation'])
  })

  test('every objective carries a human-readable detail, never a bare status', () => {
    const slo = evaluateSlo({
      definition: NEWS,
      record: record({ telemetry: { eventLoopDelayMs: { p95: 500 } } }),
      audit: auditRows('crash-restart', 9),
      now: NOW,
    }) as SloResult
    for (const objective of slo.objectives) {
      assert.ok(objective.detail.length > 0, `${objective.id} explains itself`)
    }
  })
})

describe('evaluateSlo — duty and honesty', () => {
  test('a never-started service is unknown, never ok', () => {
    const slo = evaluateSlo({ definition: NEWS, record: null, audit: [], now: NOW }) as SloResult
    assert.equal(slo.status, 'unknown')
    assert.ok(slo.objectives.every(entry => entry.status === 'unknown'))
  })

  test('a deliberately stopped service is not an outage', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record({ desired: 'STOPPED' }), audit: [], now: NOW }) as SloResult
    assert.equal(slo.status, 'unknown')
  })

  test('a running service with no completed cycle yet is unknown, not late', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record({ lastSuccessAt: null }), audit: [], now: NOW }) as SloResult
    assert.equal(objective(slo, 'freshness').status, 'unknown')
    assert.match(objective(slo, 'freshness').detail, /no completed cycle/)
  })

  test('the status is always one of the four verdicts', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit: [], now: NOW }) as SloResult
    assert.ok(SLO_STATUSES.includes(slo.status))
  })
})

describe('evaluateSlo — freshness triage', () => {
  const definition = { id: 'news', intervalSec: 900 } // budget 45 min = 2_700_000 ms

  test('within budget is ok', () => {
    const slo = evaluateSlo({ definition, record: record({ lastSuccessAt: NOW - 2_700_000 }), audit: [], now: NOW }) as SloResult
    assert.equal(objective(slo, 'freshness').status, 'ok')
  })

  test('one window late is at-risk', () => {
    const slo = evaluateSlo({ definition, record: record({ lastSuccessAt: NOW - 2_700_001 }), audit: [], now: NOW }) as SloResult
    assert.equal(objective(slo, 'freshness').status, 'at-risk')
  })

  test('two windows late is breached', () => {
    const slo = evaluateSlo({ definition, record: record({ lastSuccessAt: NOW - 5_400_001 }), audit: [], now: NOW }) as SloResult
    assert.equal(objective(slo, 'freshness').status, 'breached')
  })

  test('the detail states the observed age and the budget', () => {
    const slo = evaluateSlo({ definition, record: record({ lastSuccessAt: NOW - 60_000 }), audit: [], now: NOW }) as SloResult
    assert.match(objective(slo, 'freshness').detail, /60s ago, budget 2700s/)
  })
})

describe('evaluateSlo — flapping and saturation', () => {
  test('restart history at the warn threshold is at-risk', () => {
    const audit = auditRows('crash-restart', DEFAULT_RESTART_WARN)
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit, now: NOW }) as SloResult
    assert.equal(objective(slo, 'flapping').status, 'at-risk')
  })

  test('restart history at the breach threshold is breached', () => {
    const audit = auditRows('crash-restart', DEFAULT_RESTART_BREACH)
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit, now: NOW }) as SloResult
    assert.equal(objective(slo, 'flapping').status, 'breached')
  })

  test('saturation follows the telemetry verdict, it never re-guesses', () => {
    const elevated = evaluateSlo({
      definition: NEWS,
      record: record({ telemetry: { eventLoopDelayMs: { p95: 60 }, utilization: 0.2 } }),
      audit: [],
      now: NOW,
    }) as SloResult
    assert.equal(objective(elevated, 'saturation').status, 'at-risk')

    const saturated = evaluateSlo({
      definition: NEWS,
      record: record({ telemetry: { eventLoopDelayMs: { p95: 250 }, utilization: 0.95 } }),
      audit: [],
      now: NOW,
    }) as SloResult
    assert.equal(objective(saturated, 'saturation').status, 'breached')
  })

  test('no telemetry is unknown, not ok', () => {
    const slo = evaluateSlo({ definition: NEWS, record: record({ telemetry: null }), audit: [], now: NOW }) as SloResult
    assert.equal(objective(slo, 'saturation').status, 'unknown')
  })

  test('the worst objective sets the service verdict', () => {
    const audit = auditRows('crash-restart', 9)
    const slo = evaluateSlo({ definition: NEWS, record: record(), audit, now: NOW }) as SloResult
    assert.equal(objective(slo, 'freshness').status, 'ok')
    assert.equal(objective(slo, 'flapping').status, 'breached')
    assert.equal(slo.status, 'breached')
  })
})

describe('operations view — SLO roll-up', () => {
  test('a registry with no snapshot reports every service as not measured', () => {
    const view = buildOperationsView({ registry: SERVICES, snapshot: null, now: NOW })
    assert.equal(view.summary.sloBreached, 0)
    assert.equal(view.summary.sloAtRisk, 0)
    assert.equal(view.summary.sloUnknown, SERVICES.length)
  })

  test('a breached service is counted and its row carries the verdict', () => {
    const snapshot = {
      services: [record({ serviceId: 'news', restartCount: 9 })],
      audit: auditRows('crash-restart', 9),
    }
    const view = buildOperationsView({ registry: SERVICES, snapshot, now: NOW })
    const news = view.services.find(service => service.serviceId === 'news')
    assert.equal(news?.slo.status, 'breached')
    assert.equal(view.summary.sloBreached, 1)
  })

  test('an unregistered tracked process still gets an SLO verdict', () => {
    const snapshot = { services: [record({ serviceId: 'ghost-worker' })], audit: [] }
    const view = buildOperationsView({ registry: SERVICES, snapshot, now: NOW })
    const ghost = view.services.find(service => service.serviceId === 'ghost-worker')
    assert.ok(ghost?.slo)
    assert.ok(SLO_STATUSES.includes(ghost.slo.status))
  })
})
