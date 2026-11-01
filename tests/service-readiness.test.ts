import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  READINESS_RULE_IDS,
  READINESS_SCHEMA_VERSION,
  deriveObservedState,
  deriveServiceHealth,
  evaluateReadiness,
  isDrifted,
} from '../services/readiness.mjs'
import { getServiceDefinition } from '../services/registry.mjs'

// =============================================================================
//  V4.2 §17.4 readiness contract.
//
//  The rules this suite protects:
//
//    1. a REQUIRED rule without evidence is not a pass — it blocks READY;
//    2. an OPTIONAL rule without evidence is not a fault — it never downgrades;
//    3. an OPTIONAL rule that FAILED downgrades a READY service to DEGRADED;
//    4. STARTING is bounded by the startup grace, then becomes FAILED;
//    5. drift is reported in both directions.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sample',
    label: 'Sample service',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    intervalSec: 900,
    startupGraceMs: 60_000,
    dependencies: [],
    readiness: [
      { id: 'process-alive', label: 'Process is alive', required: true },
      { id: 'recent-success', label: 'A cycle completed within the allowed window', required: true },
      { id: 'output-produced', label: 'The last cycle produced output', required: false },
    ],
    supports: ['start', 'stop', 'restart', 'probe'],
    ...overrides,
  }
}

const PASSING_EVIDENCE = {
  processAlive: true,
  dependenciesReachable: true,
  lastSuccessAt: NOW - 1_000,
  lastOutputCount: 3,
}

const blockingOf = (report: { blocking: string[] }) => report.blocking.slice().sort()

describe('evaluateReadiness — required rules', () => {
  test('every required rule passing makes the service READY', () => {
    const report = evaluateReadiness(definition(), PASSING_EVIDENCE, { now: NOW })
    assert.equal(report.ready, true)
    assert.equal(report.degraded, false)
    assert.deepEqual(report.blocking, [])
  })

  test('a required rule with no evidence blocks READY', () => {
    const report = evaluateReadiness(definition(), { ...PASSING_EVIDENCE, processAlive: null }, { now: NOW })
    assert.equal(report.ready, false)
    assert.deepEqual(blockingOf(report), ['process-alive'])
  })

  test('an absent required field is no evidence, not a pass', () => {
    const report = evaluateReadiness(definition(), { processAlive: true }, { now: NOW })
    assert.equal(report.ready, false)
    assert.deepEqual(blockingOf(report), ['recent-success'])
  })

  test('a required rule that failed blocks READY', () => {
    const report = evaluateReadiness(definition(), { ...PASSING_EVIDENCE, processAlive: false }, { now: NOW })
    assert.equal(report.ready, false)
    assert.deepEqual(blockingOf(report), ['process-alive'])
  })

  test('checks preserve the declared order and labels', () => {
    const report = evaluateReadiness(definition(), PASSING_EVIDENCE, { now: NOW })
    assert.deepEqual(report.checks.map(check => check.id), [
      'process-alive',
      'recent-success',
      'output-produced',
    ])
    assert.equal(report.checks[1].label, 'A cycle completed within the allowed window')
    assert.equal(report.checks[1].required, true)
    assert.equal(report.checks[2].required, false)
  })

  test('an unknown rule id is reported as no evidence', () => {
    const report = evaluateReadiness(
      definition({ readiness: [{ id: 'made-up', label: 'x', required: true }] }),
      PASSING_EVIDENCE,
      { now: NOW },
    )
    assert.equal(report.ready, false)
    assert.equal(report.checks[0].passed, null)
    assert.equal(report.checks[0].detail, 'unknown readiness rule')
  })
})

describe('evaluateReadiness — optional rules', () => {
  test('an optional rule with no evidence does not downgrade', () => {
    const report = evaluateReadiness(
      definition(),
      { ...PASSING_EVIDENCE, lastOutputCount: null },
      { now: NOW },
    )
    assert.equal(report.ready, true)
    assert.equal(report.degraded, false)
    assert.equal(report.checks[2].passed, null)
  })

  test('an optional rule that failed downgrades to DEGRADED', () => {
    const report = evaluateReadiness(
      definition(),
      { ...PASSING_EVIDENCE, lastOutputCount: 0 },
      { now: NOW },
    )
    assert.equal(report.ready, true)
    assert.equal(report.degraded, true)
    assert.equal(report.checks[2].passed, false)
  })

  test('a required failure outranks an optional failure', () => {
    const report = evaluateReadiness(
      definition(),
      { ...PASSING_EVIDENCE, processAlive: false, lastOutputCount: 0 },
      { now: NOW },
    )
    assert.equal(report.ready, false)
    assert.equal(report.degraded, false)
  })
})

describe('evaluateReadiness — recent-success window', () => {
  test('the default window is twice the declared interval', () => {
    const withinWindow = evaluateReadiness(
      definition({ intervalSec: 900 }),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW - 1_799_000 },
      { now: NOW },
    )
    assert.equal(withinWindow.ready, true)

    const pastWindow = evaluateReadiness(
      definition({ intervalSec: 900 }),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW - 1_801_000 },
      { now: NOW },
    )
    assert.equal(pastWindow.ready, false)
    assert.deepEqual(blockingOf(pastWindow), ['recent-success'])
  })

  test('the window has a 60 s floor for fast services', () => {
    const within = evaluateReadiness(
      definition({ intervalSec: 10 }),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW - 59_000 },
      { now: NOW },
    )
    assert.equal(within.ready, true)

    const past = evaluateReadiness(
      definition({ intervalSec: 10 }),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW - 61_000 },
      { now: NOW },
    )
    assert.equal(past.ready, false)
  })

  test('an explicit window overrides the interval-derived one', () => {
    const report = evaluateReadiness(
      definition({ intervalSec: 900 }),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW - 500_000 },
      { now: NOW, staleAfterMs: 600_000 },
    )
    assert.equal(report.ready, true)
  })

  test('a timestamp in the future is bad evidence, not freshness', () => {
    const report = evaluateReadiness(
      definition(),
      { ...PASSING_EVIDENCE, lastSuccessAt: NOW + 60_000 },
      { now: NOW },
    )
    assert.equal(report.ready, false)
    assert.equal(report.checks[1].passed, false)
    assert.match(report.checks[1].detail ?? '', /future/)
  })

  test('an invalid timestamp is no evidence', () => {
    const report = evaluateReadiness(
      definition(),
      { ...PASSING_EVIDENCE, lastSuccessAt: Number.NaN },
      { now: NOW },
    )
    assert.equal(report.ready, false)
    assert.equal(report.checks[1].passed, null)
  })
})

describe('evaluateReadiness — rule evaluators', () => {
  test('fresh-event requires a recent market event', () => {
    const fresh = evaluateReadiness(
      definition({
        readiness: [{ id: 'fresh-event', label: 'x', required: true }],
      }),
      { lastEventAt: NOW - 59_000 },
      { now: NOW, freshEventMaxAgeMs: 60_000 },
    )
    assert.equal(fresh.ready, true)

    const stale = evaluateReadiness(
      definition({
        readiness: [{ id: 'fresh-event', label: 'x', required: true }],
      }),
      { lastEventAt: NOW - 61_000 },
      { now: NOW, freshEventMaxAgeMs: 60_000 },
    )
    assert.equal(stale.ready, false)
  })

  test('outbox-consuming uses its own window', () => {
    const rule = definition({
      readiness: [{ id: 'outbox-consuming', label: 'x', required: true }],
    })
    const consuming = evaluateReadiness(
      rule,
      { outboxLastConsumedAt: NOW - 30_000 },
      { now: NOW, outboxMaxAgeMs: 60_000 },
    )
    assert.equal(consuming.ready, true)

    const stalled = evaluateReadiness(
      rule,
      { outboxLastConsumedAt: NOW - 90_000 },
      { now: NOW, outboxMaxAgeMs: 60_000 },
    )
    assert.equal(stalled.ready, false)
  })

  test('capability-verified is tri-state', () => {
    const rule = definition({
      readiness: [{ id: 'capability-verified', label: 'x', required: true }],
    })
    assert.equal(evaluateReadiness(rule, { capabilityVerified: true }, { now: NOW }).ready, true)
    assert.equal(evaluateReadiness(rule, { capabilityVerified: false }, { now: NOW }).ready, false)
    assert.equal(evaluateReadiness(rule, {}, { now: NOW }).ready, false)
    assert.equal(evaluateReadiness(rule, {}, { now: NOW }).checks[0].passed, null)
  })

  test('sink-writable is tri-state', () => {
    const rule = definition({
      readiness: [{ id: 'sink-writable', label: 'x', required: true }],
    })
    assert.equal(evaluateReadiness(rule, { sinkWritable: true }, { now: NOW }).ready, true)
    assert.equal(evaluateReadiness(rule, { sinkWritable: false }, { now: NOW }).ready, false)
    assert.equal(evaluateReadiness(rule, {}, { now: NOW }).checks[0].passed, null)
  })

  test('the rule catalogue is complete and versioned', () => {
    assert.equal(READINESS_SCHEMA_VERSION, 'readiness.v1')
    assert.deepEqual(READINESS_RULE_IDS.slice().sort(), [
      'capability-verified',
      'dependency-reachable',
      'fresh-event',
      'outbox-consuming',
      'output-produced',
      'process-alive',
      'recent-success',
      'sink-writable',
      'subscription-acked',
      'validated-job',
    ])
  })
})

describe('evaluateReadiness — real registry definitions', () => {
  test('funding is READY with a completed cycle', () => {
    const funding = getServiceDefinition('funding')
    assert.ok(funding)
    const report = evaluateReadiness(funding, {
      processAlive: true,
      dependenciesReachable: true,
      lastSuccessAt: NOW - 60_000,
      lastOutputCount: 10,
    }, { now: NOW })
    assert.equal(report.ready, true)
    assert.equal(report.degraded, false)
  })

  test('funding is not READY before its first cycle', () => {
    const funding = getServiceDefinition('funding')
    assert.ok(funding)
    const report = evaluateReadiness(funding, {
      processAlive: true,
      dependenciesReachable: true,
    }, { now: NOW })
    assert.equal(report.ready, false)
    assert.deepEqual(blockingOf(report), ['recent-success'])
  })

  test('alertRules DEGRADES when the outbox stops moving', () => {
    const alertRules = getServiceDefinition('alertRules')
    assert.ok(alertRules)
    const healthy = evaluateReadiness(alertRules, {
      processAlive: true,
      dependenciesReachable: true,
      lastSuccessAt: NOW - 60_000,
      outboxLastConsumedAt: NOW - 30_000,
    }, { now: NOW })
    assert.equal(healthy.ready, true)
    assert.equal(healthy.degraded, false)

    const stalled = evaluateReadiness(alertRules, {
      processAlive: true,
      dependenciesReachable: true,
      lastSuccessAt: NOW - 60_000,
      outboxLastConsumedAt: NOW - 3_600_000,
    }, { now: NOW })
    assert.equal(stalled.ready, true)
    assert.equal(stalled.degraded, true)
  })

  test('market-plane requires an acknowledged subscription and a fresh event', () => {
    const plane = getServiceDefinition('market-plane')
    assert.ok(plane)
    const ready = evaluateReadiness(plane, {
      processAlive: true,
      dependenciesReachable: true,
      subscriptionAcked: true,
      lastEventAt: NOW - 5_000,
    }, { now: NOW })
    assert.equal(ready.ready, true)

    const noSubscription = evaluateReadiness(plane, {
      processAlive: true,
      dependenciesReachable: true,
      subscriptionAcked: false,
      lastEventAt: NOW - 5_000,
    }, { now: NOW })
    assert.equal(noSubscription.ready, false)
    assert.deepEqual(blockingOf(noSubscription), ['subscription-acked'])
  })
})

describe('deriveObservedState', () => {
  const ready = { ready: true, degraded: false, blocking: [], checks: [] }
  const degraded = { ready: true, degraded: true, blocking: [], checks: [] }
  const notReady = { ready: false, degraded: false, blocking: ['process-alive'], checks: [] }

  test('stopping wins over every other signal', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: null,
      readiness: null,
      stopping: true,
      now: NOW,
    }), 'STOPPING')
  })

  test('no process evidence is UNKNOWN', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: null,
      readiness: null,
      now: NOW,
    }), 'UNKNOWN')
  })

  test('a dead process is FAILED when it should run, STOPPED otherwise', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: false,
      readiness: null,
      now: NOW,
    }), 'FAILED')
    assert.equal(deriveObservedState({
      desired: 'STOPPED',
      processAlive: false,
      readiness: null,
      now: NOW,
    }), 'STOPPED')
  })

  test('a ready report maps to READY, a degraded one to DEGRADED', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: ready,
      now: NOW,
    }), 'READY')
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: degraded,
      now: NOW,
    }), 'DEGRADED')
  })

  test('STARTING is bounded by the startup grace', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: notReady,
      startedAt: NOW - 1_000,
      startupGraceMs: 60_000,
      now: NOW,
    }), 'STARTING')

    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: notReady,
      startedAt: NOW - 60_000,
      startupGraceMs: 60_000,
      now: NOW,
    }), 'STARTING')

    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: notReady,
      startedAt: NOW - 60_001,
      startupGraceMs: 60_000,
      now: NOW,
    }), 'FAILED')
  })

  test('no start timestamp means no grace to spend', () => {
    assert.equal(deriveObservedState({
      desired: 'RUNNING',
      processAlive: true,
      readiness: notReady,
      startedAt: null,
      startupGraceMs: 60_000,
      now: NOW,
    }), 'FAILED')
  })
})

describe('deriveServiceHealth', () => {
  test('maps every observed state honestly', () => {
    assert.equal(deriveServiceHealth('READY'), 'HEALTHY')
    assert.equal(deriveServiceHealth('DEGRADED'), 'DEGRADED')
    assert.equal(deriveServiceHealth('FAILED'), 'UNHEALTHY')
    assert.equal(deriveServiceHealth('STARTING'), 'UNKNOWN')
    assert.equal(deriveServiceHealth('STOPPING'), 'UNKNOWN')
    assert.equal(deriveServiceHealth('STOPPED'), 'UNKNOWN')
    assert.equal(deriveServiceHealth('UNKNOWN'), 'UNKNOWN')
  })
})

describe('isDrifted', () => {
  test('RUNNING drifts when nothing is running', () => {
    for (const observed of ['STARTING', 'READY', 'DEGRADED', 'STOPPING'] as const) {
      assert.equal(isDrifted('RUNNING', observed), false, `${observed} satisfies RUNNING`)
    }
    for (const observed of ['STOPPED', 'FAILED', 'UNKNOWN'] as const) {
      assert.equal(isDrifted('RUNNING', observed), true, `${observed} does not satisfy RUNNING`)
    }
  })

  test('STOPPED drifts when something is running', () => {
    for (const observed of ['STARTING', 'READY', 'DEGRADED', 'STOPPING'] as const) {
      assert.equal(isDrifted('STOPPED', observed), true, `${observed} violates STOPPED`)
    }
    assert.equal(isDrifted('STOPPED', 'STOPPED'), false)
    assert.equal(isDrifted('STOPPED', 'UNKNOWN'), true)
  })
})
