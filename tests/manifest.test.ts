import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SECTIONS,
  MANIFEST_SOURCES,
  buildManifest,
  essentialGaps,
  isManifest,
  legacyManifestNote,
  manifestFingerprint,
  manifestFromSession,
  manifestGaps,
  validationScope
} from '../engine/manifest.mjs'

// =============================================================================
//  Phase F — versioned manifests (pure).
//
//  A manifest is an IDENTITY document: what it cannot declare must be visible as
//  a gap path, never replaced by a plausible default. These tests lock the
//  normalization, the gap list, and the fingerprint stability that makes two
//  runs comparable.
// =============================================================================

const T0 = 1_790_000_000_000

const fullInput = () => ({
  kind: 'session' as const,
  source: 'paper' as const,
  purpose: 'paper-executor',
  engineVersion: '0.5.0',
  methods: ['vsa'],
  strategyVersionId: 'sv_1',
  paramsHash: 'ph_1',
  method: 'vsa',
  riskFingerprint: 'rf_1',
  riskSource: 'env',
  dataSource: 'venue-rest',
  dataHash: 'dh_1',
  qualityState: 'ok',
  datasetIds: ['ds_1'],
  asOf: T0,
  inputCutoff: T0 - 1000,
  account: 'default',
  instruments: ['BTCUSDT'],
  timeframes: ['15m'],
  createdAt: T0
})

const full = () => buildManifest(fullInput())

describe('manifest — build + normalize', () => {
  test('declares all five sections with the v1 schema', () => {
    const m = full()
    assert.equal(m.schema, MANIFEST_SCHEMA_VERSION)
    for (const section of MANIFEST_SECTIONS) assert.ok(m[section], `missing section ${section}`)
    assert.deepEqual(m.engine.methods, ['vsa'])
    assert.deepEqual(m.scope.instruments, ['BTCUSDT'])
    assert.equal(m.risk.fingerprint, 'rf_1')
    assert.equal(m.data.inputCutoff, T0 - 1000)
    assert.equal(m.createdAt, T0)
  })

  test('completes with zero gaps and reports itself as a v1 manifest', () => {
    const m = full()
    assert.deepEqual(m.gaps, [])
    assert.deepEqual(manifestGaps(m), [])
    assert.equal(isManifest(m), true)
  })

  test('never invents identity: missing fields become dotted gap paths', () => {
    const m = buildManifest({ kind: 'session', source: 'paper' })
    assert.equal(m.engine.version, null)
    assert.equal(m.strategy.versionId, null)
    assert.ok(m.gaps.includes('engine.version'))
    assert.ok(m.gaps.includes('strategy.versionId'))
    assert.ok(m.gaps.includes('risk.fingerprint'))
    assert.deepEqual(essentialGaps(m), ['engine.version', 'data.source'])
  })

  test('run manifests require the param stamp, session manifests require a version', () => {
    const run = buildManifest({ kind: 'run', source: 'backtest', engineVersion: '0.5.0', dataSource: 'venue-rest' })
    assert.ok(run.gaps.includes('strategy.paramsHash'))
    assert.ok(!run.gaps.includes('risk.fingerprint'))

    const session = buildManifest({ kind: 'session', source: 'paper', engineVersion: '0.5.0', dataSource: 'venue-rest' })
    assert.ok(session.gaps.includes('strategy.versionId'))
    assert.ok(session.gaps.includes('risk.fingerprint'))
  })

  test('unknown kinds/sources are dropped, not guessed', () => {
    const m = buildManifest({ kind: 'backtest-run', source: 'script' })
    assert.equal(m.kind, 'session')
    assert.equal(m.source, null)
    assert.equal(MANIFEST_SOURCES.includes(m.source as never), false)
  })

  test('arrays are deduped and strings normalized', () => {
    const m = buildManifest({ instruments: ['BTC', ' BTC ', '', null, 'ETH'], timeframes: ['15m', '15m'] })
    assert.deepEqual(m.scope.instruments, ['BTC', 'ETH'])
    assert.deepEqual(m.scope.timeframes, ['15m'])
  })
})

describe('manifest — fingerprint', () => {
  test('is stable for equal identity, independent of createdAt', () => {
    const a = full()
    const b = buildManifest({ ...fullInput(), createdAt: T0 + 60_000 })
    assert.equal(a.fingerprint, b.fingerprint)
    assert.match(a.fingerprint!, /^mf1_[0-9a-f]{40}$/)
  })

  test('changes when the identity changes', () => {
    const a = full()
    const b = buildManifest({ ...fullInput(), strategyVersionId: 'sv_2' })
    const c = buildManifest({ ...fullInput(), dataHash: 'dh_2' })
    assert.notEqual(a.fingerprint, b.fingerprint)
    assert.notEqual(a.fingerprint, c.fingerprint)
  })

  test('ignores scope instance ids — the same identity on two bots is comparable', () => {
    const a = full()
    const b = buildManifest({ ...fullInput(), instanceId: 'bot_1' })
    assert.equal(manifestFingerprint(a), manifestFingerprint(b))
  })
})

describe('manifest — sessions', () => {
  test('manifestFromSession returns only v1 documents', () => {
    const m = full()
    assert.equal(manifestFromSession({ manifest: m }), m)
    assert.equal(manifestFromSession({ manifest: { account: 'default', source: 'paper-executor' } }), null)
    assert.equal(manifestFromSession({}), null)
  })

  test('legacy sessions are explained, not upgraded', () => {
    const note = legacyManifestNote({ manifest: { account: 'default', source: 'paper-executor' } })
    assert.ok(note && note.includes('predates manifest.v1'))
    assert.equal(legacyManifestNote({ manifest: full() }), null)
    assert.equal(legacyManifestNote({}), null)
  })

  test('validationScope carries only the experiment linkage', () => {
    const m = full()
    const s = validationScope({ ...(m as any), scope: { ...m.scope, purpose: 'paper-validation', experimentId: 'exp_1', evidenceSetId: 'set_1' } })
    assert.equal(s.purpose, 'paper-validation')
    assert.equal(s.experimentId, 'exp_1')
    assert.equal(s.evidenceSetId, 'set_1')
    assert.deepEqual(s.instruments, ['BTCUSDT'])
    const empty = validationScope(null)
    assert.equal(empty.purpose, 'paper-validation')
    assert.equal(empty.experimentId, null)
  })
})
