import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TELEMETRY_RESOLUTION_MS,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_THRESHOLDS,
  createTelemetrySampler,
  evaluateTelemetry,
  explainTelemetry,
  nsToMs,
} from '../services/telemetry.mjs'

// =============================================================================
//  V4.2 §17.13 / A7 per-process telemetry.
//
//  Two separate guarantees are tested here:
//
//    SAMPLING  the snapshot has the documented shape, uses the injected clock
//              and releases its OS resources exactly once;
//    VERDICT   saturation is derived from evidence, and a snapshot without
//              evidence is `unknown` — never a comfortable `ok`.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    pid: 4242,
    host: 'test-host',
    sampledAt: NOW,
    uptimeSec: 120,
    eventLoopDelayMs: { p50: 1, p95: 2, p99: 3, max: 4 },
    utilization: 0.1,
    heapUsedMb: 10,
    heapTotalMb: 100,
    rssMb: 200,
    cpuPercent: 5,
    gcPauseMs: null,
    ...overrides,
  }
}

describe('nsToMs', () => {
  test('converts nanoseconds to milliseconds', () => {
    assert.equal(nsToMs(1_000_000), 1)
    assert.equal(nsToMs(1_500_000), 1.5)
    assert.equal(nsToMs(0), 0)
  })

  test('keeps precision to the requested decimals', () => {
    assert.equal(nsToMs(1_234_567, 3), 1.235)
    assert.equal(nsToMs(1_234_567, 0), 1)
  })

  test('accepts a bigint', () => {
    assert.equal(nsToMs(2_000_000n), 2)
  })

  test('an absent or invalid measurement is null, never 0', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(nsToMs(value as number | null | undefined), null)
    }
  })
})

describe('createTelemetrySampler', () => {
  test('produces a snapshot with the documented shape', () => {
    let clock = NOW
    const sampler = createTelemetrySampler({
      resolutionMs: 10,
      host: 'test-host',
      pid: 4242,
      now: () => clock,
    })
    try {
      const sample = sampler.sample()

      assert.equal(sample.schemaVersion, TELEMETRY_SCHEMA_VERSION)
      assert.equal(sample.pid, 4242)
      assert.equal(sample.host, 'test-host')
      assert.equal(sample.sampledAt, NOW)
      assert.ok(sample.uptimeSec >= 0)

      for (const key of ['p50', 'p95', 'p99', 'max'] as const) {
        const value = sample.eventLoopDelayMs[key]
        assert.ok(value === null || (Number.isFinite(value) && value >= 0), `p${key} must be null or >= 0`)
      }

      assert.ok(sample.utilization === null || (sample.utilization >= 0 && sample.utilization <= 1))
      assert.ok(sample.heapUsedMb > 0)
      assert.ok(sample.heapTotalMb > 0)
      assert.ok(sample.rssMb > 0)
      assert.ok(sample.cpuPercent === null || Number.isFinite(sample.cpuPercent))

      if (sample.gcPauseMs !== null) {
        assert.ok(sample.gcPauseMs.count > 0)
        assert.ok(sample.gcPauseMs.totalMs >= 0)
        assert.ok(sample.gcPauseMs.maxMs >= 0)
      }
    } finally {
      sampler.stop()
    }
  })

  test('the injected clock drives sampledAt and the CPU window', () => {
    let clock = NOW
    const sampler = createTelemetrySampler({ resolutionMs: 10, now: () => clock })
    try {
      const first = sampler.sample()
      // There is no previous window yet: CPU is honestly null.
      assert.equal(first.cpuPercent, null)

      clock = NOW + 1_000
      const second = sampler.sample()
      assert.equal(second.sampledAt, NOW + 1_000)
      assert.equal(typeof second.cpuPercent, 'number')
      assert.ok(second.cpuPercent >= 0)
    } finally {
      sampler.stop()
    }
  })

  test('resolution defaults and clamps to a usable value', () => {
    const fallback = createTelemetrySampler({ resolutionMs: 0 })
    const explicit = createTelemetrySampler({ resolutionMs: 5 })
    try {
      assert.equal(fallback.resolutionMs, TELEMETRY_RESOLUTION_MS)
      assert.equal(explicit.resolutionMs, 5)
    } finally {
      fallback.stop()
      explicit.stop()
    }
  })

  test('stop is idempotent', () => {
    const sampler = createTelemetrySampler({ resolutionMs: 10 })
    assert.equal(sampler.stopped, false)
    sampler.stop()
    assert.equal(sampler.stopped, true)
    assert.doesNotThrow(() => sampler.stop())
    assert.equal(sampler.stopped, true)
  })
})

describe('evaluateTelemetry — evidence first', () => {
  test('no snapshot is unknown', () => {
    assert.equal(evaluateTelemetry(null), 'unknown')
    assert.equal(evaluateTelemetry(undefined), 'unknown')
  })

  test('a snapshot without event-loop evidence is unknown, not ok', () => {
    const verdict = evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: null, p95: null, p99: null, max: null },
      utilization: null,
    }))
    assert.equal(verdict, 'unknown')
  })

  test('a healthy snapshot is ok', () => {
    assert.equal(evaluateTelemetry(snapshot()), 'ok')
  })
})

describe('evaluateTelemetry — event loop', () => {
  test('p95 at the elevated threshold is elevated', () => {
    const at = TELEMETRY_THRESHOLDS.eventLoopP95Ms.elevated
    assert.equal(evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: at, p99: at, max: at },
    })), 'elevated')
  })

  test('p95 at the saturated threshold is saturated', () => {
    const at = TELEMETRY_THRESHOLDS.eventLoopP95Ms.saturated
    assert.equal(evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: at, p99: at, max: at },
    })), 'saturated')
  })

  test('high utilization alone can saturate', () => {
    assert.equal(evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 1, p99: 1, max: 1 },
      utilization: TELEMETRY_THRESHOLDS.utilization.saturated,
    })), 'saturated')
  })

  test('elevated utilization alone is elevated', () => {
    assert.equal(evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 1, p99: 1, max: 1 },
      utilization: TELEMETRY_THRESHOLDS.utilization.elevated,
    })), 'elevated')
  })

  test('saturated wins over elevated', () => {
    assert.equal(evaluateTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 60, p99: 60, max: 60 },
      utilization: 0.95,
    })), 'saturated')
  })
})

describe('evaluateTelemetry — memory and GC', () => {
  test('heap pressure is elevated', () => {
    assert.equal(evaluateTelemetry(snapshot({
      heapUsedMb: 95,
      heapTotalMb: 100,
    })), 'elevated')
  })

  test('a healthy heap is not flagged', () => {
    assert.equal(evaluateTelemetry(snapshot({
      heapUsedMb: 20,
      heapTotalMb: 100,
    })), 'ok')
  })

  test('a zero heap total cannot produce a fraction', () => {
    assert.equal(evaluateTelemetry(snapshot({
      heapUsedMb: 10,
      heapTotalMb: 0,
    })), 'ok')
  })

  test('a long GC pause is elevated, a very long one saturated', () => {
    assert.equal(evaluateTelemetry(snapshot({
      gcPauseMs: { count: 3, totalMs: TELEMETRY_THRESHOLDS.gcPauseMs.elevated, maxMs: 20 },
    })), 'elevated')

    assert.equal(evaluateTelemetry(snapshot({
      gcPauseMs: { count: 3, totalMs: TELEMETRY_THRESHOLDS.gcPauseMs.saturated, maxMs: 100 },
    })), 'saturated')
  })

  test('no GC inside the window is not a fault', () => {
    assert.equal(evaluateTelemetry(snapshot({ gcPauseMs: null })), 'ok')
  })
})

describe('explainTelemetry', () => {
  test('names the reason behind the verdict', () => {
    const result = explainTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 250, p99: 250, max: 250 },
    }))
    assert.equal(result.verdict, 'saturated')
    assert.deepEqual(result.reasons, ['event-loop-delay-critical'])
  })

  test('reports every contributing reason', () => {
    const result = explainTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 60, p99: 60, max: 60 },
      heapUsedMb: 95,
      heapTotalMb: 100,
    }))
    assert.equal(result.verdict, 'elevated')
    assert.deepEqual(result.reasons.slice().sort(), ['event-loop-delay-high', 'heap-pressure'])
  })

  test('a healthy snapshot has no reasons', () => {
    assert.deepEqual(explainTelemetry(snapshot()), { verdict: 'ok', reasons: [] })
  })

  test('a missing sample explains itself', () => {
    assert.deepEqual(explainTelemetry(null), { verdict: 'unknown', reasons: ['no-sample'] })
  })

  test('thresholds are overridable', () => {
    const result = explainTelemetry(snapshot({
      eventLoopDelayMs: { p50: 1, p95: 20, p99: 20, max: 20 },
    }), {
      thresholds: {
        ...TELEMETRY_THRESHOLDS,
        eventLoopP95Ms: { elevated: 10, saturated: 100 },
      },
    })
    assert.equal(result.verdict, 'elevated')
    assert.deepEqual(result.reasons, ['event-loop-delay-high'])
  })
})
