import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUALITY_SCHEMA_VERSION,
  DEFAULT_THRESHOLDS,
  evaluateQuality,
} from '../market/quality.mjs'

// =============================================================================
//  §24.1 data-quality checks: raw monitor counters -> rates + verdict.
//  Pure, offline, honest: unobserved metrics are null / 'unknown', never 0/'ok'.
// =============================================================================

const stream = (count, dup = 0, gaps = 0, outOfOrder = 0) => ({ count, dup, gaps, outOfOrder })

describe('evaluateQuality (§24.1)', () => {
  test('rates are computed over what was observed (duplicate/outOfOrder/gap)', () => {
    const q = evaluateQuality({ status: { seq: { 'binance:fapi:BTCUSDT@trade': stream(2000, 2, 5, 1) } } })
    const row = q.seq['binance:fapi:BTCUSDT@trade']
    assert.equal(row.duplicateRate, 0.001) // not > 0.001 default -> healthy
    assert.equal(row.outOfOrderRate, 0.0005)
    assert.equal(row.gapRate, 5 / 2005) // missing / (seen + missing)
    assert.equal(row.healthy, true)
    assert.equal(q.verdict, 'ok')
  })

  test('an empty stream keeps rates null (honest) and never lies healthy=false', () => {
    const q = evaluateQuality({ status: { seq: { 'binance:fapi:ETHUSDT@trade': stream(0) } } })
    const row = q.seq['binance:fapi:ETHUSDT@trade']
    assert.equal(row.duplicateRate, null)
    assert.equal(row.gapRate, null)
    assert.equal(row.outOfOrderRate, null)
    assert.equal(row.healthy, true) // nothing wrong OBSERVED
  })

  test('threshold breaches are named per stream with reasons', () => {
    const q = evaluateQuality({ status: { seq: { s1: stream(100, 1, 0, 0), s2: stream(10, 0, 3, 2) } } })
    // s1: duplicateRate 0.01 > 0.001 -> suspect
    assert.equal(q.seq.s1.healthy, false)
    const reasons = q.suspect.find((x) => x.id === 's1')?.reasons ?? []
    assert.ok(reasons.some((r) => r.startsWith('duplicateRate')))
    // s2: gapRate 0.3 > 0.01 AND outOfOrderRate 0.2 > 0.005 -> both named
    const r2 = q.suspect.find((x) => x.id === 's2')?.reasons ?? []
    assert.ok(r2.some((r) => r.startsWith('gapRate')))
    assert.ok(r2.some((r) => r.startsWith('outOfOrderRate')))
    assert.equal(q.verdict, 'suspect')
  })

  test('latency: p95 over threshold flags; no samples -> null (unknown)', () => {
    const ok = evaluateQuality({ status: { latency: { samples: 10, p50: 40, p95: 120, max: 300 } } })
    assert.equal(ok.latency.healthy, true)
    const slow = evaluateQuality({ status: { latency: { samples: 10, p50: 400, p95: 900, max: 1200 } } })
    assert.equal(slow.latency.healthy, false)
    assert.ok(slow.suspect.some((x) => x.id === 'latency'))
    assert.equal(slow.verdict, 'suspect')
    const noData = evaluateQuality({})
    assert.equal(noData.latency.healthy, null)
    assert.equal(noData.latency.p95, null)
  })

  test('malformed rate counts against seen + malformed', () => {
    const q = evaluateQuality({ status: { seq: { s: stream(1000) } }, malformed: 10 })
    assert.equal(q.malformed.rate, 10 / 1010)
    // 0.0099 > 0.005 default -> unhealthy
    assert.equal(q.malformed.healthy, false)
    assert.ok(q.suspect.some((x) => x.id === 'malformed'))
    // with no events at all -> rate null, healthy null (unknown)
    const empty = evaluateQuality({ malformed: 0 })
    assert.equal(empty.malformed.rate, null)
    assert.equal(empty.malformed.healthy, null)
  })

  test('heartbeats: stale flags, unknown stays unknown (never fake-ok)', () => {
    const q = evaluateQuality({ heartbeats: { binance: 120_000, bybit: 1_000, okx: null } })
    assert.equal(q.heartbeats.binance.stale, true)
    assert.equal(q.heartbeats.bybit.stale, false)
    assert.equal(q.heartbeats.okx.stale, null) // null input -> unknown
    assert.ok(q.suspect.some((x) => x.id === 'heartbeat:binance'))
    assert.ok(!q.suspect.some((x) => x.id === 'heartbeat:bybit'))
    assert.ok(!q.suspect.some((x) => x.id === 'heartbeat:okx'))
    assert.equal(q.verdict, 'suspect') // binance stale -> suspect even alone
  })

  test('verdict is unknown when NOTHING was observed, ok only when all green', () => {
    assert.equal(evaluateQuality({}).verdict, 'unknown')
    assert.equal(evaluateQuality({ status: { seq: { s: stream(5) } } }).verdict, 'ok')
    // malformed alone IS an observation; 3 malformed / 0 seen = 100% -> suspect
    assert.equal(evaluateQuality({ malformed: 3 }).verdict, 'suspect')
  })

  test('threshold overrides are honoured per call', () => {
    const q = evaluateQuality({
      status: { latency: { samples: 5, p50: 100, p95: 300, max: 400 }, seq: { s: stream(10, 0, 0, 0) } },
      thresholds: { p95LatencyMs: 200 },
    })
    assert.equal(q.latency.healthy, false) // 300 > 200 override
    assert.equal(DEFAULT_THRESHOLDS.p95LatencyMs, 500) // defaults untouched
    assert.equal(q.schemaVersion, QUALITY_SCHEMA_VERSION)
  })
})