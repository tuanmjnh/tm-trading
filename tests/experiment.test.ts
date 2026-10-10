import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIMENT_STATES, TERMINAL_STATES, ARM_NAMES,
  experimentIdFor, experimentFromProposal, transition, armMetrics,
  compareArms, acceptanceReport, withArm, EXPERIMENT_SCHEMA_VERSION,
} from '../engine/experiment.mjs'

// =============================================================================
//  §28 Experiment Engine — state machine + arms comparison + §28.3 gate.
//  Pure, offline. summarizeRuns-shaped summaries in, verdicts out.
// =============================================================================

const summary = (o = {}) => ({
  trades: 100, wins: 50, losses: 50, open: 0,
  winRate: 0.5, profitFactor: 1.4, expectancy: 0.25, avgRr: 0.25, medianRr: 0.1,
  netPct: 25, maxDrawdownPct: 8, degenerateRisk: 0,
  paramsHash: 'ph-base', engineVersion: '0.9.0', ...o,
})
const expWith = (arms = {}) => ({
  _id: 'exp:x', status: 'proposed',
  arms: Object.fromEntries(Object.entries(arms).map(([name, s]) => [name, { name, metrics: armMetrics(s) }])),
  history: [],
})

describe('lifecycle (§28.1)', () => {
  test('EXPERIMENT_STATES and terminal states match the roadmap chain', () => {
    assert.deepEqual(EXPERIMENT_STATES, ['proposed', 'approved', 'running', 'backtested', 'holdout', 'paper_validation', 'accepted', 'rejected'])
    assert.deepEqual(TERMINAL_STATES, ['accepted', 'rejected'])
    assert.deepEqual(ARM_NAMES, ['baseline', 'candidate', 'random', 'holdout'])
  })

  test('legal forward moves; no skipping, no backwards, nothing leaves terminal', () => {
    let doc = { status: 'proposed', history: [] }
    for (const s of ['approved', 'running', 'backtested', 'holdout', 'paper_validation', 'accepted']) {
      const r = transition(doc, s, { at: 1 })
      assert.equal(r.ok, true, `${doc.status}->${s}`)
      doc = r.exp
    }
    assert.equal(transition(doc, 'running').ok, false) // nothing leaves accepted
    const skip = transition({ status: 'proposed', history: [] }, 'backtested')
    assert.equal(skip.ok, false)
    assert.match(skip.code, /EXP_ILLEGAL/)
    const back = transition({ status: 'running', history: [] }, 'proposed')
    assert.equal(back.ok, false)
  })

  test('rejected is reachable from every non-terminal state', () => {
    for (const s of EXPERIMENT_STATES.filter((x) => !TERMINAL_STATES.includes(x))) {
      assert.equal(transition({ status: s, history: [] }, 'rejected').ok, true, s)
    }
    assert.equal(transition({ status: 'rejected', history: [] }, 'rejected').code, 'EXP_ILLEGAL:rejected->rejected')
  })

  test('bad state name refused; history appended with from/to/at', () => {
    assert.equal(transition({ status: 'proposed', history: [] }, 'teleported').code, 'EXP_BAD_STATE:teleported')
    const r = transition({ status: 'proposed', history: [] }, 'approved', { at: 7 })
    assert.deepEqual(r.exp.history.slice(-1), [{ from: 'proposed', to: 'approved', at: 7 }])
  })
})

describe('ids + proposal import (§27.3 -> §28)', () => {
  test('experimentIdFor deterministic and null without proposalId', () => {
    const a = experimentIdFor({ proposalId: 'p1', paramsHash: 'ph' })
    assert.equal(a, experimentIdFor({ proposalId: 'p1', paramsHash: 'ph' }))
    assert.notEqual(a, experimentIdFor({ proposalId: 'p2', paramsHash: 'ph' }))
    assert.equal(experimentIdFor({}), null)
  })

  test('experimentFromProposal maps the §27.3 fields and stamps history', () => {
    const p = {
      proposalId: 'p1', strategyVersionId: 'tm-vsa@1.4.0', hypothesis: 'raise minRRR',
      changes: [{ parameter: 'minRRR', from: 1.5, to: 2 }],
      evidence: [{ metric: 'expectancyR', value: 0.4, sampleSize: 90 }],
      risks: ['small sample'], recommendedTest: { symbols: ['BTCUSDT'] },
    }
    const e = experimentFromProposal(p, { now: 5 })
    assert.equal(e.status, 'proposed')
    assert.equal(e.proposalId, 'p1')
    assert.equal(e.changes[0].parameter, 'minRRR')
    assert.equal(e.schemaVersion, EXPERIMENT_SCHEMA_VERSION)
    assert.equal(e.history.length, 1)
    assert.equal(experimentFromProposal(null), null)
  })
})

describe('arms + compare (§28.2)', () => {
  test('armMetrics passes through summary numbers; missing -> null doc', () => {
    const m = armMetrics({ summary: summary() })
    assert.equal(m.expectancyR, 0.25)
    assert.equal(m.paramsHash, 'ph-base')
    assert.equal(armMetrics(null), null)
    assert.equal(armMetrics(42), null)
  })

  test('compareArms orders arms and computes candidate-minus-baseline delta', () => {
    const arms = [
      { name: 'candidate', metrics: armMetrics(summary({ expectancy: 0.3, maxDrawdownPct: 10, paramsHash: 'ph-cand' })) },
      { name: 'baseline', metrics: armMetrics(summary()) },
    ]
    const c = compareArms(arms, { requireHoldout: false })
    assert.deepEqual(c.present, ['baseline', 'candidate']) // canonical order regardless of input
    assert.ok(Math.abs(c.delta.expectancyR - 0.05) < 1e-9)
    assert.equal(c.complete, true) // random optional by default
    assert.equal(c.missing.includes('holdout'), false)
  })

  test('missing required arms reported; null metrics produce null deltas', () => {
    const c = compareArms([{ name: 'baseline', metrics: armMetrics(summary()) }], { requireRandom: true, requireHoldout: true })
    assert.equal(c.complete, false)
    assert.deepEqual(c.missing.sort(), ['holdout', 'random'])
    assert.equal(c.delta.expectancyR, null)
  })

  test('withArm attaches metrics and refuses unknown arms', () => {
    const base = expWith()
    const r = withArm(base, 'candidate', { summary: summary() }, { at: 9 })
    assert.equal(r.ok, true)
    assert.equal(r.exp.arms.candidate.metrics.paramsHash, 'ph-base')
    assert.equal(withArm(base, 'winner', { summary: summary() }).code, 'EXP_BAD_ARM:winner')
    assert.equal(withArm(null, 'baseline', {}).ok, false)
  })
})

describe('acceptance gate (§28.3)', () => {
  const goodExp = () => expWith({
    baseline: summary(),
    candidate: summary({ expectancy: 0.4, avgRr: 0.4, maxDrawdownPct: 9, paramsHash: 'ph-cand' }),
    holdout: summary({ expectancy: 0.4 }),
  })

  test('all gates green -> ok', () => {
    const r = acceptanceReport(goodExp())
    assert.equal(r.ok, true, JSON.stringify(r.gates.filter((x) => !x.pass)))
  })

  test('each failure names its gate', () => {
    const worse = expWith({ baseline: summary(), candidate: summary({ expectancy: 0.1, avgRr: 0.1 }) })
    const r = acceptanceReport(worse)
    assert.equal(r.ok, false)
    const failed = r.gates.filter((x) => !x.pass).map((x) => x.key)
    assert.ok(failed.includes('beatBaseline'))
    assert.ok(failed.includes('holdout'))
  })

  test('sample size and degeneracy are hard gates', () => {
    const small = expWith({
      baseline: summary(),
      candidate: summary({ trades: 5, expectancy: 0.5, avgRr: 0.5, degenerateRisk: 4 }),
      holdout: summary({ expectancy: 0.5 }),
    })
    const r = acceptanceReport(small, { minTrades: 30, maxDegenerate: 0 })
    assert.equal(r.ok, false)
    assert.ok(r.gates.some((x) => x.key === 'sampleSize' && !x.pass))
    assert.ok(r.gates.some((x) => x.key === 'noDegeneracy' && !x.pass))
  })

  test('a candidate that does not beat the random baseline is refused', () => {
    const e = expWith({
      baseline: summary({ expectancy: 0.1, avgRr: 0.1 }),
      candidate: summary({ expectancy: 0.2, avgRr: 0.2 }),
      random: summary({ expectancy: 0.3, avgRr: 0.3 }),
      holdout: summary({ expectancy: 0.2 }),
    })
    const r = acceptanceReport(e)
    assert.equal(r.ok, false)
    assert.ok(r.gates.some((x) => x.key === 'beatRandom' && !x.pass))
  })

  test('drawdown regression beyond slack is refused (risk preserved)', () => {
    const e = expWith({
      baseline: summary(),
      candidate: summary({ expectancy: 0.4, avgRr: 0.4, maxDrawdownPct: 50 }),
      holdout: summary({ expectancy: 0.4 }),
    })
    const r = acceptanceReport(e, { ddSlackPct: 5 })
    assert.ok(r.gates.some((x) => x.key === 'riskPreserved' && !x.pass))
  })

  test('a holdout worse than in-sample fails (no in-sample-only edge)', () => {
    const e = expWith({
      baseline: summary(),
      candidate: summary({ expectancy: 0.4, avgRr: 0.4 }),
      holdout: summary({ expectancy: 0.05 }),
    })
    assert.equal(acceptanceReport(e).ok, false)
  })
})