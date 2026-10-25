import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as evidence from '../engine/evidence.mjs'
import {
  EVIDENCE_KINDS,
  EVIDENCE_MIN_TRADES,
  EVIDENCE_SCHEMA_VERSION,
  candidateIndependence,
  buildEvidenceBundle,
  evidenceHash,
  evidenceSetIdFor,
  evidenceSufficiency,
  evidenceTrade,
  freezeEvidenceSet,
  outcomeMetrics,
  paperValidationEdge,
  proposalEvidenceLink,
  verifyEvidenceSet,
} from '../engine/evidence.mjs'
import {
  AUTO_FREEZE_SESSION_STATES,
  EvidenceError,
  autoFreezeSessionEvidence,
  backfillTerminalSessionEvidence,
  citeEvidenceSet,
  createEvidenceSet,
  createPaperValidationSession,
  evidenceHttpError,
  getEvidenceSet,
  listEvidenceSets,
  requireProposalEvidence,
  sessionEvidenceKind
} from '../server/utils/evidenceSets'

// =============================================================================
//  Research Evidence Sets (V3.5 §59.15 Slice E) — offline.
//
//  Two layers are locked here: the PURE rules (deterministic id, content hash,
//  sample-size honesty, AI-output linking) and the SERVICE glue with injected
//  model fakes (no Mongo, no engine backtest, no real session).
// =============================================================================

const T0 = 1_790_000_000_000
type Row = Record<string, any>

// ---------------------------------------------------------------------------
//  Fakes — minimal model chains, exactly what the service calls.
// ---------------------------------------------------------------------------

const leanOne = (row: Row | null) => ({ lean: async () => row })
const leanMany = (rows: Row[]) => ({
  limit: () => ({ lean: async () => rows }),
  sort: () => ({ limit: () => ({ lean: async () => rows }) }),
  lean: async () => rows
})

function modelStub(opts: { one?: Row | null; rows?: Row[]; writeError?: unknown; onCreate?: (doc: Row) => void } = {}) {
  return {
    findOne: () => leanOne(opts.one ?? null),
    find: () => leanMany(opts.rows ?? []),
    updateOne: async () => ({ acknowledged: true }),
    create: async (doc: Row) => {
      if (opts.writeError) throw opts.writeError
      opts.onCreate?.(doc)
      return doc
    }
  }
}

const loader = (m: Row | null) => (async () => m) as never
const nullLoader = (async () => null) as never

const sessionDoc = (over: Row = {}): Row => ({
  _id: 'ses_1',
  sessionId: 'ses_1',
  state: 'completed',
  accountId: 'default',
  strategyVersionId: 'tm-vsa@1.4.0',
  instruments: ['BTCUSDT'],
  timeframes: ['60'],
  startedAt: T0,
  stoppedAt: T0 + 3_600_000,
  manifest: { engineVersion: '1.5.0', paramsHash: 'ph1', datasetIds: ['ds_btc_60'] },
  journalKeys: ['j1'],
  ...over
})

const closedPosition = (over: Row = {}): Row => ({
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
  strategyVersionId: 'tm-vsa@1.4.0',
  sessionId: 'ses_1',
  stamp: { engineVersion: '1.5.0', paramsHash: 'ph1' },
  ...over
})

const evidenceModule = async () => evidence as never

/** A row of the `trades` collection (backtest outcome), not a position. */
const backtestTrade = (over: Row = {}): Row => ({
  _id: `trade_${Math.random().toString(36).slice(2, 8)}`,
  runId: 'run_1',
  paramsHash: 'ph1',
  engineVersion: '1.5.0',
  method: 'vsa',
  symbol: 'BTCUSDT',
  tf: '15',
  dir: 1,
  entryTime: new Date(T0),
  entryPrice: 60_000,
  exitTime: new Date(T0 + 600_000),
  exitPrice: 61_200,
  sl: 59_400,
  result: 'TP',
  barsHeld: 40,
  pnlPct: 2,
  rMultiple: 2,
  ...over,
})

// Loaders return MODELS; the service resolves them per call. Every fake here is
// a loader for that reason — a bare model object is a different (wrong) shape.
const serviceDeps = (over: Record<string, unknown> = {}) => ({
  sessionModel: loader(modelStub({ one: sessionDoc() })),
  evidenceSetModel: loader(modelStub()),
  orderModel: loader(modelStub()),
  fillModel: loader(modelStub()),
  positionModel: loader(modelStub({ rows: [closedPosition()] })),
  profileModel: loader(modelStub()),
  experimentModel: loader(modelStub()),
  evidence: evidenceModule,
  ...over
})

/**
 * Produce a frozen set by running the REAL service (with a create-capturing
 * store), so a fixture can never drift from what the service actually writes —
 * a hand-built bundle hides exactly the divergence these tests must catch.
 */
async function frozenVia(over: Record<string, unknown> = {}): Promise<Row> {
  let wrote: Row | null = null
  const doc = await createEvidenceSet(
    { kind: 'paper-session', sourceId: 'ses_1' },
    serviceDeps({ ...over, evidenceSetModel: loader(modelStub({ onCreate: (d) => { wrote = d } })) }),
  )
  return (wrote ?? doc) as Row
}

// ---------------------------------------------------------------------------

describe('evidence identity — one set per source (D3)', () => {
  test('the id is deterministic and namespaced by kind', () => {
    assert.equal(evidenceSetIdFor({ kind: 'paper-session', sourceId: 'ses_1' }), 'ev_paper-session_ses_1')
    assert.equal(
      evidenceSetIdFor({ kind: 'paper-session', sourceId: 'ses_1' }),
      evidenceSetIdFor({ kind: 'paper-session', sourceId: 'ses_1' }),
    )
    assert.notEqual(
      evidenceSetIdFor({ kind: 'paper-session', sourceId: 'ses_1' }),
      evidenceSetIdFor({ kind: 'replay-session', sourceId: 'ses_1' }),
    )
  })

  test('bad kinds and empty sources are refused', () => {
    assert.deepEqual([...EVIDENCE_KINDS], ['paper-session', 'replay-session', 'backtest-run', 'dataset'])
    assert.throws(() => evidenceSetIdFor({ kind: 'vibes', sourceId: 'x' }), /kind must be/)
    assert.throws(() => evidenceSetIdFor({ kind: 'paper-session', sourceId: '  ' }), /sourceId is required/)
  })
})

describe('trades -> measured outcome (D12: nothing fabricated)', () => {
  test('a trade row keeps nulls and measures R from dir/sl/exit', () => {
    const t = evidenceTrade(closedPosition())
    assert.equal(t.symbol, 'BTCUSDT')
    assert.equal(t.dir, 1)
    assert.equal(t.entryTime, T0)
    assert.equal(t.rMultiple, 2) // (61200-60000)/(60000-59400) = 2R
    assert.equal(t.paramsHash, 'ph1')

    const partial = evidenceTrade({ _id: 'p2', symbol: 'ETHUSDT', dir: 1, entryPrice: 1000, qty: 1 })
    assert.equal(partial.exitPrice, null)
    assert.equal(partial.pnlAbs, null)
    assert.equal(partial.rMultiple, null) // no exit -> no R, never 0
  })

  test('metrics stay null when nothing measurable exists', () => {
    const m = outcomeMetrics([])
    assert.equal(m.trades, 0)
    assert.equal(m.winRate, null)
    assert.equal(m.expectancyR, null)
    assert.equal(m.netPnlAbs, null)
    assert.equal(m.sufficient, false)
  })

  test('win rate and expectancy come from measured R only', () => {
    const trades = [
      evidenceTrade(closedPosition({ _id: 'a' })),                       // +2R
      evidenceTrade(closedPosition({ _id: 'b', dir: -1, entryPrice: 60_000, exitPrice: 60_600, sl: 60_600 })), // -1R (sl == entry -> div by 0 guard)
      evidenceTrade({ _id: 'c', symbol: 'BTCUSDT', dir: 1, entryPrice: 1, qty: 1 }), // unmeasurable
    ]
    const m = outcomeMetrics(trades)
    assert.equal(m.trades, 3) // every closed trade counts as sample size
    assert.equal(m.rMeasured, 2) // but only two had a measured outcome
    assert.equal(m.wins, 1)
    assert.equal(m.losses, 1)
    assert.equal(m.winRate, 0.5)
    assert.equal(m.sufficient, false)
    assert.ok(m.netPnlAbs !== null)
    // 20 unmeasurable rows still prove nothing
    const unmeasurable = Array.from({ length: 25 }, (_, i) => evidenceTrade({ _id: `u${i}`, dir: 1, entryPrice: 1, qty: 1 }))
    assert.equal(outcomeMetrics(unmeasurable).trades, 25)
    assert.equal(outcomeMetrics(unmeasurable).sufficient, false)
  })

  test('the sufficiency floor is the journal floor', () => {
    assert.equal(EVIDENCE_MIN_TRADES, 20)
    const many = Array.from({ length: EVIDENCE_MIN_TRADES }, (_, i) => evidenceTrade(closedPosition({ _id: `p${i}` })))
    assert.equal(outcomeMetrics(many).sufficient, true)
    assert.equal(outcomeMetrics(many.slice(0, EVIDENCE_MIN_TRADES - 1)).sufficient, false)
  })
})

describe('bundle + freeze + hash', () => {
  const bundleOf = (over: Row = {}) => buildEvidenceBundle({
    kind: 'paper-session',
    sourceId: 'ses_1',
    session: sessionDoc(),
    positions: [closedPosition()],
    orders: [{ clientOrderId: 'c1' }],
    fills: [{ fillId: 'f1' }],
    datasetIds: ['ds_btc_60'],
    frozenAt: T0,
    ...over,
  })

  test('a sealed session bundle records counts, keys and the manifest', () => {
    const b = bundleOf()
    assert.equal(b.setId, 'ev_paper-session_ses_1')
    assert.equal(b.sealed, true)
    assert.equal(b.counts.trades, 1)
    assert.deepEqual(b.counts, { orders: 1, fills: 1, trades: 1 })
    assert.deepEqual(b.keys.orderKeys, ['c1'])
    assert.deepEqual(b.keys.fillKeys, ['f1'])
    assert.deepEqual(b.keys.journalKeys, ['j1'])
    assert.deepEqual(b.dataQuality.datasets, ['ds_btc_60'])
    assert.equal(b.pointInTime.frozenAt, T0)
    assert.equal(b.pointInTime.sessionStoppedAt, T0 + 3_600_000)
    assert.deepEqual(b.limitations, [`only 1/1 closed trade(s) had a measured R; the evidence floor is ${EVIDENCE_MIN_TRADES}`])
  })

  test('a running session and a missing manifest are stated as limitations', () => {
    const b = bundleOf({ session: sessionDoc({ state: 'running', manifest: null }) })
    assert.equal(b.sealed, false)
    assert.ok(b.limitations.some((l: string) => l.includes('still moving')))
    assert.ok(b.limitations.some((l: string) => l.includes('no versioned manifest')))
    assert.equal(evidenceSufficiency(b).sufficient, false)
  })

  test('the hash is content-addressed: same facts -> same hash, one edit -> different', () => {
    assert.equal(evidenceHash(bundleOf()), evidenceHash(bundleOf()))
    const edited = bundleOf({ positions: [closedPosition({ pnlAbs: 999_999 })] })
    assert.notEqual(evidenceHash(bundleOf()), evidenceHash(edited))
    // timestamps are recorded but must not be what identifies the evidence
    assert.equal(evidenceHash(bundleOf({ frozenAt: T0 + 5000 })), evidenceHash(bundleOf()))
  })

  test('freeze is immutable and verify detects any later edit', () => {
    const doc = freezeEvidenceSet(bundleOf())
    assert.equal(Object.isFrozen(doc), true)
    assert.equal(doc.frozen, true)
    assert.equal(doc.immutable, true)
    assert.equal(doc.schemaVersion, EVIDENCE_SCHEMA_VERSION)
    assert.match(doc.hash, /^evh1_/)
    assert.equal(verifyEvidenceSet(doc).ok, true)

    const tampered = { ...doc, metrics: { ...doc.metrics, trades: 999 } }
    const res = verifyEvidenceSet(tampered)
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'SET_TAMPERED')
    // Removing the limitations that a reader relies on is also a tamper.
    assert.equal(verifyEvidenceSet({ ...doc, limitations: [] }).ok, false)
    assert.equal(verifyEvidenceSet({ ...doc, hash: '' }).ok, false)
    assert.equal(verifyEvidenceSet({ ...doc, frozen: false }).ok, false)
    assert.equal(verifyEvidenceSet(null).ok, false)
  })

  test('a bundle without frozenAt is refused (evidence must state when it was captured)', () => {
    assert.throws(() => bundleOf({ frozenAt: 0 }), /frozenAt must be/)
  })
})

describe('linking AI output to evidence (§59.15 acceptance)', () => {
  const doc = freezeEvidenceSet(buildEvidenceBundle({
    kind: 'paper-session', sourceId: 'ses_1', session: sessionDoc(), positions: [closedPosition()], frozenAt: T0,
  }))

  test('an AI-generated proposal must cite a frozen set', () => {
    const noCite = proposalEvidenceLink({ proposalId: 'p1', generation: { model: 'x' } }, { evidenceSet: null })
    assert.equal(noCite.ok, false)
    if (!noCite.ok) assert.equal(noCite.code, 'EVIDENCE_REQUIRED')

    const missing = proposalEvidenceLink({ proposalId: 'p1', generation: {}, evidenceSetId: 'ev_paper-session_nope' }, { evidenceSet: null })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.code, 'EVIDENCE_NOT_FOUND')

    const ok = proposalEvidenceLink({ proposalId: 'p1', generation: {}, evidenceSetId: doc.setId, strategyVersionId: 'tm-vsa@1.4.0' }, { evidenceSet: doc })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.required, true)
  })

  test('a hand-written proposal may skip the link; citing one still validates it', () => {
    const skipped = proposalEvidenceLink({ proposalId: 'p1' }, { evidenceSet: null })
    assert.equal(skipped.ok, true)
    if (skipped.ok) assert.equal(skipped.required, false)

    const tampered = { ...doc, limitations: ['nothing to see'] }
    const res = proposalEvidenceLink({ proposalId: 'p1', evidenceSetId: doc.setId }, { evidenceSet: tampered })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'SET_TAMPERED')
  })

  test('evidence from a different strategy version is refused', () => {
    const res = proposalEvidenceLink(
      { proposalId: 'p1', generation: {}, evidenceSetId: doc.setId, strategyVersionId: 'tm-vsa@2.0.0' },
      { evidenceSet: doc },
    )
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'EVIDENCE_WRONG_VERSION')
  })
})

describe('candidate independence (D31: never a silent promotion)', () => {
  test('a validation session starts only from paper_validation', () => {
    assert.equal(paperValidationEdge({ status: 'proposed', strategyVersionId: 'v1' }).ok, false)
    const res = paperValidationEdge({ status: 'paper_validation', strategyVersionId: 'v1' })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.candidateVersionId, 'v1')
    const noVer = paperValidationEdge({ status: 'paper_validation' })
    assert.equal(noVer.ok, false)
    if (!noVer.ok) assert.equal(noVer.code, 'NO_CANDIDATE_VERSION')
  })

  test('a candidate that is already active is not a candidate', () => {
    const same = candidateIndependence({ candidateVersionId: 'v1', activeVersionId: 'v1' })
    assert.equal(same.ok, false)
    if (!same.ok) assert.equal(same.code, 'CANDIDATE_IS_ACTIVE')
    assert.equal(candidateIndependence({ candidateVersionId: 'v2', activeVersionId: 'v1' }).ok, true)
    assert.equal(candidateIndependence({ candidateVersionId: 'v2', activeVersionId: '' }).ok, true)
    assert.equal(candidateIndependence({}).ok, false)
  })
})

describe('evidence service — freeze once, read, cite', () => {
  test('freezes a session into a hash-verified document', async () => {
    const doc = await createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_1' }, serviceDeps())
    assert.equal(doc.setId, 'ev_paper-session_ses_1')
    assert.equal(doc.kind, 'paper-session')
    assert.equal(doc.sessionId, 'ses_1')
    assert.equal(doc.strategyVersionId, 'tm-vsa@1.4.0')
    assert.equal(doc.frozen, true)
    assert.match(String(doc.hash), /^evh1_/)
    assert.equal(doc.metrics.trades, 1)
    assert.equal(doc.counts.orders, 0)
    assert.deepEqual(doc.usedByExperimentIds, [])
    assert.equal(verifyEvidenceSet(doc).ok, true)
  })

  test('a second freeze returns the SAME set (one set per source)', async () => {
    const frozen = await frozenVia()
    const same = await createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_1' }, serviceDeps({
      evidenceSetModel: loader(modelStub({ one: frozen }))
    }))
    assert.equal(same.setId, frozen.setId)
    assert.equal(same.alreadyFrozen, true)
    assert.equal(same.sourceChanged, false) // same source, same facts

    // the source moved on after the freeze -> the old set is returned, flagged
    const moved = await createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_1' }, serviceDeps({
      evidenceSetModel: loader(modelStub({ one: frozen })),
      positionModel: loader(modelStub({ rows: [closedPosition(), closedPosition({ _id: 'pos_2' })] }))
    }))
    assert.equal(moved.alreadyFrozen, true)
    assert.equal(moved.sourceChanged, true)

    // A caller's NOTE is commentary, not a change in the run: freezing again
    // with different notes must not claim the session itself moved on.
    let wrote: Row | null = null
    const noted = await createEvidenceSet(
      { kind: 'paper-session', sourceId: 'ses_1', notes: ['only 3 closed trades', 'weekend coverage gap'] },
      serviceDeps({ evidenceSetModel: loader(modelStub({ one: frozen, onCreate: (d) => { wrote = d } })) })
    )
    assert.equal(noted.alreadyFrozen, true)
    assert.equal(noted.sourceChanged, false)
    assert.equal(wrote, null) // nothing overwrote the frozen set
  })

  test('a race that inserts twice is refused with 409', async () => {
    await assert.rejects(
      () => createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_1' }, serviceDeps({
        evidenceSetModel: loader(modelStub({ writeError: Object.assign(new Error('dup'), { code: 11000 }) }))
      })),
      (err: unknown) => {
        const e = err as EvidenceError
        assert.equal(e.statusCode, 409)
        assert.equal(e.statusMessage, 'evidence_already_frozen')
        return true
      },
    )
  })

  test('an unknown session and a down store fail loudly, never silently', async () => {
    await assert.rejects(
      () => createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_404' }, serviceDeps({ sessionModel: loader(modelStub({ one: null })) })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 404)
        return true
      },
    )
    await assert.rejects(
      () => createEvidenceSet({ kind: 'paper-session', sourceId: 'ses_1' }, serviceDeps({ evidenceSetModel: nullLoader })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 503)
        return true
      },
    )
    await assert.rejects(() => createEvidenceSet({ sourceId: '' }, serviceDeps()))
  })

  test('reads are fail-soft', async () => {
    assert.deepEqual(await listEvidenceSets({}, serviceDeps({ evidenceSetModel: nullLoader })), [])
    assert.equal(await getEvidenceSet('', serviceDeps()), null)
    assert.equal(await getEvidenceSet('ev_x', serviceDeps({ evidenceSetModel: nullLoader })), null)
  })

  test('a stored set is returned with integrity + sufficiency verdicts', async () => {
    const frozen = await frozenVia()
    const doc = await getEvidenceSet(frozen.setId, serviceDeps({ evidenceSetModel: loader(modelStub({ one: frozen })) }))
    assert.equal(doc?.integrity.ok, true)
    assert.equal(doc?.sufficiency.sufficient, false)
    assert.ok((doc?.sufficiency.reasons ?? []).length > 0)
  })

  test('requireProposalEvidence links a proposal to a stored set (and refuses a missing one)', async () => {
    const frozen = await frozenVia()
    const deps = serviceDeps({ evidenceSetModel: loader(modelStub({ one: frozen })) })
    const linked = await requireProposalEvidence(
      { proposalId: 'p1', strategyVersionId: 'tm-vsa@1.4.0' },
      { evidenceSetId: frozen.setId, aiGenerated: true },
      deps,
    )
    assert.equal(linked.ok, true)
    assert.equal(linked.evidenceSetId, frozen.setId)

    // A set that genuinely does not exist is a 400: the proposal cannot cite it.
    await assert.rejects(
      () => requireProposalEvidence(
        { proposalId: 'p1' },
        { evidenceSetId: 'ev_missing', aiGenerated: true },
        serviceDeps({ evidenceSetModel: loader(modelStub({ one: null })) }),
      ),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 400)
        assert.equal((err as EvidenceError).statusMessage, 'evidence_not_found')
        return true
      },
    )

    // An AI proposal with NO cited evidence is refused outright (D7 guardrail).
    await assert.rejects(
      () => requireProposalEvidence({ proposalId: 'p1' }, { aiGenerated: true }, deps),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusMessage, 'evidence_required')
        return true
      },
    )

    // Wrong version / id mismatch are conflicts (409), not bad requests.
    await assert.rejects(
      () => requireProposalEvidence({ proposalId: 'p1', strategyVersionId: 'tm-vsa@9.9.9' }, { evidenceSetId: frozen.setId, aiGenerated: true }, deps),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 409)
        assert.equal((err as EvidenceError).statusMessage, 'evidence_wrong_version')
        return true
      },
    )
  })

  test('citing a set is an append-only back-reference', async () => {
    let captured: Record<string, unknown> | null = null
    const Evidence = {
      findOne: () => leanOne(null),
      find: () => leanMany([]),
      updateOne: async (_f: unknown, u: Record<string, unknown>) => { captured = u; return { acknowledged: true } }
    }
    await citeEvidenceSet('ev_paper-session_ses_1', 'exp:abc', serviceDeps({ evidenceSetModel: loader(Evidence) }))
    assert.deepEqual(captured, { $addToSet: { usedByExperimentIds: 'exp:abc' } })
  })
})

describe('auto-freeze on completion (§59.15) — a sealed session always has citable evidence', () => {
  test('a terminal session is frozen the moment it is sealed — no manual click needed', async () => {
    let wrote: Row | null = null
    const res = await autoFreezeSessionEvidence(
      sessionDoc(),
      serviceDeps({ evidenceSetModel: loader(modelStub({ onCreate: (d: Row) => { wrote = d } })) }),
    )
    assert.equal(res.frozen, true)
    assert.equal(res.created, true)
    assert.equal(res.setId, 'ev_paper-session_ses_1')
    assert.equal(wrote?.setId, 'ev_paper-session_ses_1')
    assert.equal(wrote?.frozen, true)
  })

  test('a LIVE session is never frozen — evidence is captured at seal time only', async () => {
    for (const state of ['queued', 'starting', 'running', 'paused', 'stopping']) {
      const res = await autoFreezeSessionEvidence(sessionDoc({ state }), serviceDeps())
      assert.equal(res.frozen, false, `state ${state} must not freeze`)
      assert.equal(res.setId, null)
      assert.ok(res.reason, `state ${state} must say why it did not freeze`)
    }
    assert.deepEqual([...AUTO_FREEZE_SESSION_STATES], ['completed', 'failed', 'halted'])
  })

  test('a replay session freezes as REPLAY evidence, never mislabelled as paper', async () => {
    const res = await autoFreezeSessionEvidence(sessionDoc({ kind: 'replay' }), serviceDeps())
    assert.equal(res.frozen, true)
    assert.equal(res.setId, 'ev_replay-session_ses_1')
    assert.equal(sessionEvidenceKind('replay'), 'replay-session')
    assert.equal(sessionEvidenceKind('live-paper'), 'paper-session')
    assert.equal(sessionEvidenceKind(undefined), 'paper-session')
  })

  test('an already-frozen session returns the SAME set (idempotent, D3)', async () => {
    const frozen = await frozenVia()
    const res = await autoFreezeSessionEvidence(
      sessionDoc(),
      serviceDeps({ evidenceSetModel: loader(modelStub({ one: frozen })) }),
    )
    assert.equal(res.frozen, true)
    assert.equal(res.created, false)
    assert.equal(res.setId, frozen.setId)
  })

  test('fail-soft: a store outage is REPORTED, never thrown — a sealed session stays sealed', async () => {
    const res = await autoFreezeSessionEvidence(sessionDoc(), serviceDeps({ evidenceSetModel: nullLoader }))
    assert.equal(res.frozen, false)
    assert.equal(res.created, false)
    assert.equal(res.setId, null)
    assert.ok(res.reason, 'a failed freeze must say why')

    const noId = await autoFreezeSessionEvidence(null, serviceDeps())
    assert.equal(noId.frozen, false)
    assert.ok(noId.reason)
  })
})

describe('backfill — terminal sessions sealed before auto-freeze (§59.15)', () => {
  const sealed = [
    sessionDoc(),
    sessionDoc({ _id: 'ses_2', sessionId: 'ses_2', state: 'failed' }),
    sessionDoc({ _id: 'ses_3', sessionId: 'ses_3', state: 'halted' }),
  ]

  /** Evidence store where only the listed setIds exist; captures creates. */
  const evidenceStore = (existingIds: string[], created: Row[] = []) => ({
    findOne: (q: Row) => leanOne(
      existingIds.includes(String(q?._id)) ? { _id: String(q._id), frozen: true } : null
    ),
    create: async (doc: Row) => { created.push(doc); return doc },
    updateOne: async () => ({ acknowledged: true }),
  })

  test('freezes the backlog: missing sets are created, existing ones skipped', async () => {
    const created: Row[] = []
    const res = await backfillTerminalSessionEvidence(serviceDeps({
      sessionModel: loader(modelStub({ rows: sealed, one: sessionDoc() })),
      evidenceSetModel: loader(evidenceStore(['ev_paper-session_ses_1'], created)),
    }))
    assert.deepEqual(res, { scanned: 3, frozen: 2, already: 1, failed: 0 })
    assert.deepEqual(
      created.map((d: Row) => d.setId).sort(),
      ['ev_paper-session_ses_2', 'ev_paper-session_ses_3'],
    )
    assert.ok(created.every((d: Row) => d.frozen === true && /^evh1_/.test(String(d.hash))))
  })

  test('only terminal sessions are swept — the query itself carries the guard', async () => {
    let seenFilter: Row | null = null
    const sessionModel = loader({
      find: (f: Row) => { seenFilter = f; return leanMany([]) },
    })
    const res = await backfillTerminalSessionEvidence(serviceDeps({ sessionModel }))
    assert.deepEqual(seenFilter, { state: { $in: [...AUTO_FREEZE_SESSION_STATES] } })
    assert.equal(res.scanned, 0) // empty store: no work, no failure
    assert.equal(res.reason, undefined)
  })

  test('one run is bounded: default 50, explicit limit honored, hard cap 200', async () => {
    const limits: number[] = []
    const sessionModel = loader({
      find: () => ({ sort: () => ({ limit: (n: number) => { limits.push(n); return { lean: async () => [] } } }) }),
    })
    await backfillTerminalSessionEvidence(serviceDeps({ sessionModel }))
    await backfillTerminalSessionEvidence(serviceDeps({ sessionModel }), { limit: 7 })
    await backfillTerminalSessionEvidence(serviceDeps({ sessionModel }), { limit: 999 })
    assert.deepEqual(limits, [50, 7, 200])
  })

  test('an existing set is skipped entirely — no re-hydration, no rewrite', async () => {
    const ids = sealed.map(s => `ev_paper-session_${String(s.sessionId)}`)
    const res = await backfillTerminalSessionEvidence(serviceDeps({
      sessionModel: loader(modelStub({ rows: sealed, one: sessionDoc() })),
      evidenceSetModel: loader(evidenceStore(ids, [])),
      // hydrating reads positions — touching it means the skip path regressed
      positionModel: loader({ find: () => { throw new Error('must not hydrate an existing set') } }),
    }))
    assert.deepEqual(res, { scanned: 3, frozen: 0, already: 3, failed: 0 })
  })

  test('fail-soft: a down store or a failed write is reported, never thrown', async () => {
    const noSessions = await backfillTerminalSessionEvidence(serviceDeps({ sessionModel: nullLoader }))
    assert.equal(noSessions.frozen, 0)
    assert.ok(noSessions.reason)

    const noEvidence = await backfillTerminalSessionEvidence(serviceDeps({ evidenceSetModel: nullLoader }))
    assert.equal(noEvidence.frozen, 0)
    assert.ok(noEvidence.reason)

    const queryBoom = await backfillTerminalSessionEvidence(serviceDeps({
      sessionModel: loader({ find: () => { throw new Error('db gone') } }),
    }))
    assert.equal(queryBoom.reason, 'session query failed')

    // Missing set, but the INSERT fails -> counted, run continues, no throw.
    const res = await backfillTerminalSessionEvidence(serviceDeps({
      sessionModel: loader(modelStub({ rows: [sessionDoc()], one: sessionDoc() })),
      evidenceSetModel: loader({
        findOne: () => leanOne(null),
        create: async () => { throw new Error('disk full') },
        updateOne: async () => ({ acknowledged: true }),
      }),
    }))
    assert.deepEqual(res, { scanned: 1, frozen: 0, already: 0, failed: 1 })
  })
})

describe('paper-validation session — governed launch', () => {
  const experimentDoc = (over: Row = {}): Row => ({
    _id: 'exp:abc',
    experimentId: 'exp:abc',
    status: 'paper_validation',
    strategyVersionId: 'tm-vsa@2.0.0',
    evidenceSetId: 'ev_paper-session_ses_1',
    recommendedTest: { symbols: ['BTCUSDT'], timeframes: ['60'] },
    ...over,
  })

  test('launches a live-paper session carrying its provenance', async () => {
    let started: Record<string, any> | null = null
    const data = await createPaperValidationSession('exp:abc', {}, serviceDeps({
      experimentModel: loader(modelStub({ one: experimentDoc() })),
      startSession: async (input: Record<string, any>) => {
        started = input
        return { sessionId: 'ses_new', state: 'queued' }
      },
    }))
    assert.equal(data.session.sessionId, 'ses_new')
    assert.equal(data.candidateVersionId, 'tm-vsa@2.0.0')
    assert.equal(started?.kind, 'live-paper')
    assert.equal(started?.strategyVersionId, 'tm-vsa@2.0.0')
    assert.deepEqual(started?.instruments, ['BTCUSDT'])
    assert.equal(started?.manifest?.schema, 'manifest.v1')
    assert.equal(started?.manifest?.scope?.purpose, 'paper-validation')
    assert.equal(started?.manifest?.scope?.experimentId, 'exp:abc')
    assert.equal(started?.manifest?.scope?.evidenceSetId, 'ev_paper-session_ses_1')
    assert.equal(started?.manifest?.strategy?.versionId, 'tm-vsa@2.0.0')
    // The launcher cannot know the executor's risk caps — an honest gap, not a guess.
    assert.ok(started?.manifest?.gaps?.includes('risk.fingerprint'))
  })

  test('refuses an experiment that is not in paper_validation (409)', async () => {
    await assert.rejects(
      () => createPaperValidationSession('exp:abc', {}, serviceDeps({
        experimentModel: loader(modelStub({ one: experimentDoc({ status: 'proposed' }) })),
        startSession: async () => ({ sessionId: 'should_not_exist' }),
      })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 409)
        assert.equal((err as EvidenceError).statusMessage, 'not_in_paper_validation')
        return true
      },
    )
  })

  test('refuses when the candidate is already the active profile pointer (D31)', async () => {
    await assert.rejects(
      () => createPaperValidationSession('exp:abc', {}, serviceDeps({
        experimentModel: loader(modelStub({ one: experimentDoc() })),
        profileModel: loader(modelStub({ one: { _id: 'prof_1', status: 'active', strategyVersionId: 'tm-vsa@2.0.0' } })),
        startSession: async () => ({ sessionId: 'should_not_exist' })
      })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 409)
        assert.equal((err as EvidenceError).statusMessage, 'candidate_is_active')
        return true
      },
    )

    // an untouched baseline -> the same request succeeds
    const ok = await createPaperValidationSession('exp:abc', {}, serviceDeps({
      experimentModel: loader(modelStub({ one: experimentDoc() })),
      profileModel: loader(modelStub({ one: { _id: 'prof_1', status: 'active', strategyVersionId: 'tm-vsa@1.4.0' } })),
      startSession: async () => ({ sessionId: 'ses_ok' })
    }))
    assert.equal(ok.session.sessionId, 'ses_ok')
  })

  test('a missing experiment is 404, a down store is 503', async () => {
    await assert.rejects(
      () => createPaperValidationSession('exp:nope', {}, serviceDeps({ experimentModel: loader(modelStub({ one: null })) })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 404)
        return true
      },
    )
    await assert.rejects(
      () => createPaperValidationSession('exp:abc', {}, serviceDeps({ experimentModel: nullLoader })),
      (err: unknown) => {
        assert.equal((err as EvidenceError).statusCode, 503)
        return true
      },
    )
  })
})

describe('evidenceHttpError — HTTP mapping', () => {
  test('EvidenceError keeps its codes; unknown failures become 500', () => {
    const mapped = evidenceHttpError(new EvidenceError('nope', 409, 'evidence_already_frozen')) as { statusCode: number; statusMessage: string }
    assert.equal(mapped.statusCode, 409)
    assert.equal(mapped.statusMessage, 'evidence_already_frozen')
    const boom = evidenceHttpError(new Error('boom')) as { statusCode: number; statusMessage: string }
    assert.equal(boom.statusCode, 500)
    assert.equal(boom.statusMessage, 'evidence_failed')
  })
})
// =============================================================================
//  Non-session sources (§59.15 Slice E): backtest runs and datasets.
//
//  `EVIDENCE_KINDS` has always listed four kinds — a kind the service cannot
//  hydrate is worse than a missing kind, because it freezes a WELL-HASHED set of
//  nothing. These cases lock that a run's evidence carries the run's stamp and
//  its trades, that a dataset's carries its retention manifest and its suspect
//  verdict, and that neither ever claims a session it does not have.
// =============================================================================

describe('backtest-run evidence (the run stamp, not a session)', () => {
  test('evidenceTrade reads a backtest trade row honestly', () => {
    const t = evidenceTrade(backtestTrade())
    // No R distance on a trade row -> the RECORDED R is the truth (D12), and the
    // engine's version stamp lives on the row itself, not on a `stamp` sub-doc.
    assert.equal(t.rMultiple, 2)
    assert.equal(t.exitReason, 'TP')
    assert.equal(t.engineVersion, '1.5.0')
    assert.equal(t.paramsHash, 'ph1')
    // A trade row has no absolute PnL: null, never 0 (0 would claim it was zero).
    assert.equal(t.pnlAbs, null)
    assert.equal(t.sessionId, null)
  })

  test('an OPEN trade has no outcome: R stays null instead of 0', () => {
    const t = evidenceTrade(backtestTrade({ exitPrice: null, exitTime: null, rMultiple: 0, result: 'OPEN' }))
    assert.equal(t.rMultiple, null)
    assert.equal(t.exitReason, 'OPEN')
    assert.equal(t.exitPrice, null)
  })

  test('a recomputed R from the stop wins over the recorded one', () => {
    // (61200-60000)/(60000-59400) = 1200/600 = 2, while the row claims 0.4.
    const t = evidenceTrade(backtestTrade({ sl: 59_400, exitPrice: 61_200, rMultiple: 0.4 }))
    assert.equal(t.rMultiple, 2)
  })

  test('the run bundle states its stamp, its scope and no session at all', () => {
    const b = buildEvidenceBundle({
      kind: 'backtest-run',
      sourceId: 'run_1',
      sessionId: null,
      manifest: { runId: 'run_1', engineVersion: '1.5.0', paramsHash: 'ph1' },
      instruments: ['BTCUSDT'],
      timeframes: ['15'],
      strategyVersionId: null,
      positions: [backtestTrade({ rMultiple: 2 }), backtestTrade({ rMultiple: -1 })],
      frozenAt: T0,
    })
    assert.equal(b.setId, 'ev_backtest-run_run_1')
    assert.equal(b.sessionId, null)
    assert.equal(b.state, null)
    assert.equal(b.sealed, true) // a finished run's trades do not move
    // A run is engineVersion#paramsHash — never a strategy version (D1).
    assert.equal(b.strategyVersionId, null)
    assert.deepEqual(b.instruments, ['BTCUSDT'])
    assert.deepEqual(b.timeframes, ['15'])
    assert.equal(b.manifest.paramsHash, 'ph1')
    assert.equal(b.counts.trades, 2)
    assert.equal(b.counts.orders, 0)
    // its own stamp IS present, so the "no manifest" limitation must be absent
    assert.ok(!b.limitations.some((l: string) => l.includes('no versioned manifest')))
    assert.ok(b.limitations.some((l: string) => l.includes('the evidence floor')))
  })

  test('a source with neither a session nor a manifest says so', () => {
    const b = buildEvidenceBundle({ kind: 'dataset', sourceId: 'ds_1', sessionId: null, frozenAt: T0 })
    assert.equal(b.manifest, null)
    assert.ok(b.limitations.some((l: string) => l.includes('no versioned manifest')))
    assert.equal(b.sessionId, null)
    assert.equal(b.sealed, true)
  })
})

describe('evidence service — hydrating non-session sources', () => {
  const runDoc: Row = {
    _id: 'run_1',
    engineVersion: '1.5.0',
    paramsHash: 'ph1',
    dataHash: 'dh1',
    gitRev: 'abc123',
    method: 'vsa',
    market: 'fapi',
    symbol: 'BTCUSDT',
    tf: '15',
    bars: 5_000,
    from: new Date(T0),
    to: new Date(T0 + 86_400_000),
    universeSnapshot: { symbols: ['BTCUSDT'], source: 'binance' },
    stats: { trades: 3, winRate: 0.6 },
  }

  test('freezing a run hydrates its stamp and its trades, with no session', async () => {
    const doc = await createEvidenceSet({ kind: 'backtest-run', sourceId: 'run_1' }, serviceDeps({
      runModel: loader(modelStub({ one: runDoc })),
      tradeModel: loader(modelStub({
        rows: [
          backtestTrade({ rMultiple: 2 }),
          backtestTrade({ rMultiple: -1 }),
          backtestTrade({ exitPrice: null, exitTime: null, result: 'OPEN', rMultiple: 0 })
        ]
      })),
      // a run must never touch the session, order, fill or position stores
      sessionModel: nullLoader,
      orderModel: nullLoader,
      fillModel: nullLoader,
      positionModel: nullLoader
    }))

    assert.equal(doc.setId, 'ev_backtest-run_run_1')
    assert.equal(doc.kind, 'backtest-run')
    assert.equal(doc.sessionId, null)
    assert.equal(doc.strategyVersionId, null)
    assert.equal(doc.manifest.paramsHash, 'ph1')
    assert.equal(doc.manifest.engineVersion, '1.5.0')
    assert.equal(doc.instruments[0], 'BTCUSDT')
    assert.equal(doc.counts.trades, 3)
    assert.equal(doc.counts.orders, 0)
    // the OPEN trade is not a measurement — 2 of 3 rows have an outcome
    assert.equal(doc.metrics.rMeasured, 2)
    assert.equal(doc.metrics.sufficient, false)
    assert.equal(doc.frozen, true)
    assert.match(String(doc.hash), /^evh1_/)
    assert.deepEqual(doc.usedByExperimentIds, [])
    assert.equal(verifyEvidenceSet(doc).ok, true)
  })

  test('an unknown run is a 404, and a down store is a 503', async () => {
    await assert.rejects(
      () => createEvidenceSet({ kind: 'backtest-run', sourceId: 'run_x' }, serviceDeps({ runModel: loader(modelStub({ one: null })) })),
      (err: unknown) => {
        const e = err as EvidenceError
        assert.equal(e.statusCode, 404)
        assert.equal(e.statusMessage, 'run_not_found')
        return true
      }
    )
    await assert.rejects(
      () => createEvidenceSet({ kind: 'backtest-run', sourceId: 'run_1' }, serviceDeps({ runModel: nullLoader })),
      (err: unknown) => (err as EvidenceError).statusCode === 503
    )
  })

  test('a dataset freeze carries the retention manifest and its suspect verdict', async () => {
    const dataset: Row = {
      _id: 'candles:binance:BTCUSDT:60',
      datasetId: 'candles:binance:BTCUSDT:60',
      kind: 'candles',
      source: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '60',
      schemaVersion: 'dataset.v1',
      retentionDays: 90,
      compression: 'zst',
      checksum: null,
      startTs: T0 - 86_400_000,
      endTs: T0,
      count: 24,
      suspect: true,
      lastReconcileAt: null,
      lastReconcile: null
    }
    const doc = await createEvidenceSet({ kind: 'dataset', sourceId: dataset.datasetId }, serviceDeps({
      datasetModel: loader(modelStub({ one: dataset })),
      sessionModel: nullLoader,
      orderModel: nullLoader,
      fillModel: nullLoader,
      positionModel: nullLoader
    }))

    assert.equal(doc.setId, 'ev_dataset_candles:binance:BTCUSDT:60')
    assert.equal(doc.sessionId, null)
    assert.equal(doc.state, null)
    assert.equal(doc.sealed, true)
    assert.equal(doc.manifest.checksum, null)
    assert.equal(doc.manifest.suspect, true)
    assert.equal(doc.dataQuality.state, 'suspect')
    assert.equal(doc.dataQuality.datasets[0], dataset.datasetId)
    assert.deepEqual(doc.instruments, ['BTCUSDT'])
    assert.deepEqual(doc.timeframes, ['60'])
    assert.ok(doc.limitations.some((l: string) => l.includes('suspect')))
    assert.ok(doc.limitations.some((l: string) => l.includes('checksum')))
    assert.ok(doc.limitations.some((l: string) => l.includes('no trade outcomes')))
    assert.equal(verifyEvidenceSet(doc).ok, true)
  })

  test('an unknown dataset and an unknown kind fail loudly', async () => {
    await assert.rejects(
      () => createEvidenceSet({ kind: 'dataset', sourceId: 'ds_x' }, serviceDeps({ datasetModel: loader(modelStub({ one: null })) })),
      (err: unknown) => (err as EvidenceError).statusMessage === 'dataset_not_found'
    )
    await assert.rejects(
      () => createEvidenceSet({ kind: 'mystery', sourceId: 'x' }, serviceDeps()),
      (err: unknown) => {
        const e = err as EvidenceError
        assert.equal(e.statusCode, 400)
        assert.equal(e.statusMessage, 'invalid_kind')
        return true
      }
    )
  })
})
// -----------------------------------------------------------------------------
//  Run SERIES ids — the shape the Test Center links, compares and traces
//  (`engineVersion~symbol~tf~paramsHash`, reports/*.ndjson). Reports are always
//  written while Mongo is optional, so this path must work for every run the UI
//  can show, and it must freeze the SAME rows the run page displays.
// -----------------------------------------------------------------------------

const seriesDoc: Row = {
  id: '1.5.0~BTCUSDT~15~ph1',
  mode: 'BACKTEST',
  engineVersion: '1.5.0',
  paramsHash: 'ph1',
  params: { rP: 2, volMin: 5, minRRR: 1.5 },
  symbol: 'BTCUSDT',
  tf: '15',
  market: 'fapi',
  method: 'vsa',
  preset: null,
  firstRunAt: '2026-10-01T00:00:00.000Z',
  lastRunAt: '2026-10-02T00:00:00.000Z',
  dataHashCount: 2,
  gitRev: 'abc123',
  rawTrades: 4,
  duplicateTrades: 2,
  warnings: [{ code: 'DUP_CACHE', message: 'cache re-read duplicated rows' }],
  dataHashes: ['d1', 'd2'],
  gitRevs: ['abc123'],
  trades: [
    { dir: 1, entryTime: '2026-10-01T01:00:00.000Z', entryPrice: 60_000, exitTime: '2026-10-01T02:00:00.000Z', exitPrice: 61_200, sl: 59_400, result: 'TP', rMultiple: 2 },
    { dir: -1, entryTime: '2026-10-01T03:00:00.000Z', entryPrice: 61_000, exitTime: '2026-10-01T04:00:00.000Z', exitPrice: 60_400, sl: 61_600, result: 'TP', rMultiple: 1 },
    { dir: 1, entryTime: '2026-10-01T05:00:00.000Z', entryPrice: 60_500, exitTime: null, exitPrice: null, sl: 59_900, result: 'OPEN', rMultiple: 0 }
  ],
  equity: []
}

describe('evidence service — run series (Test Center id format)', () => {
  /** An evidence store that actually KEEPS what it is given (needed to test re-freeze). */
  const memoryEvidenceModel = () => {
    const store = new Map<string, Row>()
    return {
      findOne: (q: Row) => ({ lean: async () => store.get(String(q?._id)) ?? null }),
      find: () => leanMany([...store.values()]),
      create: async (doc: Row) => { store.set(String(doc._id), doc); return doc },
      updateOne: async () => ({ acknowledged: true }),
      store
    }
  }

  const seriesDeps = (over: Row = {}) => serviceDeps({
    runsSeries: async () => ({ series: [seriesDoc] }),
    evidenceSetModel: loader(memoryEvidenceModel()),
    // a series id never reaches the Mongo run stores
    runModel: nullLoader,
    tradeModel: nullLoader,
    ...over
  })

  test('freezes the rows the run page shows, stamped by the series', async () => {
    const doc = await createEvidenceSet({ kind: 'backtest-run', sourceId: seriesDoc.id }, seriesDeps())

    assert.equal(doc.setId, 'ev_backtest-run_1.5.0~BTCUSDT~15~ph1')
    assert.equal(doc.kind, 'backtest-run')
    assert.equal(doc.sessionId, null)
    assert.equal(doc.strategyVersionId, null)
    assert.equal(doc.manifest.seriesId, seriesDoc.id)
    assert.equal(doc.manifest.paramsHash, 'ph1')
    assert.deepEqual(doc.manifest.params, { rP: 2, volMin: 5, minRRR: 1.5 })
    assert.deepEqual(doc.instruments, ['BTCUSDT'])
    assert.deepEqual(doc.timeframes, ['15'])
    assert.equal(doc.counts.trades, 3)

    // stamps live on the series, not on a report row — they are copied on
    assert.ok((doc.trades as Row[]).every((t) => t.paramsHash === 'ph1' && t.engineVersion === '1.5.0' && t.symbol === 'BTCUSDT'))

    // report rows carry no _id: each still gets a DISTINCT, content-derived key
    const keys = doc.keys.positionKeys as string[]
    assert.equal(keys.length, 3)
    assert.equal(new Set(keys).size, 3)
    assert.ok(keys.every((k) => k.startsWith('tc1_')))

    // the OPEN row is not an outcome
    assert.equal(doc.metrics.rMeasured, 2)
    assert.equal(doc.metrics.sufficient, false)

    // the run's own caveats are carried as limitations (D12)
    assert.ok(doc.limitations.some((l: string) => l.includes('1 warning')))
    assert.ok(doc.limitations.some((l: string) => l.includes('2 duplicate trade row')))
    assert.ok(doc.limitations.some((l: string) => l.includes('dataHash values')))

    assert.equal(verifyEvidenceSet(doc).ok, true)
    assert.deepEqual(doc.usedByExperimentIds, [])
  })

  test('an unknown or malformed series id is a 404, not a silent empty set', async () => {
    await assert.rejects(
      () => createEvidenceSet({ kind: 'backtest-run', sourceId: '1.5.0~ETHUSDT~60~ph_missing' }, seriesDeps()),
      (err: unknown) => (err as EvidenceError).statusMessage === 'run_not_found'
    )
    await assert.rejects(
      () => createEvidenceSet({ kind: 'backtest-run', sourceId: 'not~a~series' }, seriesDeps({
        runsSeries: async () => ({ series: [] })
      })),
      (err: unknown) => (err as EvidenceError).statusCode === 404
    )
  })

  test('re-freezing a series flags a changed run (a re-run writes new rows)', async () => {
    const store = memoryEvidenceModel()
    const deps = seriesDeps({ evidenceSetModel: loader(store) })
    const first = await createEvidenceSet({ kind: 'backtest-run', sourceId: seriesDoc.id }, deps)
    assert.equal(first.alreadyFrozen, undefined) // first freeze is just the set
    assert.equal(store.store.size, 1)

    const same = await createEvidenceSet({ kind: 'backtest-run', sourceId: seriesDoc.id }, deps)
    assert.equal(same.alreadyFrozen, true)
    assert.equal(same.sourceChanged, false)
    assert.equal(store.store.size, 1) // idempotent: no second set for one source

    // the series grew: a new closed trade changed the FACTS
    const depsGrew = serviceDeps({
      runsSeries: async () => ({
        series: [{
          ...seriesDoc,
          trades: [...seriesDoc.trades, { dir: 1, entryTime: '2026-10-01T07:00:00.000Z', entryPrice: 62_000, exitTime: '2026-10-01T08:00:00.000Z', exitPrice: 63_000, sl: 61_400, result: 'TP', rMultiple: 2 }]
        }]
      }),
      evidenceSetModel: loader(modelStub({ one: first })),
      runModel: nullLoader,
      tradeModel: nullLoader,
      datasetModel: nullLoader
    })
    const grew = await createEvidenceSet({ kind: 'backtest-run', sourceId: seriesDoc.id }, depsGrew)
    assert.equal(grew.alreadyFrozen, true)
    assert.equal(grew.sourceChanged, true)
  })
})
