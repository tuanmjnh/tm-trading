import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EVIDENCE_LINK_SCHEMA_VERSION,
  bundleCitations,
  graphDigest,
  graphIds,
  graphLimitations,
  linkSummary
} from '../engine/evidenceGraph.mjs'
import { buildEvidenceBundle, freezeEvidenceSet } from '../engine/evidence.mjs'
import { EvidenceError } from '../server/utils/evidenceSets'
import { getSessionEvidenceGraph } from '../server/utils/evidenceGraph'

// =============================================================================
//  Phase F — session evidence graph.
//
//  The graph is what makes "reconstruct one session from persisted evidence"
//  checkable: citations must name real record ids, the digest must be stable,
//  and missing links must be reported as gaps. Service tests inject every model
//  and the preview/journal readers, so nothing here needs Mongo.
// =============================================================================

const T0 = 1_790_000_000_000
type Row = Record<string, any>

const leanMany = (rows: Row[]) => ({
  limit: () => ({ lean: async () => rows }),
  sort: () => ({ limit: () => ({ lean: async () => rows }) }),
  lean: async () => rows
})

const modelStub = (opts: { one?: Row | null; rows?: Row[] } = {}) => ({
  findOne: () => ({ lean: async () => opts.one ?? null }),
  find: () => leanMany(opts.rows ?? []),
  updateOne: async () => ({ acknowledged: true }),
  create: async (doc: Row) => doc
})

const loader = (m: Row | null) => (async () => m) as never

const sessionDoc = (over: Row = {}): Row => ({
  _id: 'ses_1',
  sessionId: 'ses_1',
  kind: 'live-paper',
  state: 'completed',
  accountId: 'default',
  strategyVersionId: 'tm-vsa@1.4.0',
  instruments: ['BTCUSDT'],
  timeframes: ['60'],
  startedAt: T0,
  stoppedAt: T0 + 3_600_000,
  manifest: {
    schema: 'manifest.v1',
    kind: 'session',
    scope: { purpose: 'paper-executor', experimentId: 'exp_1' },
    engine: { version: '0.5.0' },
    strategy: { versionId: 'tm-vsa@1.4.0', paramsHash: 'ph1' },
    data: { source: 'venue-rest', dataHash: 'dh1' },
  },
  ...over
})

const position = (over: Row = {}): Row => ({
  _id: 'pos_1',
  symbol: 'BTCUSDT',
  dir: 1,
  qty: 0.1,
  entryPrice: 60_000,
  exitPrice: 61_200,
  sl: 59_400,
  entryTime: new Date(T0),
  exitTime: new Date(T0 + 600_000),
  pnlAbs: 120,
  fees: 2,
  exitReason: 'data:tp',
  status: 'closed',
  externalId: 'ord_1:0',
  sessionId: 'ses_1',
  ...over
})

const journalRow = (over: Row = {}): Row => ({
  key: 'j1_abc',
  ownerId: 'alice',
  source: 'paper',
  sourceId: 'ord_1:0',
  symbol: 'BTCUSDT',
  result: 'TP',
  rMultiple: 2,
  pnlAbs: 120,
  entryTime: new Date(T0),
  exitTime: new Date(T0 + 600_000),
  ...over
})

const orderRow = (over: Row = {}): Row => ({ _id: 'o1', clientOrderId: 'ord_1', status: 'filled', symbol: 'BTCUSDT', side: 'BUY', sessionId: 'ses_1', ...over })
const fillRow = (over: Row = {}): Row => ({ _id: 'f1', fillId: 'fill_1', qty: 0.1, price: 60_000, fee: 2, sessionId: 'ses_1', ...over })
const newsRow = (over: Row = {}): Row => ({ _id: 'nv_1', setId: 'nv_1', purpose: 'evaluation', asOf: new Date(T0), symbols: ['BTCUSDT'], itemIds: ['n1'], usedByExperimentIds: ['exp_1'], ...over })
const experimentRow = (over: Row = {}): Row => ({ _id: 'exp_1', experimentId: 'exp_1', status: 'paper_validation', strategyVersionId: 'tm-vsa@2.0.0', baselineVersionId: 'tm-vsa@1.4.0', evidenceSetId: 'ev_paper-session_ses_1', ...over })

function bundleOf(over: Row = {}) {
  return buildEvidenceBundle({
    kind: 'paper-session',
    sourceId: 'ses_1',
    session: sessionDoc(),
    positions: [position()],
    orders: [orderRow()],
    fills: [fillRow()],
    journalKeys: ['j1_abc'],
    frozenAt: T0 + 7_200_000,
    ...over
  } as never) as Row
}

function deps(over: Row = {}) {
  return {
    sessionModel: loader(modelStub({ one: sessionDoc() })),
    preview: async () => bundleOf(),
    journal: async () => [journalRow()],
    setIdFor: async () => 'ev_paper-session_ses_1',
    orderModel: loader(modelStub({ rows: [orderRow()] })),
    fillModel: loader(modelStub({ rows: [fillRow()] })),
    newsModel: loader(modelStub({ rows: [newsRow()] })),
    experimentModel: loader(modelStub({ rows: [experimentRow()] })),
    evidenceSetModel: loader(modelStub({ one: null, rows: [] })),
    ...over
  } as never
}

describe('evidence graph — pure links', () => {
  test('citations name the actual record ids', () => {
    const c = bundleCitations(bundleOf())
    assert.equal(c.evidenceSetId, 'ev_paper-session_ses_1')
    assert.equal(c.sessionId, 'ses_1')
    assert.deepEqual(c.orderKeys, ['ord_1'])
    assert.deepEqual(c.fillKeys, ['fill_1'])
    assert.deepEqual(c.positionKeys, ['pos_1'])
    assert.deepEqual(c.journalKeys, ['j1_abc'])
  })

  test('summary reports counts and names missing links', () => {
    const s = linkSummary({ bundle: bundleOf(), journal: [journalRow()], news: [newsRow()], experiments: [experimentRow()], relatedSets: [] })
    assert.equal(s.schema, EVIDENCE_LINK_SCHEMA_VERSION)
    assert.equal(s.counts.journal, 1)
    assert.equal(s.counts.news, 1)
    assert.equal(s.counts.experiments, 1)
    assert.deepEqual(s.missing, ['related-sets'])
    assert.deepEqual(s.citations.newsSetIds, ['nv_1'])
  })

  test('missing links are limitations, not silence', () => {
    const l = graphLimitations({ bundle: bundleOf(), journal: [], news: [], experiments: [], relatedSets: [] })
    assert.ok(l.some((x: string) => x.includes('no journal rows')))
    assert.ok(l.some((x: string) => x.includes('no news evidence set')))
    assert.ok(l.some((x: string) => x.includes('no experiment cites')))
    const live = graphLimitations({ bundle: { ...bundleOf(), frozen: false }, journal: [journalRow()], news: [newsRow()], experiments: [experimentRow()], relatedSets: [{}] })
    assert.ok(live.some((x: string) => x.includes('LIVE PREVIEW')))
  })

  test('digest is deterministic and carries record ids', () => {
    const input = { session: sessionDoc(), bundle: bundleOf(), orders: [orderRow()], fills: [fillRow()], journal: [journalRow()], news: [newsRow()], experiments: [experimentRow()], relatedSets: [] }
    const a = graphDigest(input)
    const b = graphDigest({ ...input, journal: [...(input.journal as Row[])].reverse() })
    assert.equal(a, b)
    assert.ok(a.includes('session ses_1'))
    assert.ok(a.includes('order ord_1'))
    assert.ok(a.includes('fill fill_1'))
    assert.ok(a.includes('trade pos_1'))
    assert.ok(a.includes('journal j1_abc'))
    assert.ok(a.includes('news nv_1'))
    assert.ok(a.includes('experiment exp_1'))
    assert.ok(a.includes('missing related-sets'))
  })

  test('the citation allowlist is exactly the graph ids', () => {
    const ids = graphIds({ bundle: bundleOf(), journal: [journalRow()], news: [newsRow()], experiments: [experimentRow()], relatedSets: [] })
    for (const id of ['ses_1', 'ev_paper-session_ses_1', 'ord_1', 'fill_1', 'pos_1', 'j1_abc', 'nv_1', 'exp_1']) {
      assert.ok(ids.includes(id), `missing ${id}`)
    }
    assert.ok(!ids.includes('made_up_row'))
  })
})

describe('evidence graph — service', () => {
  test('unknown session is a 404, never an empty graph', async () => {
    await assert.rejects(
      () => getSessionEvidenceGraph('ses_missing', deps({ sessionModel: loader(modelStub({ one: null })) })),
      (err: unknown) => (err as EvidenceError).statusCode === 404 && (err as EvidenceError).statusMessage === 'session_not_found'
    )
  })

  test('reconstructs an unfrozen session as a labelled preview', async () => {
    const g = await getSessionEvidenceGraph('ses_1', deps(), 'alice')
    assert.equal(g.mongo, 'partial')
    assert.equal(g.evidenceSet, null)
    assert.equal(g.bundle.setId, 'ev_paper-session_ses_1')
    assert.equal(g.journal.length, 1)
    assert.equal(g.news.length, 1)
    assert.equal(g.experiments.length, 1)
    assert.equal(g.links.counts.journal, 1)
    assert.ok(g.limitations.some((l) => l.includes('LIVE PREVIEW')))
    assert.ok(g.digest.includes('journal j1_abc'))
    assert.ok(g.ids.includes('j1_abc'))
    assert.deepEqual(g.pointInTime, { frozenAt: T0 + 7_200_000, sessionStartedAt: T0, sessionStoppedAt: T0 + 3_600_000 })
  })

  test('a frozen set is used as-is and related sets are listed', async () => {
    const frozen = freezeEvidenceSet(bundleOf()) as Row
    const related = { _id: 'ev_backtest-run_r1', setId: 'ev_backtest-run_r1', kind: 'backtest-run', metrics: { trades: 30 } }
    const g = await getSessionEvidenceGraph('ses_1', deps({
      setIdFor: async () => String(frozen._id),
      evidenceSetModel: loader(modelStub({ one: frozen, rows: [related] }))
    }), 'alice')
    assert.equal(g.mongo, 'up')
    assert.equal(g.evidenceSet?.integrity.ok, true)
    assert.equal(g.relatedSets.length, 1)
    assert.equal(g.links.counts.relatedSets, 1)
    assert.ok(!g.limitations.some((l) => l.includes('LIVE PREVIEW')))
    assert.ok(g.digest.includes('frozen=yes'))
  })
})
