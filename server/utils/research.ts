import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listJournal } from './journal'
import type { ListJournalQuery, ListJournalResult } from './journal'
import {
  aiProposalModel,
  experimentModel,
  experimentRunModel,
  strategyProfileModel,
  strategyVersionModel
} from './engineModel'

// =============================================================================
//  RESEARCH API SERVICE (§30.7) — read/mutate layer for the AI research workspace.
//
//  One source of truth (D1): every rule lives in the engine's own modules —
//  ai/proposal.mjs validates §27.3 proposals, engine/experiment.mjs owns the
//  lifecycle/arms/gate, engine/experimentService.mjs persists and runs arms
//  through the SAME engine/run.mjs backtest. This file only wires HTTP to those
//  and stays fail-soft (D33): Mongo down => empty reads / 503 writes, never a
//  500 with a stack trace.
//
//  Engine modules live outside `server/`, so they are loaded at runtime from
//  process.cwd() (pathToFileURL) like replaySessions.ts/indicators.ts — Nitro
//  computes the relative depth of imports that escape `server/` incorrectly
//  (docs/app-inheritance.md).
// =============================================================================

type ExperimentModule = typeof import('../../engine/experiment.mjs')
type ExperimentService = typeof import('../../engine/experimentService.mjs')
type RunModule = typeof import('../../engine/run.mjs')
type ProposalModule = typeof import('../../ai/proposal.mjs')

let experimentModP: Promise<ExperimentModule> | null = null
let experimentServiceP: Promise<ExperimentService> | null = null
let runModP: Promise<RunModule> | null = null
let proposalModP: Promise<ProposalModule> | null = null

function load<T>(rel: string): Promise<T> {
  const file = pathToFileURL(join(process.cwd(), ...rel.split('/'))).href
  return import(/* @vite-ignore */ file) as Promise<T>
}

export function experimentModule(): Promise<ExperimentModule> {
  if (!experimentModP) experimentModP = load('engine/experiment.mjs')
  return experimentModP
}

export function experimentService(): Promise<ExperimentService> {
  if (!experimentServiceP) experimentServiceP = load('engine/experimentService.mjs')
  return experimentServiceP
}

export function runModule(): Promise<RunModule> {
  if (!runModP) runModP = load('engine/run.mjs')
  return runModP
}

export function proposalModule(): Promise<ProposalModule> {
  if (!proposalModP) proposalModP = load('ai/proposal.mjs')
  return proposalModP
}

// -----------------------------------------------------------------------------
//  Error mapping — a ResearchError carries the HTTP intent through the thin
//  routes, mirroring ReplayError/replayHttpError.
// -----------------------------------------------------------------------------

export class ResearchError extends Error {
  statusCode: number
  statusMessage: string

  constructor(message: string, statusCode = 500, statusMessage = 'research_failed') {
    super(message)
    this.name = 'ResearchError'
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

/** Map a ResearchError to an h3 error; anything else becomes 500 research_failed. */
export function researchHttpError(err: unknown) {
  if (err instanceof ResearchError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'research_failed', message: (e?.message) || 'research failed' })
}

// -----------------------------------------------------------------------------
//  GET /research/trades — the executed-trade journal (D1: engine/journal.mjs).
//  Research reads the same journal the dashboard shows; no separate store.
// -----------------------------------------------------------------------------

export async function listResearchTrades(q: ListJournalQuery): Promise<ListJournalResult> {
  return listJournal(q)
}

// -----------------------------------------------------------------------------
//  GET /research/strategies/:id — everything research knows about one strategy:
//  its profile, its immutable versions, and every experiment/proposal tied to
//  those versions. Fail-soft: Mongo down => empty collections + meta.mongo.
// -----------------------------------------------------------------------------

export interface StrategyResearch {
  profile: Record<string, unknown> | null
  versions: Record<string, unknown>[]
  experiments: Record<string, unknown>[]
  proposals: Record<string, unknown>[]
  mongo: 'up' | 'down'
}

/** Injectable model loaders (tests pass fakes; production omits for the real ones). */
export interface StrategyResearchDeps {
  profileModel?: typeof strategyProfileModel
  versionModel?: typeof strategyVersionModel
  experimentModel?: typeof experimentModel
  proposalModel?: typeof aiProposalModel
}

export async function getStrategyResearch(id: string, deps: StrategyResearchDeps = {}): Promise<StrategyResearch> {
  const human = String(id ?? '').trim()
  const empty: StrategyResearch = { profile: null, versions: [], experiments: [], proposals: [], mongo: 'down' }
  if (!human) return empty

  const Profile = await (deps.profileModel ?? strategyProfileModel)()
  const Version = await (deps.versionModel ?? strategyVersionModel)()
  if (!Profile || !Version) return empty

  try {
    const profile = await Profile.findOne({ _id: human }).lean()
    const versions = await Version.find({ strategyId: human }).sort({ createdAt: -1 }).lean()
    const versionIds = versions.map((v: Record<string, unknown>) => v._id)

    const Experiment = await (deps.experimentModel ?? experimentModel)()
    const AiProposal = await (deps.proposalModel ?? aiProposalModel)()
    const experiments = Experiment && versionIds.length
      ? await Experiment.find({ strategyVersionId: { $in: versionIds } }).sort({ createdAt: -1 }).lean()
      : []
    const proposals = AiProposal && versionIds.length
      ? await AiProposal.find({ strategyVersionId: { $in: versionIds } }).sort({ createdAt: -1 }).lean()
      : []

    return { profile: profile ?? null, versions, experiments, proposals, mongo: 'up' }
  } catch {
    return empty
  }
}

// -----------------------------------------------------------------------------
//  GET /research/proposals — list recorded AI proposals (§27.3). Data only.
// -----------------------------------------------------------------------------

export interface ListProposalsQuery {
  status?: string
  limit: number
}

export interface ListProposalsDeps {
  model?: typeof aiProposalModel
}

export async function listProposals(q: ListProposalsQuery, deps: ListProposalsDeps = {}): Promise<{ rows: Record<string, unknown>[]; mongo: 'up' | 'down' }> {
  const AiProposal = await (deps.model ?? aiProposalModel)()
  if (!AiProposal) return { rows: [], mongo: 'down' }
  const filter: Record<string, unknown> = {}
  if (q.status) filter.status = q.status
  try {
    const rows = await AiProposal.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean()
    return { rows, mongo: 'up' }
  } catch {
    return { rows: [], mongo: 'down' }
  }
}

// -----------------------------------------------------------------------------
//  POST /research/experiments — create a `proposed` experiment from a validated
//  §27.3 proposal. Proposals are DATA (D7): this writes an experiment doc only,
//  it never touches a preset, a profile or the risk gate.
// -----------------------------------------------------------------------------

export interface CreateExperimentDeps {
  proposal?: ProposalModule
  service?: ExperimentService
}

export async function createExperiment(body: unknown, deps: CreateExperimentDeps = {}): Promise<Record<string, unknown>> {
  const proposal = deps.proposal ?? await proposalModule()
  const v = proposal.validateProposal(body)
  if (!v.ok || !v.proposal) {
    throw new ResearchError(`invalid proposal: ${(v.errors ?? []).join(', ')}`, 400, 'invalid_proposal')
  }

  const service = deps.service ?? await experimentService()
  const res = await service.persistProposal(v.proposal)
  if (!res.ok) {
    // Mongo down is the only expected failure here (validated proposal).
    throw new ResearchError(res.code ?? 'experiment write failed', 503, res.code === 'MONGO_DOWN' ? 'mongo_down' : 'experiment_failed')
  }
  return res.exp as unknown as Record<string, unknown>
}

// -----------------------------------------------------------------------------
//  GET /research/experiments/:id — the experiment doc hydrated with its arm
//  runs, the §28.2 comparison and the §28.3 acceptance report.
// -----------------------------------------------------------------------------

export interface ExperimentResearch {
  experiment: Record<string, unknown> | null
  comparison: unknown
  acceptance: unknown
  mongo: 'up' | 'down'
}

export interface ExperimentResearchDeps {
  service?: ExperimentService
}

export async function getExperimentResearch(id: string, deps: ExperimentResearchDeps = {}): Promise<ExperimentResearch> {
  const human = String(id ?? '').trim()
  if (!human) return { experiment: null, comparison: null, acceptance: null, mongo: 'down' }
  const service = deps.service ?? await experimentService()
  const rep = await service.report(human)
  if (!rep.ok) return { experiment: null, comparison: null, acceptance: null, mongo: 'down' }
  return {
    experiment: rep.experiment as unknown as Record<string, unknown>,
    comparison: rep.comparison,
    acceptance: rep.acceptance,
    mongo: 'up'
  }
}

// -----------------------------------------------------------------------------
//  POST /research/experiments/:id/run — run one arm through the engine backtest
//  (engine/run.mjs runOne via experimentService.runArm). Metrics come from the
//  SAME summarizeRuns() block as every other run (D1).
// -----------------------------------------------------------------------------

export interface RunArmInput {
  role: string
  params?: Record<string, unknown>
  method?: string
  symbols?: string[]
  timeframes?: string[]
  market?: string
}

export interface RunArmDeps {
  /** Injected for tests — defaults to engine/run.mjs runOne with mongo 'auto'. */
  runOne?: (o: Record<string, unknown>) => Promise<unknown>
  service?: ExperimentService
  experimentModule?: ExperimentModule
}

export async function runExperimentArm(id: string, input: RunArmInput, deps: RunArmDeps = {}): Promise<Record<string, unknown>> {
  const human = String(id ?? '').trim()
  if (!human) throw new ResearchError('experiment id required', 400, 'invalid_id')

  const { ARM_NAMES } = deps.experimentModule ?? await experimentModule()
  if (!ARM_NAMES.includes(input.role)) {
    throw new ResearchError(`role must be one of ${ARM_NAMES.join('/')}`, 400, 'invalid_role')
  }

  let runOne = deps.runOne
  if (!runOne) {
    const mod = await runModule()
    runOne = (o) => mod.runOne({ ...o, mongo: 'auto' })
  }

  const service = deps.service ?? await experimentService()
  const res = await service.runArm({
    experimentId: human,
    role: input.role,
    params: input.params ?? {},
    method: input.method ?? 'vsa',
    symbols: input.symbols,
    timeframes: input.timeframes,
    market: input.market ?? 'fapi',
    runOne
  })

  if (!res.ok) {
    const code = String(res.code ?? 'experiment_failed')
    const status = code === 'EXP_NOT_FOUND' ? 404 : code === 'MONGO_DOWN' ? 503 : 500
    const statusMessage = code === 'EXP_NOT_FOUND' ? 'experiment_not_found' : code === 'MONGO_DOWN' ? 'mongo_down' : 'experiment_run_failed'
    throw new ResearchError(code, status, statusMessage)
  }
  return { role: input.role, summary: res.summary ?? null, runIds: res.runIds ?? [] }
}
