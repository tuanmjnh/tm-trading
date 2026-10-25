import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProposalsText } from '../ai/proposal.mjs'
import { analyzeSession } from '../server/utils/sessionAnalysis'

// =============================================================================
//  Phase F — AI analysis of a completed session.
//
//  The contract under test is the acceptance rule, not the prose: a draft must
//  cite record ids from the graph, must not invent ids or sample sizes, must be
//  refused while the evidence is still moving, and must remain a DRAFT (one
//  ai_proposals row) — never an experiment or a strategy change.
// =============================================================================

type Row = Record<string, any>

const graphOf = (over: Row = {}): Row => ({
  session: { sessionId: 'ses_1', state: 'completed' },
  bundle: {
    setId: 'ev_paper-session_ses_1',
    sealed: true,
    frozen: true,
    strategyVersionId: 'sv_1',
    metrics: { trades: 3 },
    limitations: [],
  },
  links: { counts: { trades: 3, journal: 1 } },
  digest: 'evidence links evidence-links.v1\nsession ses_1\norder ord_1\njournal j1_abc\ntrade pos_1',
  ids: ['ses_1', 'ev_paper-session_ses_1', 'ord_1', 'pos_1', 'j1_abc'],
  relatedSets: [{ setId: 'ev_backtest-run_r1', metrics: { trades: 30 } }],
  limitations: [],
  ...over,
})

const goodProposal = (over: Row = {}): Row => ({
  proposalId: 'draft_from_ai',
  hypothesis: 'Tighter stops improve R on this sample.',
  changes: [{ parameter: 'rP', from: 2, to: 1.5 }],
  evidence: [{ metric: 'avgR', value: 1.2, sampleSize: 3 }],
  risks: ['small sample'],
  recommendedTest: { symbols: ['BTCUSDT'], timeframes: ['60'] },
  citations: [{ kind: 'journal', id: 'j1_abc' }, { kind: 'order', id: 'ord_1' }],
  ...over,
})

const deps = (proposal: Row, over: Row = {}): Row => ({
  graph: async () => graphOf(),
  chat: async () => ({ text: JSON.stringify(proposal), provider: 'test', model: 'm1' }),
  parse: parseProposalsText,
  hash: () => 'h_digest',
  now: () => 1_790_000_000_000,
  proposalId: (seed: string) => `draft_${seed}`,
  persist: async (doc: Row) => ({ ok: true, doc: { ...doc, status: 'new' } }),
  ...over,
})

const rejectsWith = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (err: any) => {
    assert.equal(err.statusMessage, code, `expected ${code}, got ${err.statusMessage}`)
    return true
  })

describe('session analysis — guards', () => {
  test('refuses a session that has not stopped', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), {
        graph: async () => graphOf({ bundle: { ...graphOf().bundle, sealed: false } }),
      })),
      'session_not_sealed'
    )
  })

  test('refuses unfrozen evidence', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), {
        graph: async () => graphOf({ bundle: { ...graphOf().bundle, frozen: false } }),
      })),
      'evidence_not_frozen'
    )
  })

  test('refuses a session with no closed trades', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), {
        graph: async () => graphOf({ bundle: { ...graphOf().bundle, metrics: { trades: 0 } } }),
      })),
      'no_trades'
    )
  })

  test('refuses an analysis with no citations', async () => {
    await rejectsWith(analyzeSession('ses_1', {}, deps(goodProposal({ citations: [] }))), 'no_citations')
  })

  test('refuses an invented record id', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal({ citations: [{ kind: 'journal', id: 'j1_made_up' }] }))),
      'invalid_citation'
    )
  })

  test('refuses a sample size larger than the evidence supports', async () => {
    const huge = goodProposal({ evidence: [{ metric: 'avgR', value: 1.2, sampleSize: 500 }] })
    await rejectsWith(analyzeSession('ses_1', {}, deps(huge)), 'fabricated_sample')
  })

  test('maps a missing AI key to 503 ai_unconfigured', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), {
        chat: async () => { throw Object.assign(new Error('no key'), { code: 'ai.no-key' }) },
      })),
      'ai_unconfigured'
    )
  })

  test('maps a provider failure to 502 ai_failed', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), {
        chat: async () => { throw Object.assign(new Error('boom'), { code: 'ai.http-error' }) },
      })),
      'ai_failed'
    )
  })

  test('refuses prose that is not a proposal', async () => {
    await rejectsWith(
      analyzeSession('ses_1', {}, deps(goodProposal(), { chat: async () => ({ text: 'I think you should trade more.' }) })),
      'ai_invalid_output'
    )
  })
})

describe('session analysis — draft', () => {
  test('binds the draft to the frozen set and cites real ids', async () => {
    const res = await analyzeSession('ses_1', {}, deps(goodProposal()), 'alice')
    assert.equal(res.draft.evidenceSetId, 'ev_paper-session_ses_1')
    assert.equal(res.draft.strategyVersionId, 'sv_1')
    assert.deepEqual(res.citations.map((c: Row) => c.id), ['j1_abc', 'ord_1'])
    assert.equal(res.generation.kind, 'session-analysis.v1')
    assert.equal(res.generation.digestHash, 'h_digest')
    assert.equal(res.generation.sessionId, 'ses_1')
    assert.equal(res.persisted, true)
  })

  test('the prompt carries the digest and the focus, and writes one proposal row', async () => {
    let messages: Row[] = []
    let persisted: Row | null = null
    const res = await analyzeSession('ses_1', { focus: 'Why is the win rate low?' }, deps(goodProposal(), {
      chat: async (m: Row[]) => { messages = m; return { text: JSON.stringify(goodProposal()), provider: 'test', model: 'm1' } },
      persist: async (doc: Row, opts: Row) => { persisted = { doc, opts }; return { ok: true, doc } },
    }), 'alice')
    assert.equal(messages[1].content.includes('journal j1_abc'), true)
    assert.equal(messages[1].content.includes('Why is the win rate low?'), true)
    assert.equal(persisted?.doc.status, undefined)
    assert.equal(persisted?.opts.ownerId, 'alice')
    assert.equal((persisted?.opts.generation as Row).evidenceSetId, 'ev_paper-session_ses_1')
    assert.equal(res.persisted, true)
  })

  test('persist:false is a dry run', async () => {
    let called = false
    const res = await analyzeSession('ses_1', { persist: false }, deps(goodProposal(), {
      persist: async () => { called = true; return { ok: true, doc: {} } },
    }))
    assert.equal(called, false)
    assert.equal(res.persisted, false)
    assert.equal(res.draft.proposalId, 'draft_from_ai')
  })
})
