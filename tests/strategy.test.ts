import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VERSION_STATES, parseSemver, bumpVersion, versionIdFor,
  versionFingerprint, strategyVersionRecord, sameFingerprint, assertUnchanged,
  transitionVersion, applyChanges,
} from '../engine/strategy.mjs'
import {
  createVersion, promoteVersion, planNewVersion, resolveLiveVersion, activatePaper,
} from '../engine/strategyService.mjs'

// =============================================================================
//  §29 Strategy Version Lifecycle — immutability + evidence-gated promotions.
//  Pure, offline. "New parameters = new version" is the whole game.
// =============================================================================

const baseDoc = () => strategyVersionRecord({
  strategyId: 'tm-vsa', version: '1.4.0', paramsHash: 'ph-base',
  engineVersion: '0.9.0', parameters: { minRR: 1.5 }, createdBy: 'tuan', now: 100,
})

describe('semver + identity (§29)', () => {
  test('parseSemver is strict; bump handles major/minor/patch', () => {
    assert.deepEqual(parseSemver('1.4.0'), { major: 1, minor: 4, patch: 0 })
    assert.equal(parseSemver('1.4'), null)
    assert.equal(bumpVersion('1.4.0', 'patch'), '1.4.1')
    assert.equal(bumpVersion('1.4.0', 'minor'), '1.5.0')
    assert.equal(bumpVersion('1.4.0', 'major'), '2.0.0')
    assert.equal(bumpVersion('bogus', 'patch'), null)
    assert.equal(versionIdFor('tm-vsa', '1.4.0'), 'tm-vsa@1.4.0')
    assert.equal(versionIdFor('tm-vsa', '1.4'), null)
  })

  test('VERSION_STATES is the §29 chain', () => {
    assert.deepEqual(VERSION_STATES, ['draft', 'backtest', 'holdout', 'paper', 'stable_paper', 'archived'])
  })
})

describe('immutability (fingerprint)', () => {
  test('record builds a draft with a stable fingerprint; changing any identity field changes it', () => {
    const a = baseDoc()
    assert.equal(a.status, 'draft')
    assert.equal(versionFingerprint(a), versionFingerprint({ ...a }))
    assert.equal(versionFingerprint(a), versionFingerprint(baseDoc()))
    assert.notEqual(versionFingerprint(a), versionFingerprint({ ...a, version: '1.4.1' }))
    assert.notEqual(versionFingerprint(a), versionFingerprint({ ...a, parameters: { minRR: 2 } }))
    assert.notEqual(versionFingerprint(a), versionFingerprint({ ...a, paramsHash: 'ph-other' }))
  })

  test('same params in different key order fingerprint identically (canonical)', () => {
    const a = strategyVersionRecord({ strategyId: 's', version: '1.0.0', paramsHash: 'h', parameters: { a: 1, b: 2 } })
    const b = strategyVersionRecord({ strategyId: 's', version: '1.0.0', paramsHash: 'h', parameters: { b: 2, a: 1 } })
    assert.equal(versionFingerprint(a), versionFingerprint(b))
  })

  test('assertUnchanged: identical = replay OK; different = refuse in-place edit', () => {
    const a = baseDoc()
    assert.deepEqual(assertUnchanged(null, a), { ok: true })
    assert.equal(assertUnchanged(a, a).ok, true)
    assert.equal(assertUnchanged(a, { ...a, version: '1.4.1' }).code, 'SV_IMMUTABLE_CHANGE')
  })

  test('missing id fields -> null record (no anonymous version)', () => {
    assert.equal(strategyVersionRecord({ strategyId: 's', version: '1.0.0' }), null) // no paramsHash
    assert.equal(strategyVersionRecord({ strategyId: 's', version: '1.0', paramsHash: 'h' }), null) // bad semver
  })
})

describe('promotion (§29) — evidence-gated', () => {
  const mk = () => baseDoc()

  test('draft -> backtest requires a backtestRunId', () => {
    assert.equal(transitionVersion(mk(), 'backtest').code, 'SV_EVIDENCE_MISSING:backtestRunId')
    const ok = transitionVersion(mk(), 'backtest', { evidence: { backtestRunId: 'run_1' } })
    assert.equal(ok.ok, true)
    assert.equal(ok.version.backtestRunId, 'run_1')
  })

  test('full happy path: draft->backtest->holdout->paper->stable_paper->archived', () => {
    let v = mk()
    v = transitionVersion(v, 'backtest', { evidence: { backtestRunId: 'r1' } }).version
    v = transitionVersion(v, 'holdout', { evidence: { holdoutRunId: 'r2' } }).version
    v = transitionVersion(v, 'paper', { evidence: { acceptedExperimentId: 'exp:1' } }).version
    v = transitionVersion(v, 'stable_paper', { evidence: { paperTrades: 25 } }).version
    v = transitionVersion(v, 'archived', {}).version
    assert.equal(v.status, 'archived')
    assert.equal(v.history.length, 6) // null->draft + 5 moves
  })

  test('illegal jumps refused: draft->paper skipped; archived is terminal', () => {
    assert.equal(transitionVersion(mk(), 'paper').code, 'SV_ILLEGAL:draft->paper')
    const archived = transitionVersion(
      transitionVersion(
        transitionVersion(
          transitionVersion(
            transitionVersion(
              transitionVersion(mk(), 'backtest', { evidence: { backtestRunId: 'r1' } }).version,
              'holdout', { evidence: { holdoutRunId: 'r2' } }).version,
            'paper', { evidence: { acceptedExperimentId: 'e1' } }).version,
          'stable_paper', { evidence: { paperTrades: 30 } }).version,
        'archived', {}).version,
      'paper', {})
    assert.equal(archived.code, 'SV_ILLEGAL:archived->paper')
  })

  test('archived is reachable from any state but requires no evidence', () => {
    for (const s of ['draft', 'backtest', 'holdout', 'paper', 'stable_paper']) {
      let v = mk()
      for (const step of ['backtest', 'holdout', 'paper', 'stable_paper'].slice(0, VERSION_STATES.indexOf(s))) {
        const ev = { backtest: { backtestRunId: 'r' }, holdout: { holdoutRunId: 'r' }, paper: { acceptedExperimentId: 'e' }, stable_paper: { paperTrades: 30 } }
        v = transitionVersion(v, step, { evidence: ev[step] }).version
      }
      assert.equal(transitionVersion(v, 'archived').ok, true, s)
    }
  })

  test('paper requires an accepted experiment (no live without a passed §28 gate)', () => {
    const atHoldout = transitionVersion(
      transitionVersion(mk(), 'backtest', { evidence: { backtestRunId: 'r1' } }).version,
      'holdout', { evidence: { holdoutRunId: 'r2' } },
    ).version
    assert.equal(transitionVersion(atHoldout, 'paper').code, 'SV_EVIDENCE_MISSING:acceptedExperimentId')
    assert.equal(transitionVersion(atHoldout, 'paper', { evidence: { acceptedExperimentId: 'exp:1' } }).ok, true)
  })
})

describe('applyChanges — new parameters = new version', () => {
  const base = { minRR: 1.5, tpR: 2 }

  test('a change whose `from` matches the base is applied; a mismatch is refused, never silent', () => {
    const r = applyChanges(base, [
      { parameter: 'minRR', from: 1.5, to: 2 },
      { parameter: 'tpR', from: 99, to: 3 }, // mismatch: base is 2
    ])
    assert.deepEqual(r.applied, [{ parameter: 'minRR', from: 1.5, to: 2 }])
    assert.equal(r.refused.length, 1)
    assert.equal(r.refused[0].parameter, 'tpR')
    assert.equal(r.params.minRR, 2)
    assert.equal(r.params.tpR, 2) // unchanged
  })

  test('additive + null-out changes work; missing parameter names refused', () => {
    const r = applyChanges(base, [
      { parameter: 'newFlag', from: null, to: true },
      { parameter: 'tpR', from: 2, to: null },
      { bogus: true },
    ])
    assert.equal(r.params.newFlag, true)
    assert.equal(r.params.tpR, null)
    assert.equal(r.refused.length, 1)
  })
})

describe('strategyService (IO fail-soft)', () => {
  test('without MONGODB_URI every op fails softly, never throws', async () => {
    assert.equal((await createVersion({ strategyId: 's', version: '1.0.0', paramsHash: 'h' })).code, 'MONGO_DOWN')
    assert.equal((await promoteVersion('s@1.0.0', 'backtest')).code, 'SV_NOT_FOUND')
    assert.equal((await planNewVersion({ strategyVersionId: 's@1.0.0' })).code, 'SV_NOT_FOUND')
    assert.equal((await activatePaper({ profileId: 'p', strategyVersionId: 's@1.0.0' })).code, 'MONGO_DOWN')
    assert.equal(await resolveLiveVersion({}), null)
  })
})