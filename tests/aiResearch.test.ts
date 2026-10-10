import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAiTradeRecord, hydrateAiDataset } from '../ai/dataset.mjs'
import { validateProposal, parseProposalsText, PROPOSAL_SCHEMA_VERSION } from '../ai/proposal.mjs'

// =============================================================================
//  §27 AI Research Layer — dataset builder (joins trade context + snapshots)
//  and structured proposal validation (§27.3). Pure, offline, honest.
// =============================================================================

const tc = () => ({
  tradeContextId: 'tc:1',
  tradeId: 'co_1',
  accountId: 'paper-main',
  strategyVersionId: null,
  method: 'vsa',
  stamp: { engineVersion: '0.9.0', paramsHash: 'ph1', kind: 'declared' },
  symbol: 'BTCUSDT',
  venue: 'binance:fapi',
  timeframe: '15m',
  direction: 'long',
  entrySnapshotId: 'snap:abc',
  exitSnapshotId: 'snap:abc#exit',
  marketRegime: null,
  fundingOi: null,
  newsContext: null,
  execution: { entryPrice: 60000, exitPrice: 61000, holdMs: 600000, fees: 2.2, exitReason: 'data:tp' },
  outcome: { state: 'win', pnlAbs: 498.8, pnlPct: 1.66 },
  recordedAt: 555,
})
const snap = (id, extra = {}) => ({
  snapshotId: id, clockTime: 123, bar: { close: 100, state: 'closed' }, quote: { last: 100.5, time: 123 },
  indicators: null, methods: ['vsa'], regime: { trend: 'up' }, dataQuality: { source: 'binance:kline1m', ageMs: 200 },
  decision: { ok: true, code: 'APPROVED', message: 'gate approved entry' }, ...extra,
})

describe('buildAiTradeRecord (§27.1 dataset)', () => {
  test('joins trade context + both snapshots; strips identity cruft', () => {
    const rec = buildAiTradeRecord({ tradeContext: tc(), entrySnapshot: snap('snap:abc'), exitSnapshot: snap('snap:abc#exit') })
    assert.equal(rec.tradeId, 'co_1')
    assert.equal(rec.identity.symbol, 'BTCUSDT')
    assert.equal(rec.identity.strategyVersionId, null) // honest
    assert.equal(rec.context.entry.bar.close, 100)
    assert.equal(rec.context.entry.regime.trend, 'up')
    assert.equal(rec.context.entry.decision.code, 'APPROVED')
    assert.equal(rec.context.exit.decision.code, 'APPROVED')
    assert.equal(rec.context.marketRegime, null)
    assert.equal(rec.outcome.state, 'win')
    assert.equal(rec.schemaVersion, 'aiRecord.v1')
  })

  test('missing snapshots -> context entries null, never fabricated', () => {
    const rec = buildAiTradeRecord({ tradeContext: tc() })
    assert.equal(rec.context.entry, null)
    assert.equal(rec.context.exit, null)
    assert.equal(rec.execution.exitReason, 'data:tp')
  })

  test('no tradeContext -> null', () => {
    assert.equal(buildAiTradeRecord({}), null)
  })

  test('hydrateAiDataset resolves both snapshot ids via one query', async () => {
    const wanted = new Set(['snap:abc', 'snap:abc#exit'])
    const Snapshot = {
      find(f) {
        assert.ok(f.snapshotId?.$in?.length === 2)
        return { lean: async () => [snap('snap:abc'), snap('snap:abc#exit')] }
      },
    }
    const out = await hydrateAiDataset({ tradeContexts: [tc()], models: { Snapshot } })
    assert.equal(out.length, 1)
    assert.equal(out[0].context.entry.snapshotId, undefined) // identity stripped
    assert.equal(out[0].context.entry.bar.close, 100)
    assert.equal(out[0].context.exit.bar.close, 100)
  })

  test('hydrate without Snapshot model degrades to snapshotless records', async () => {
    const out = await hydrateAiDataset({ tradeContexts: [tc()], models: {} })
    assert.equal(out[0].context.entry, null)
  })
})

describe('validateProposal (§27.3)', () => {
  const good = () => ({
    proposalId: 'p1',
    strategyVersionId: 'tm-vsa@1.4.0',
    hypothesis: 'Raising the min RRR filter to 2.0 should improve expectancy on BTC 15m',
    changes: [{ parameter: 'minRRR', from: 1.5, to: 2.0 }],
    evidence: [{ metric: 'expectancyR', value: 0.42, sampleSize: 120 }],
    risks: ['smaller sample after filter'],
    recommendedTest: { symbols: ['BTCUSDT'], timeframes: ['15m'] },
  })

  test('valid proposal normalizes + stamps schemaVersion', () => {
    const res = validateProposal(good())
    assert.equal(res.ok, true)
    assert.equal(res.proposal.proposalId, 'p1')
    assert.equal(res.proposal.changes[0].parameter, 'minRRR')
    assert.equal(res.proposal.evidence[0].sampleSize, 120)
    assert.equal(res.proposal.schemaVersion, PROPOSAL_SCHEMA_VERSION)
  })

  test('missing hypothesis/proposalId -> rejected with named errors', () => {
    const res = validateProposal({ changes: [] })
    assert.equal(res.ok, false)
    assert.ok(res.errors.some((e) => e.includes('hypothesis')))
    assert.ok(res.errors.some((e) => e.includes('proposalId')))
  })

  test('non-finite evidence value and negative sampleSize are refused', () => {
    const res = validateProposal({ ...good(), evidence: [{ metric: 'x', value: 'abc', sampleSize: -1 }] })
    assert.equal(res.ok, false)
    assert.equal(res.proposal, undefined)
  })

  test('malformed change entries are refused, well-formed ones survive', () => {
    const res = validateProposal({
      ...good(),
      changes: [{ parameter: 'good', from: 1, to: 2 }, { bogus: true }, 'string'],
    })
    assert.equal(res.ok, false)
  })

  test('null / array inputs -> clean rejection, never throw', () => {
    assert.equal(validateProposal(null).ok, false)
    assert.equal(validateProposal([]).ok, false)
  })
})

describe('parseProposalsText (§27.3 LLM output)', () => {
  test('parses a markdown-wrapped proposals array', () => {
    const text = 'Sure!\n```json\n[{"proposalId":"p1","hypothesis":"h","changes":[],"evidence":[],"risks":[]},{"proposalId":"p2","hypothesis":"h2","changes":[],"evidence":[],"risks":[]}]\n```\n'
    const res = parseProposalsText(text)
    assert.equal(res.proposals.length, 2)
    assert.equal(res.errors.length, 0)
  })

  test('object envelope {proposals:[...]} is accepted', () => {
    const res = parseProposalsText(JSON.stringify({ proposals: [{ proposalId: 'p', hypothesis: 'h' }] }))
    assert.equal(res.proposals.length, 1)
  })

  test('invalid JSON -> errors, no throw; single object -> wrapped', () => {
    assert.equal(parseProposalsText('not json').proposals.length, 0)
    assert.ok(parseProposalsText('not json').errors.length > 0)
    const single = parseProposalsText(JSON.stringify({ proposalId: 'only', hypothesis: 'h' }))
    assert.equal(single.proposals.length, 1)
  })

  test('partial validity: one good + one bad -> good kept, bad named', () => {
    const res = parseProposalsText(JSON.stringify([
      { proposalId: 'ok', hypothesis: 'h' },
      { hypothesis: 'missing id' },
    ]))
    assert.equal(res.proposals.length, 1)
    assert.equal(res.proposals[0].proposalId, 'ok')
    assert.ok(res.errors[0].includes('item[1]'))
  })
})

import { main as researchMain } from '../ai/research.mjs'

describe('ai/research.mjs CLI', () => {
  test('--validate accepts a valid proposal and rejects an invalid one', async () => {
    const ok = await researchMain(['--validate', JSON.stringify({ proposalId: 'p', hypothesis: 'h' })])
    assert.equal(ok.ok, true)
    const bad = await researchMain(['--validate', JSON.stringify({})])
    assert.equal(bad.ok, false)
  })

  test('--parse parses markdown-wrapped proposals', async () => {
    const res = await researchMain([
      '--parse',
      '```json\n[{"proposalId":"p","hypothesis":"h","changes":[],"evidence":[],"risks":[]}]\n```',
    ])
    assert.equal(res.proposals.length, 1)
    assert.equal(res.errors.length, 0)
  })

  test('no args -> usage, returns null', async () => {
    const res = await researchMain([])
    assert.equal(res, null)
  })
})