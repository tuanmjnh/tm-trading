import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ResearchError,
  createExperiment,
  decideExperiment,
  getExperimentResearch,
  getStrategyResearch,
  listExperiments,
  listProposals,
  moveExperimentResearch,
  researchHttpError,
  runExperimentArm
} from '../server/utils/research'

// =============================================================================
//  §30.7 Research API server layer. The engine owns every rule (proposal
//  validation, experiment lifecycle, arm scoring, journal reads) — this suite
//  locks the TRANSPORT/GLUE: fail-soft reads (Mongo down -> empty, never 500),
//  write error codes, role validation, and the report hydration shape.
//
//  Model/service loaders are injected (no Mongo, no network, no engine
//  backtest); the fake queries mimic the exact method chain the service uses.
// =============================================================================

type Row = Record<string, unknown>

/** Minimal mongoose-like model stub: find(...).sort(...).[limit(...).]lean(). */
function findStub(rows: Row[], capture?: unknown[]) {
  return (filter: unknown) => {
    capture?.push(filter)
    const afterSort = {
      lean: async () => rows,
      limit: () => ({ lean: async () => rows })
    }
    return { sort: () => afterSort }
  }
}

function modelStub(opts: { rows?: Row[]; one?: Row | null; capture?: unknown[] } = {}) {
  return {
    find: findStub(opts.rows ?? [], opts.capture),
    findOne: () => ({ lean: async () => opts.one ?? null })
  }
}

const asLoader = (m: unknown) => (async () => m) as never
const nullLoader = (async () => null) as never

// -----------------------------------------------------------------------------

describe('researchHttpError', () => {
  it('maps ResearchError to an h3 error carrying the original code', () => {
    const h3 = researchHttpError(new ResearchError('nope', 404, 'experiment_not_found')) as { statusCode?: number; statusMessage?: string }
    assert.equal(h3.statusCode, 404)
    assert.equal(h3.statusMessage, 'experiment_not_found')
  })

  it('passes through a foreign statusCode (e.g. engine error)', () => {
    const h3 = researchHttpError({ statusCode: 502, statusMessage: 'error.upstreamFailed', message: 'banned' }) as { statusCode?: number }
    assert.equal(h3.statusCode, 502)
  })

  it('unknown errors become 500 research_failed', () => {
    const h3 = researchHttpError(new Error('boom')) as { statusCode?: number; statusMessage?: string }
    assert.equal(h3.statusCode, 500)
    assert.equal(h3.statusMessage, 'research_failed')
  })
})

describe('getStrategyResearch', () => {
  it('empty id -> mongo down, empty collections', async () => {
    const r = await getStrategyResearch('  ')
    assert.equal(r.mongo, 'down')
    assert.deepEqual(r.versions, [])
    assert.equal(r.profile, null)
  })

  it('Mongo down (loader returns null) -> empty, mongo down', async () => {
    const r = await getStrategyResearch('tm-vsa', { profileModel: nullLoader, versionModel: nullLoader })
    assert.equal(r.mongo, 'down')
    assert.deepEqual(r.experiments, [])
  })

  it('joins profile + versions + experiments/proposals scoped to those versions', async () => {
    const versionFilters: unknown[] = []
    const expFilters: unknown[] = []
    const rows = [
      { _id: 'tm-vsa@1.0.0', strategyId: 'tm-vsa' },
      { _id: 'tm-vsa@1.1.0', strategyId: 'tm-vsa' }
    ]
    const r = await getStrategyResearch('tm-vsa', {
      profileModel: asLoader(modelStub({ one: { _id: 'tm-vsa', name: 'VSA' } })),
      versionModel: asLoader({ find: findStub(rows, versionFilters) }),
      experimentModel: asLoader({ find: findStub([{ _id: 'exp:1' }], expFilters) }),
      proposalModel: asLoader({ find: findStub([{ _id: 'p1' }]) })
    })
    assert.equal(r.mongo, 'up')
    assert.equal((r.profile as Row)._id, 'tm-vsa')
    assert.equal(r.versions.length, 2)
    assert.equal(r.experiments.length, 1)
    assert.equal(r.proposals.length, 1)
    // experiments/proposals are scoped by $in over the version ids (not "all").
    assert.deepEqual((expFilters[0] as { strategyVersionId: { $in: string[] } }).strategyVersionId.$in, ['tm-vsa@1.0.0', 'tm-vsa@1.1.0'])
  })

  it('a model that throws -> fail-soft empty, never throws', async () => {
    const r = await getStrategyResearch('tm-vsa', {
      profileModel: asLoader({ find: () => { throw new Error('kaboom') }, findOne: () => { throw new Error('kaboom') } }),
      versionModel: asLoader({ find: () => { throw new Error('kaboom') } })
    })
    assert.equal(r.mongo, 'down')
    assert.deepEqual(r.versions, [])
  })
})

describe('listProposals', () => {
  it('Mongo down -> empty + down', async () => {
    const r = await listProposals({ limit: 10 }, { model: nullLoader })
    assert.equal(r.mongo, 'down')
    assert.deepEqual(r.rows, [])
  })

  it('filters by status when given and returns rows', async () => {
    const filters: unknown[] = []
    const r = await listProposals({ status: 'new', limit: 25 }, {
      model: asLoader({ find: findStub([{ proposalId: 'p1' }], filters) })
    })
    assert.equal(r.mongo, 'up')
    assert.equal(r.rows.length, 1)
    assert.deepEqual(filters[0], { status: 'new' })
  })

  it('no status -> empty filter object', async () => {
    const filters: unknown[] = []
    await listProposals({ limit: 5 }, { model: asLoader({ find: findStub([], filters) }) })
    assert.deepEqual(filters[0], {})
  })
})

describe('createExperiment', () => {
  it('rejects a non-object body with 400 invalid_proposal', async () => {
    await assert.rejects(createExperiment('nope'), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_proposal'
    })
  })

  it('rejects a proposal missing hypothesis with 400', async () => {
    await assert.rejects(createExperiment({ proposalId: 'p1', changes: [] }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400
    })
  })

  it('writes the experiment through persistProposal and returns the doc', async () => {
    let saved: Record<string, unknown> | null = null
    let opts: Row | null = null
    const service = {
      persistProposal: async (p: Record<string, unknown>, o: Row) => {
        saved = p
        opts = o
        return { ok: true, code: 'OK', exp: { _id: 'exp:p1', status: 'proposed', ...p } }
      }
    }
    const doc = await createExperiment(
      { proposalId: 'p1', hypothesis: 'edge', changes: [], evidence: [], risks: [], recommendedTest: {} },
      { service: service as never, profileModel: nullLoader }
    )
    assert.equal(doc._id, 'exp:p1')
    assert.equal(doc.status, 'proposed')
    assert.equal((saved as unknown as Row).proposalId, 'p1')
    // §59.15 Slice E: no active profile -> baseline is honestly null, not guessed.
    assert.equal((opts as unknown as Row).baselineVersionId, null)
  })

  it('freezes the ACTIVE pointer into the experiment as the baseline', async () => {
    let opts: Row | null = null
    const service = {
      persistProposal: async (p: Record<string, unknown>, o: Row) => {
        opts = o
        return { ok: true, code: 'OK', exp: { _id: 'exp:p1', status: 'proposed', ...p } }
      }
    }
    await createExperiment(
      { proposalId: 'p1', hypothesis: 'edge', strategyVersionId: 'tm-vsa@2.0.0' },
      {
        service: service as never,
        profileModel: asLoader(modelStub({ one: { _id: 'prof_1', status: 'active', strategyVersionId: 'tm-vsa@1.4.0' } }))
      }
    )
    assert.equal((opts as unknown as Row).baselineVersionId, 'tm-vsa@1.4.0')
  })

  it('an unreachable profile store never blocks the experiment', async () => {
    const service = { persistProposal: async (p: Record<string, unknown>) => ({ ok: true, code: 'OK', exp: { _id: 'exp:p1', ...p } }) }
    const doc = await createExperiment(
      { proposalId: 'p1', hypothesis: 'edge' },
      { service: service as never, profileModel: (async () => { throw new Error('mongo down') }) as never }
    )
    assert.equal(doc._id, 'exp:p1')
  })

  it('propagates Mongo down as 503 mongo_down', async () => {
    const service = { persistProposal: async () => ({ ok: false, code: 'MONGO_DOWN', exp: null }) }
    await assert.rejects(
      createExperiment(
        { proposalId: 'p1', hypothesis: 'edge' },
        { service: service as never, profileModel: nullLoader }
      ),
      (e: unknown) => {
        const r = e as ResearchError
        return r instanceof ResearchError && r.statusCode === 503 && r.statusMessage === 'mongo_down'
      }
    )
  })
})

describe('getExperimentResearch', () => {
  it('empty id -> all null, mongo down', async () => {
    const r = await getExperimentResearch('')
    assert.equal(r.mongo, 'down')
    assert.equal(r.experiment, null)
  })

  it('hydrates experiment + comparison + acceptance from the service report', async () => {
    const service = {
      report: async () => ({
        ok: true,
        experiment: { _id: 'exp:1', status: 'backtested' },
        comparison: { complete: true },
        acceptance: { ok: false, gates: [] }
      })
    }
    const r = await getExperimentResearch('exp:1', { service: service as never })
    assert.equal(r.mongo, 'up')
    assert.equal((r.experiment as Row).status, 'backtested')
    assert.deepEqual(r.comparison, { complete: true })
  })

  it('unknown id (report not ok) -> null + down', async () => {
    const service = { report: async () => ({ ok: false, code: 'EXP_NOT_FOUND' }) }
    const r = await getExperimentResearch('exp:nope', { service: service as never })
    assert.equal(r.mongo, 'down')
    assert.equal(r.experiment, null)
  })
})

describe('runExperimentArm', () => {
  it('empty id -> 400 invalid_id', async () => {
    await assert.rejects(runExperimentArm('  ', { role: 'baseline' }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_id'
    })
  })

  it('unknown role -> 400 invalid_role', async () => {
    await assert.rejects(runExperimentArm('exp:1', { role: 'sneaky' }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_role'
    })
  })

  it('runs the arm through the service and returns role/summary/runIds', async () => {
    let called: Record<string, unknown> | null = null
    const service = {
      runArm: async (o: Record<string, unknown>) => {
        called = o
        return { ok: true, code: 'OK', summary: { trades: 12 }, runIds: ['r1'] }
      }
    }
    const out = await runExperimentArm('exp:1', { role: 'candidate', params: { a: 1 }, symbols: ['BTCUSDT'] }, { service: service as never })
    assert.equal(out.role, 'candidate')
    assert.deepEqual(out.runIds, ['r1'])
    assert.equal((called as unknown as Row).experimentId, 'exp:1')
    // metrics come from runArm's own summarizeRuns block — not re-derived here
    assert.deepEqual((called as unknown as Row).params, { a: 1 })
  })

  it('EXP_NOT_FOUND -> 404 experiment_not_found', async () => {
    const service = { runArm: async () => ({ ok: false, code: 'EXP_NOT_FOUND' }) }
    await assert.rejects(runExperimentArm('exp:1', { role: 'baseline' }, { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 404 && r.statusMessage === 'experiment_not_found'
    })
  })

  it('MONGO_DOWN -> 503 mongo_down', async () => {
    const service = { runArm: async () => ({ ok: false, code: 'MONGO_DOWN' }) }
    await assert.rejects(runExperimentArm('exp:1', { role: 'baseline' }, { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 503 && r.statusMessage === 'mongo_down'
    })
  })
})

describe('listExperiments', () => {
  it('Mongo down -> empty + down', async () => {
    const r = await listExperiments({ limit: 10 }, { model: nullLoader })
    assert.equal(r.mongo, 'down')
    assert.deepEqual(r.rows, [])
  })

  it('filters by status when given and returns rows', async () => {
    const filters: unknown[] = []
    const r = await listExperiments({ status: 'proposed', limit: 25 }, {
      model: asLoader({ find: findStub([{ _id: 'exp:1' }], filters) })
    })
    assert.equal(r.mongo, 'up')
    assert.equal(r.rows.length, 1)
    assert.deepEqual(filters[0], { status: 'proposed' })
  })

  it('no status -> empty filter object', async () => {
    const filters: unknown[] = []
    await listExperiments({ limit: 5 }, { model: asLoader({ find: findStub([], filters) }) })
    assert.deepEqual(filters[0], {})
  })
})

describe('moveExperimentResearch', () => {
  it('empty id -> 400 invalid_id', async () => {
    await assert.rejects(moveExperimentResearch('  ', 'approved'), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_id'
    })
  })

  it('empty target state -> 400 invalid_state', async () => {
    await assert.rejects(moveExperimentResearch('exp:1', '  '), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_state'
    })
  })

  it('advances the lifecycle through the service and returns the doc', async () => {
    let called: Record<string, unknown> | null = null
    const service = {
      moveExperiment: async (id: string, to: string) => {
        called = { id, to }
        return { ok: true, code: 'OK', exp: { _id: id, status: to } }
      }
    }
    const doc = await moveExperimentResearch('exp:1', 'running', { service: service as never })
    assert.equal(doc.status, 'running')
    assert.deepEqual(called, { id: 'exp:1', to: 'running' })
  })

  it('EXP_NOT_FOUND -> 404 experiment_not_found', async () => {
    const service = { moveExperiment: async () => ({ ok: false, code: 'EXP_NOT_FOUND' }) }
    await assert.rejects(moveExperimentResearch('exp:x', 'approved', { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 404 && r.statusMessage === 'experiment_not_found'
    })
  })

  it('an illegal jump -> 409 illegal_transition', async () => {
    const service = { moveExperiment: async () => ({ ok: false, code: 'EXP_ILLEGAL:proposed->accepted' }) }
    await assert.rejects(moveExperimentResearch('exp:1', 'accepted', { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 409 && r.statusMessage === 'illegal_transition'
    })
  })

  it('replaying the same state -> 409 illegal_transition', async () => {
    const service = { moveExperiment: async () => ({ ok: false, code: 'EXP_ALREADY' }) }
    await assert.rejects(moveExperimentResearch('exp:1', 'approved', { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 409 && r.statusMessage === 'illegal_transition'
    })
  })

  it('MONGO_DOWN -> 503 mongo_down', async () => {
    const service = { moveExperiment: async () => ({ ok: false, code: 'MONGO_DOWN' }) }
    await assert.rejects(moveExperimentResearch('exp:1', 'approved', { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 503 && r.statusMessage === 'mongo_down'
    })
  })
})

describe('decideExperiment', () => {
  it('empty id -> 400 invalid_id', async () => {
    await assert.rejects(decideExperiment('', true), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 400 && r.statusMessage === 'invalid_id'
    })
  })

  it('accept -> passes accept + opts to the service and returns the doc', async () => {
    let called: Record<string, unknown> | null = null
    const service = {
      decide: async (o: Record<string, unknown>) => {
        called = o
        return { ok: true, code: 'OK', exp: { _id: 'exp:1', status: 'accepted' } }
      }
    }
    const doc = await decideExperiment('exp:1', true, { minTrades: 30 }, { service: service as never })
    assert.equal(doc.status, 'accepted')
    assert.deepEqual(called, { experimentId: 'exp:1', accept: true, opts: { minTrades: 30 } })
  })

  it('a failing gate -> 409 acceptance_gate_failed', async () => {
    const service = { decide: async () => ({ ok: false, code: 'EXP_GATE_FAILED' }) }
    await assert.rejects(decideExperiment('exp:1', true, {}, { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 409 && r.statusMessage === 'acceptance_gate_failed'
    })
  })

  it('reject -> service called with accept:false', async () => {
    let called: Record<string, unknown> | null = null
    const service = {
      decide: async (o: Record<string, unknown>) => {
        called = o
        return { ok: true, code: 'OK', exp: { _id: 'exp:1', status: 'rejected' } }
      }
    }
    const doc = await decideExperiment('exp:1', false, {}, { service: service as never })
    assert.equal(doc.status, 'rejected')
    assert.equal((called as unknown as Row).accept, false)
  })

  it('unknown experiment -> 404 experiment_not_found', async () => {
    const service = { decide: async () => ({ ok: false, code: 'EXP_NOT_FOUND' }) }
    await assert.rejects(decideExperiment('exp:x', true, {}, { service: service as never }), (e: unknown) => {
      const r = e as ResearchError
      return r instanceof ResearchError && r.statusCode === 404
    })
  })
})
