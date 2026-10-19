// =============================================================================
//  G8.2 acceptance — the market plane's WS health reaches the §35 gate.
//
//  The plane (Nitro process) writes a bounded snapshot; the paper executor
//  (another process) reads it and feeds it into qualityGates(). Everything
//  here runs offline: fake planes, temp files, injected clocks.
// =============================================================================

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMarketHealthSnapshot,
  writeMarketHealthSnapshot,
  createMarketHealthWriter,
  MARKET_HEALTH_SCHEMA_VERSION,
} from '../market/healthSnapshot.mjs'
import { wsHealthFromSnapshot, readWsHealth, WS_HEALTH_DEFAULTS } from '../exec/wsHealth.mjs'
import { qualityGates } from '../exec/qualityGates.mjs'

const T0 = 1_790_000_000_000

type Row = Record<string, any>

const fakePlane = (o: Row = {}) => ({
  monitor: {
    status: () => ({
      latency: { samples: 12, p50: 40, p95: o.p95 ?? 120, max: 300, window: 500 },
      seq: o.seq ?? { 'binance:btcusdt@trade': { last: 10, dup: 0, gaps: 0, outOfOrder: 0, count: 10 } },
    }),
  },
  provider: { status: () => ({ state: o.providerState ?? 'connected', attempt: 1, provider: 'binance', market: 'fapi', streams: 4 }) },
  stats: () => ({ symbols: 1, candles: 3 }),
})

const snapshotOf = (plane: Row, at = T0) => buildMarketHealthSnapshot({ plane, at })

describe('G8.2: plane health snapshot', () => {
  test('the snapshot is built only from what the plane measured', () => {
    const snap = snapshotOf(fakePlane())
    assert.equal(snap.schemaVersion, MARKET_HEALTH_SCHEMA_VERSION)
    assert.equal(snap.at, T0)
    assert.equal(snap.provider.state, 'connected')
    assert.equal(snap.latency.p95, 120)
    assert.equal(snap.seq.streams, 1)
    assert.equal(snap.seq.gaps, 0)
    assert.equal(snap.stats.candles, 3)
  })

  test('sequence gaps, duplicates and out-of-order are summed across streams', () => {
    const snap = snapshotOf(fakePlane({
      seq: {
        a: { gaps: 2, dup: 1, outOfOrder: 1 },
        b: { gaps: 3, dup: 0, outOfOrder: 0 },
      },
    }))
    assert.deepEqual(snap.seq, { streams: 2, gaps: 5, dup: 1, outOfOrder: 1 })
  })

  test('a plane without a provider (MARKET_PROVIDER=off) is reported as such', () => {
    const snap = buildMarketHealthSnapshot({ plane: { monitor: { status: () => ({ latency: {}, seq: {} }) }, provider: null, stats: () => ({}) }, at: T0 })
    assert.equal(snap.provider, null)
    assert.equal(snap.seq.streams, 0)
  })

  test('the writer replaces the file atomically and the reader round-trips it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mws-'))
    const file = join(dir, 'health.json')
    try {
      assert.equal(writeMarketHealthSnapshot(file, snapshotOf(fakePlane())), true)
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(parsed.at, T0)
      const ws = await readWsHealth(file, { at: T0 + 1_000 })
      assert.equal(ws.state, 'ok')
      assert.equal(ws.ageMs, 1_000)
      assert.equal(ws.gaps, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('createMarketHealthWriter writes once on start and stops cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mws-'))
    const file = join(dir, 'health.json')
    try {
      const writer = createMarketHealthWriter({ plane: fakePlane(), file, everyMs: 60_000, now: () => T0 })
      writer.start()
      const snap = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(snap.at, T0)
      writer.stop()
      writer.stop() // idempotent
      assert.equal(writeMarketHealthSnapshot(join(dir, 'missing', 'nested', 'health.json'), snapshotOf(fakePlane())), true, 'mkdir -p is part of the write')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('G8.2: translating a snapshot into a §35 state', () => {
  test('connected + no anomalies -> ok', () => {
    const ws = wsHealthFromSnapshot(snapshotOf(fakePlane()), { at: T0 + 5_000 })
    assert.equal(ws.state, 'ok')
    assert.deepEqual(ws.reasons.length, 1)
  })

  test('a missing snapshot is unknown, never ok (D12)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mws-'))
    try {
      const ws = await readWsHealth(join(dir, 'nope.json'), { at: T0 })
      assert.equal(ws.state, 'unknown')
      assert.match(ws.reasons[0], /no market-plane health snapshot/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('silence is not health: a snapshot past maxAgeMs is unknown', () => {
    const ws = wsHealthFromSnapshot(snapshotOf(fakePlane()), { at: T0 + WS_HEALTH_DEFAULTS.maxAgeMs + 1 })
    assert.equal(ws.state, 'unknown')
    assert.match(ws.reasons[0], /stopped reporting/)
  })

  test('a timestamp in the future is a clock disagreement, not a verdict', () => {
    const ws = wsHealthFromSnapshot(snapshotOf(fakePlane(), T0 + 60_000), { at: T0 })
    assert.equal(ws.state, 'unknown')
    assert.match(ws.reasons[0], /in the future/)
  })

  test('garbage on disk is unknown, not a throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mws-'))
    const file = join(dir, 'health.json')
    try {
      writeFileSync(file, '{not json')
      const ws = await readWsHealth(file, { at: T0 })
      assert.equal(ws.state, 'unknown')
      assert.match(ws.reasons[0], /not valid JSON/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('provider states map honestly: disconnected / connecting / off', () => {
    assert.equal(wsHealthFromSnapshot(snapshotOf(fakePlane({ providerState: 'disconnected' })), { at: T0 }).state, 'disconnected')
    const connecting = wsHealthFromSnapshot(snapshotOf(fakePlane({ providerState: 'connecting' })), { at: T0 })
    assert.equal(connecting.state, 'unknown')
    assert.match(connecting.reasons[0], /'connecting'/)
    const off = wsHealthFromSnapshot(buildMarketHealthSnapshot({ plane: { monitor: { status: () => ({ latency: {}, seq: {} }) }, provider: null, stats: () => ({}) }, at: T0 }), { at: T0 })
    assert.equal(off.state, 'unknown')
    assert.match(off.reasons[0], /no provider/)
  })

  test('sequence loss and latency degrade the state with the measured detail', () => {
    const gaps = wsHealthFromSnapshot(snapshotOf(fakePlane({ seq: { s: { gaps: 4, dup: 0, outOfOrder: 0 } } })), { at: T0 })
    assert.equal(gaps.state, 'degraded')
    assert.match(gaps.reasons[0], /4 sequence gap/)
    assert.equal(gaps.gaps, 4)

    const slow = wsHealthFromSnapshot(snapshotOf(fakePlane({ p95: WS_HEALTH_DEFAULTS.latencyP95CapMs + 1 })), { at: T0 })
    assert.equal(slow.state, 'degraded')
    assert.match(slow.reasons[0], /p95 ingest latency/)
  })
})

describe('G8.2: the §35 gate consumes WS health', () => {
  const baseGate = (o: Row = {}) => qualityGates({
    streamState: 'ok',
    quoteAgeMs: 1_000,
    candleGapUnresolved: false,
    instrumentState: 'active',
    riskStateAvailable: true,
    ...o,
  })

  test('a REST-priced fill is not blocked by a WS outage — but it is shown', () => {
    const q = baseGate({ wsState: 'degraded', wsGapCount: 3, priceSource: 'rest' })
    assert.equal(q.allowed, true)
    assert.ok(q.degraded.includes('ws_stream_degraded'))
    assert.match(q.reasons.find((r: Row) => r.id === 'ws_stream_degraded')!.reason, /3 sequence gap/)
  })

  test('a WS-priced fill blocks when the WS is not trustworthy', () => {
    const q = baseGate({ wsState: 'disconnected', priceSource: 'ws' })
    assert.equal(q.allowed, false)
    assert.ok(q.block.includes('market_stream_disconnected'))
    const slow = baseGate({ wsState: 'degraded', wsGapCount: 0, wsLatencyP95Ms: 5_000, priceSource: 'ws' })
    assert.equal(slow.allowed, false)
    assert.match(slow.reasons.at(-1)!.reason, /p95 latency 5000ms/)
  })

  test('callers that do not measure WS get no invented verdict (backward compatible)', () => {
    const q = baseGate()
    assert.equal(q.allowed, true)
    assert.ok(!q.degraded.includes('ws_stream_degraded'))
    assert.equal(baseGate({ wsState: null }).allowed, true)
  })

  test('the paper executor wires the snapshot into the gate and the decision record', () => {
    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.match(src, /readWsHealth\(WS_HEALTH_FILE, \{ at: Date\.now\(\) \}\)/, 'one read per cycle')
    assert.match(src, /wsState: ws\.state/)
    assert.match(src, /priceSource: 'rest'/, 'a REST-priced fill says so explicitly')
    assert.match(src, /marketWs: \{ state: ws\.state/, 'the decision snapshot carries the WS fact')
    // The snapshot writer is started by the plane, not by the executor.
    const plane = readFileSync(new URL('../server/utils/market-plane.ts', import.meta.url), 'utf8')
    assert.match(plane, /createMarketHealthWriter/)
  })
})
