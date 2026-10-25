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
import { citeEvidenceSet, requireProposalEvidence } from './evidenceSets'

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

export interface ServerStrategyResearch {
  profile: Record<string, unknown> | null
  versions: Record<string, unknown>[]
  experiments: Record<string, unknown>[]
  proposals: Record<string, unknown>[]
  mongo: 'up' | 'down'
}

/** Injectable model loaders (tests pass fakes; production omits for the real ones). */
export interface ServerStrategyResearchDeps {
  profileModel?: typeof strategyProfileModel
  versionModel?: typeof strategyVersionModel
  experimentModel?: typeof experimentModel
  proposalModel?: typeof aiProposalModel
}

export async function getStrategyResearch(id: string, deps: ServerStrategyResearchDeps = {}, ownerId?: string | null): Promise<ServerStrategyResearch> {
  const human = String(id ?? '').trim()
  const empty: ServerStrategyResearch = { profile: null, versions: [], experiments: [], proposals: [], mongo: 'down' }
  if (!human) return empty

  const Profile = await (deps.profileModel ?? strategyProfileModel)()
  const Version = await (deps.versionModel ?? strategyVersionModel)()
  if (!Profile || !Version) return empty

  const own = ownerId ? { ownerId } : {}
  try {
    const profile = await Profile.findOne({ _id: human, ...own }).lean()
    const versions = await Version.find({ strategyId: human, ...own }).sort({ createdAt: -1 }).lean()
    const versionIds = versions.map((v: Record<string, unknown>) => v._id)

    const Experiment = await (deps.experimentModel ?? experimentModel)()
    const AiProposal = await (deps.proposalModel ?? aiProposalModel)()
    const experiments = Experiment && versionIds.length
      ? await Experiment.find({ strategyVersionId: { $in: versionIds }, ...own }).sort({ createdAt: -1 }).lean()
      : []
    const proposals = AiProposal && versionIds.length
      ? await AiProposal.find({ strategyVersionId: { $in: versionIds }, ...own }).sort({ createdAt: -1 }).lean()
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

export async function listProposals(q: ListProposalsQuery, deps: ListProposalsDeps = {}, ownerId?: string | null): Promise<{ rows: Record<string, unknown>[]; mongo: 'up' | 'down' }> {
  const AiProposal = await (deps.model ?? aiProposalModel)()
  if (!AiProposal) return { rows: [], mongo: 'down' }
  const filter: Record<string, unknown> = {}
  if (ownerId) filter.ownerId = ownerId
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
  /** Active strategy pointer — the baseline a candidate must beat (§59.15 Slice E). */
  profileModel?: () => Promise<{ findOne: (q: Record<string, unknown>) => { lean: () => Promise<Record<string, unknown> | null> } } | null>
  /** §59.15 Slice E: evidence-link hooks (tests inject; production uses the real service). */
  evidence?: {
    require?: typeof requireProposalEvidence
    cite?: typeof citeEvidenceSet
    /** Resolve the recorded proposal row — it is the only place `generation` lives. */
    proposalRow?: (proposalId: string) => Promise<Record<string, unknown> | null>
  }
}

/**
 * The version the active strategy profile currently points at (null when there
 * is no active profile, or when the store cannot answer).
 */
async function resolveActiveVersion(deps: CreateExperimentDeps, ownerId?: string | null): Promise<string | null> {
  try {
    const load = deps.profileModel ?? strategyProfileModel
    const Profile = await load()
    if (!Profile) return null
    const active = await Profile.findOne({ status: 'active', ...(ownerId ? { ownerId } : {}) }).lean().catch(() => null)
    const version = active ? String(active.strategyVersionId ?? '').trim() : ''
    return version || null
  } catch {
    return null
  }
}

export async function createExperiment(body: unknown, deps: CreateExperimentDeps = {}, ownerId?: string | null): Promise<Record<string, unknown>> {
  const proposal = deps.proposal ?? await proposalModule()
  const v = proposal.validateProposal(body)
  if (!v.ok || !v.proposal) {
    throw new ResearchError(`invalid proposal: ${(v.errors ?? []).join(', ')}`, 400, 'invalid_proposal')
  }

  // §59.15 Slice E — AI OUTPUT LINKS TO EVIDENCE.
  // A proposal the AI generated must cite a frozen, hash-intact evidence set
  // describing the same strategy version; otherwise the experiment is not
  // reproducible and the request is refused before anything is written.
  // Hand-written proposals may omit the link (the workflow decides whether that
  // is acceptable), and the check is deliberately skipped when the store is down
  // — persistProposal fails with MONGO_DOWN in that case anyway.
  const raw = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const cited = typeof raw.evidenceSetId === 'string' && raw.evidenceSetId.trim() ? raw.evidenceSetId.trim() : null
  const loadProposalRow = deps.evidence?.proposalRow ?? (async (proposalId: string) => {
    const AiProposal = await aiProposalModel()
    if (!AiProposal || !proposalId) return null
    return await AiProposal.findOne({ $or: [{ _id: proposalId }, { proposalId }], ...(ownerId ? { ownerId } : {}) }).lean().catch(() => null) as Record<string, unknown> | null
  })
  const proposalId = String((v.proposal as unknown as Record<string, unknown>).proposalId ?? '')
  const recorded = await loadProposalRow(proposalId)
  const aiGenerated = !!raw.generation || !!recorded?.generation
  const require_ = deps.evidence?.require ?? requireProposalEvidence
  const link = await require_(v.proposal as unknown as Record<string, unknown>, { evidenceSetId: cited, aiGenerated })

  const service = deps.service ?? await experimentService()

  // §59.15 Slice E — which version must the candidate BEAT? Read the active
  // pointer once, here, and freeze it into the experiment. Fail-soft: an
  // unreachable profile store leaves the baseline null, which the UI shows as
  // "baseline not recorded" — it never blocks an experiment, and it never
  // guesses the live pointer at decision time.
  const baselineVersionId = await resolveActiveVersion(deps, ownerId)

  const res = await service.persistProposal(
    v.proposal,
    { evidenceSetId: link.evidenceSetId, baselineVersionId, ownerId } as never
  ) as {
    ok: boolean
    code?: string
    exp?: Record<string, unknown> | null
  }
  if (!res.ok) {
    // Mongo down is the only expected failure here (validated proposal).
    throw new ResearchError(res.code ?? 'experiment write failed', 503, res.code === 'MONGO_DOWN' ? 'mongo_down' : 'experiment_failed')
  }

  // Back-reference so the UI can answer "which experiments used this evidence".
  const experimentId = res.exp ? String(res.exp.experimentId ?? res.exp._id ?? '') : ''
  if (link.evidenceSetId && experimentId) {
    const cite = deps.evidence?.cite ?? citeEvidenceSet
    await cite(link.evidenceSetId, experimentId)
  }

  return res.exp as unknown as Record<string, unknown>
}

// -----------------------------------------------------------------------------
//  GET /research/experiments/:id — the experiment doc hydrated with its arm
//  runs, the §28.2 comparison and the §28.3 acceptance report.
// -----------------------------------------------------------------------------

export interface ServerExperimentResearch {
  experiment: Record<string, unknown> | null
  comparison: unknown
  acceptance: unknown
  mongo: 'up' | 'down'
}

export interface ServerExperimentResearchDeps {
  service?: ExperimentService
}

export async function getExperimentResearch(id: string, deps: ServerExperimentResearchDeps = {}, ownerId?: string | null): Promise<ServerExperimentResearch> {
  const human = String(id ?? '').trim()
  if (!human) return { experiment: null, comparison: null, acceptance: null, mongo: 'down' }
  const service = deps.service ?? await experimentService()
  const rep = await service.report(human, {}, { ownerId: ownerId ?? null })
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

export async function runExperimentArm(id: string, input: RunArmInput, deps: RunArmDeps = {}, ownerId?: string | null): Promise<Record<string, unknown>> {
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
    runOne,
    ownerId: ownerId ?? null
  })

  if (!res.ok) {
    const code = String(res.code ?? 'experiment_failed')
    const status = code === 'EXP_NOT_FOUND' ? 404 : code === 'MONGO_DOWN' ? 503 : 500
    const statusMessage = code === 'EXP_NOT_FOUND' ? 'experiment_not_found' : code === 'MONGO_DOWN' ? 'mongo_down' : 'experiment_run_failed'
    throw new ResearchError(code, status, statusMessage)
  }
  return { role: input.role, summary: res.summary ?? null, runIds: res.runIds ?? [] }
}

// -----------------------------------------------------------------------------
//  GET /research/experiments — list recorded experiments (§28.1). Fail-soft:
//  Mongo down => empty list + mongo='down'. `status` narrows to one lifecycle
//  state (e.g. ?status=proposed reviews what the AI proposed and awaits).
// -----------------------------------------------------------------------------

export interface ListExperimentsQuery {
  status?: string
  limit: number
}

export interface ListExperimentsDeps {
  model?: typeof experimentModel
}

export async function listExperiments(q: ListExperimentsQuery, deps: ListExperimentsDeps = {}, ownerId?: string | null): Promise<{ rows: Record<string, unknown>[]; mongo: 'up' | 'down' }> {
  const Experiment = await (deps.model ?? experimentModel)()
  if (!Experiment) return { rows: [], mongo: 'down' }
  const filter: Record<string, unknown> = {}
  if (ownerId) filter.ownerId = ownerId
  if (q.status) filter.status = q.status
  try {
    const rows = await Experiment.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean()
    return { rows, mongo: 'up' }
  } catch {
    return { rows: [], mongo: 'down' }
  }
}

// -----------------------------------------------------------------------------
//  POST /research/experiments/:id/move — advance the §28.1 lifecycle one legal
//  step (proposed -> approved -> ... -> paper_validation). The engine's
//  transition() refuses illegal jumps; this only maps its code to HTTP. A human
//  drives the state machine — nothing here reaches `accepted` (only decide()).
// -----------------------------------------------------------------------------

export interface MoveExperimentDeps {
  service?: ExperimentService
}

export async function moveExperimentResearch(id: string, to: string, deps: MoveExperimentDeps = {}, ownerId?: string | null): Promise<Record<string, unknown>> {
  const human = String(id ?? '').trim()
  if (!human) throw new ResearchError('experiment id required', 400, 'invalid_id')
  const state = String(to ?? '').trim()
  if (!state) throw new ResearchError('target state required', 400, 'invalid_state')

  const service = deps.service ?? await experimentService()
  const res = await service.moveExperiment(human, state, { ownerId: ownerId ?? null })
  if (!res.ok) throw experimentWriteError(String(res.code ?? 'experiment_failed'))
  return res.exp as unknown as Record<string, unknown>
}

// -----------------------------------------------------------------------------
//  POST /research/experiments/:id/decide — accept/reject (§28.1 / §28.3). Accept
//  re-runs the §28.3 gate over the persisted arms; a failing gate is 409
//  acceptance_gate_failed. The same gates are visible on the detail endpoint, so
//  the UI can show WHY a candidate was not accepted.
// -----------------------------------------------------------------------------

export interface DecideExperimentDeps {
  service?: ExperimentService
}

export interface DecideExperimentOptions {
  minTrades?: number
  maxDegenerate?: number
  ddSlackPct?: number
}

export async function decideExperiment(id: string, accept: boolean, opts: DecideExperimentOptions = {}, deps: DecideExperimentDeps = {}, ownerId?: string | null): Promise<Record<string, unknown>> {
  const human = String(id ?? '').trim()
  if (!human) throw new ResearchError('experiment id required', 400, 'invalid_id')

  const service = deps.service ?? await experimentService()
  const res = await service.decide({ experimentId: human, accept, opts, ...(ownerId ? { ownerId } : {}) })
  if (!res.ok) throw experimentWriteError(String(res.code ?? 'experiment_failed'))
  return res.exp as unknown as Record<string, unknown>
}

/**
 * Map an engine write code to an HTTP intent, shared by move/decide so both
 * surfaces fail the same way: unknown experiment -> 404, store down -> 503, an
 * illegal/again transition or a failed acceptance gate -> 409.
 */
function experimentWriteError(code: string): ResearchError {
  if (code === 'EXP_NOT_FOUND') return new ResearchError(code, 404, 'experiment_not_found')
  if (code === 'MONGO_DOWN') return new ResearchError(code, 503, 'mongo_down')
  if (code.startsWith('EXP_ILLEGAL') || code === 'EXP_ALREADY' || code.startsWith('EXP_BAD_STATE')) {
    return new ResearchError(code, 409, 'illegal_transition')
  }
  if (code === 'EXP_GATE_FAILED') return new ResearchError(code, 409, 'acceptance_gate_failed')
  return new ResearchError(code, 500, 'experiment_failed')
}
