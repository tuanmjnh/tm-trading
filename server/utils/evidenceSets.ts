import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  engineModel,
  evidenceSetModel,
  strategyProfileModel,
  tradingSessionModel
} from './engineModel'
import { buildSeriesId, loadRunSeries, parseSeriesId } from './reports'
import { startSession } from './sessions'

// =============================================================================
//  Research Evidence Sets (V3.5 §59.15 Slice E) — service layer.
//
//  The PURE core is engine/evidence.mjs (id, bundle, hash, link rules). This file
//  only hydrates the docs that core needs, persists the frozen result once, and
//  maps failures to HTTP. Nothing here decides policy.
//
//  Reads are fail-soft (empty + `mongo:'down'`, never a 500); writes surface
//  failure so a reviewer is told the evidence could not be frozen.
// =============================================================================

type EvidenceModule = typeof import('../../engine/evidence.mjs')

let evidenceModP: Promise<EvidenceModule> | null = null

function evidenceModule(): Promise<EvidenceModule> {
  if (!evidenceModP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'evidence.mjs')).href
    // @vite-ignore — engine/ lives outside server/ (docs/app-inheritance.md).
    evidenceModP = import(/* @vite-ignore */ href) as Promise<EvidenceModule>
  }
  return evidenceModP
}

export class EvidenceError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'evidence_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function evidenceHttpError(err: unknown) {
  if (err instanceof EvidenceError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'evidence_failed', message: e?.message || 'evidence failed' })
}

/** Map a pure-guard code to an HTTP intent (400 missing, 409 conflict/tamper). */
function linkError(code: string, message: string): EvidenceError {
  const conflict = ['SET_TAMPERED', 'NOT_FROZEN', 'EVIDENCE_MISMATCH', 'EVIDENCE_WRONG_VERSION', 'EVIDENCE_ALREADY_FROZEN', 'CANDIDATE_IS_ACTIVE', 'NOT_IN_PAPER_VALIDATION']
  return new EvidenceError(message, conflict.includes(code) ? 409 : 400, code.toLowerCase())
}

type AnyDoc = Record<string, any>
type ModelLoader = () => Promise<AnyDoc | null>

/** Injectable loaders — tests pass fakes, production omits them. */
export interface EvidenceDeps {
  sessionModel?: ModelLoader
  evidenceSetModel?: ModelLoader
  orderModel?: ModelLoader
  fillModel?: ModelLoader
  positionModel?: ModelLoader
  profileModel?: ModelLoader
  experimentModel?: ModelLoader
  /** §59.15 Slice E — non-session sources. */
  runModel?: ModelLoader
  tradeModel?: ModelLoader
  datasetModel?: ModelLoader
  /** Run-series reader (reports/*.ndjson) — injected so tests stay offline. */
  runsSeries?: () => Promise<{ series: AnyDoc[] }>
  evidence?: () => Promise<EvidenceModule>
  /** Slice C session starter — injected so the launch path is testable offline. */
  startSession?: (input: Record<string, unknown>) => Promise<AnyDoc>
}

const loadModel = (deps: EvidenceDeps, key: keyof EvidenceDeps, fallback: ModelLoader): ModelLoader =>
  (deps[key] as ModelLoader | undefined) ?? fallback

function modelLoaders(deps: EvidenceDeps) {
  return {
    Session: loadModel(deps, 'sessionModel', tradingSessionModel),
    Evidence: loadModel(deps, 'evidenceSetModel', evidenceSetModel),
    Order: loadModel(deps, 'orderModel', () => engineModel('order.mjs', 'PaperOrder')),
    Fill: loadModel(deps, 'fillModel', () => engineModel('fill.mjs', 'PaperFill')),
    Position: loadModel(deps, 'positionModel', () => engineModel('position.mjs', 'Position')),
    Profile: loadModel(deps, 'profileModel', strategyProfileModel),
    Experiment: loadModel(deps, 'experimentModel', () => engineModel('experiment.mjs', 'Experiment')),
    Run: loadModel(deps, 'runModel', () => engineModel('run.mjs', 'Run')),
    Trade: loadModel(deps, 'tradeModel', () => engineModel('trade.mjs', 'Trade')),
    Dataset: loadModel(deps, 'datasetModel', () => engineModel('dataset.mjs', 'Dataset'))
  }
}

/** Kinds whose source is a trading session (they carry orders/fills/positions). */
const SESSION_KINDS = ['paper-session', 'replay-session']

/** Datasets referenced by a session manifest, whatever shape it was written in. */
function manifestDatasetIds(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== 'object') return []
  const m = manifest as Record<string, unknown>
  const raw = m.datasetIds ?? m.datasets ?? m.data
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>)?.datasetId ?? '')))
      .filter(Boolean)
  }
  if (typeof raw === 'string') return [raw]
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).datasetId) {
    return [String((raw as Record<string, unknown>).datasetId)]
  }
  return []
}

export interface CreateEvidenceInput {
  kind?: string
  sourceId?: string
  notes?: string[]
  createdBy?: string | null
  /** Tenancy (roadmap §61.3): the freezing hub user id. */
  ownerId?: string | null
}

/**
 * Content hash of just the FACTS in a set — the same hash `verifyEvidenceSet`
 * uses, minus the free-text `limitations` the caller can add notes to. Used to
 * answer "has the source changed since it was frozen?" without mistaking a new
 * note for a new fact.
 */
function factsHash(mod: EvidenceModule, doc: AnyDoc): string {
  return String(mod.evidenceHash({ ...doc, limitations: [] }))
}

/**
 * Hydrate a run SERIES from reports/*.ndjson — the id shape the dashboard uses
 * for backtests. The series carries the stamps (D1) and the full parameter set,
 * so the manifest here is exactly what makes the run reproducible.
 */
async function hydrateRunSeries(
  sourceId: string,
  deps: EvidenceDeps
): Promise<Record<string, unknown>> {
  const read = deps.runsSeries ?? (loadRunSeries as unknown as () => Promise<{ series: AnyDoc[] }>)
  const { series } = await read()

  const parsed = parseSeriesId(sourceId)
  const canonical = parsed ? buildSeriesId(parsed) : sourceId
  const detail = (series ?? []).find((s) => s.id === sourceId) ?? (series ?? []).find((s) => s.id === canonical)
  if (!detail) throw new EvidenceError(`backtest run not found: ${sourceId}`, 404, 'run_not_found')

  const stamps = {
    paramsHash: detail.paramsHash ?? null,
    engineVersion: detail.engineVersion ?? null,
    symbol: detail.symbol ?? null,
    tf: detail.tf ?? null,
  }
  // Stamps live on the SERIES, not on a report trade row (paramsHash is what
  // groups the rows); copy them onto each row so every trade is self-describing
  // inside the frozen set.
  const trades = (detail.trades ?? []).slice(0, 500).map((t: AnyDoc) => ({ ...t, ...stamps }))

  const warnings = Array.isArray(detail.warnings) ? detail.warnings : []
  const notes: string[] = []
  if (warnings.length) {
    const summary = warnings.slice(0, 3).map((w: AnyDoc) => String(w?.message ?? w?.code ?? w)).join('; ')
    notes.push(`the run reported ${warnings.length} warning(s)${summary ? `: ${summary}` : ''}`)
  }
  if (Number(detail.duplicateTrades ?? 0) > 0) {
    notes.push(`${detail.duplicateTrades} duplicate trade row(s) were removed before freezing`)
  }
  if (Number(detail.dataHashCount ?? 1) > 1) {
    notes.push(`${detail.dataHashCount} distinct dataHash values in this series — it is not one data snapshot`)
  }

  return {
    session: null,
    orders: [],
    fills: [],
    positions: trades,
    datasetIds: [],
    // The stamp + the full parameter set ARE the identity of a backtest.
    manifest: {
      seriesId: String(detail.id ?? canonical),
      mode: detail.mode ?? 'BACKTEST',
      engineVersion: detail.engineVersion ?? null,
      paramsHash: detail.paramsHash ?? null,
      params: detail.params ?? null,
      dataHashes: detail.dataHashes ?? [],
      gitRevs: detail.gitRevs ?? [],
      symbol: detail.symbol ?? null,
      tf: detail.tf ?? null,
      market: detail.market ?? null,
      method: detail.method ?? null,
      preset: detail.preset ?? null,
      firstRunAt: detail.firstRunAt ?? null,
      lastRunAt: detail.lastRunAt ?? null,
      rawTrades: detail.rawTrades ?? null,
      duplicateTrades: detail.duplicateTrades ?? null,
    },
    instruments: detail.symbol ? [detail.symbol] : [],
    timeframes: detail.tf ? [String(detail.tf)] : [],
    strategyVersionId: null,
    sessionId: null,
    notes,
  }
}

/**
 * Resolve the facts a bundle is built from, per source kind.
 *
 * A session set hydrates the session plus everything it produced. A backtest
 * run hydrates the run's stamp (its versioned identity) and its trades. A
 * dataset hydrates the retention manifest. Each branch 404s when the source
 * does not exist — freezing never assembles a bundle from whatever happened to
 * match — and every branch states its own identity rather than borrowing a
 * session's.
 */
async function hydrateSource(
  kind: string,
  sourceId: string,
  input: CreateEvidenceInput,
  loaders: ReturnType<typeof modelLoaders>,
  deps: EvidenceDeps,
  ownerId?: string | null
): Promise<Record<string, unknown>> {
  const own = ownerId ? { ownerId } : {}
  if (SESSION_KINDS.includes(kind)) {
    const { Session, Order, Fill, Position } = loaders
    const SessionM = await Session()
    if (!SessionM) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')

    const session = await SessionM.findOne({ $or: [{ _id: sourceId }, { sessionId: sourceId }], ...own }).lean().catch(() => null)
    if (!session) throw new EvidenceError(`trading session not found: ${sourceId}`, 404, 'session_not_found')

    const sessionKey = String(session.sessionId ?? session._id)
    const [OrderM, FillM, PositionM] = await Promise.all([Order(), Fill(), Position()])
    const [orders, fills, positions] = await Promise.all([
      OrderM ? OrderM.find({ sessionId: sessionKey, ...own }).limit(500).lean().catch(() => []) : Promise.resolve([]),
      FillM ? FillM.find({ sessionId: sessionKey, ...own }).limit(500).lean().catch(() => []) : Promise.resolve([]),
      PositionM ? PositionM.find({ sessionId: sessionKey, ...own }).limit(500).lean().catch(() => []) : Promise.resolve([])
    ])
    return { session, orders, fills, positions, datasetIds: manifestDatasetIds(session.manifest) }
  }

  if (kind === 'backtest-run') {
    // Two id shapes reach here: a Mongo run `_id` (the store path) and the
    // series id `engineVersion~symbol~tf~paramsHash` the Test Center links,
    // compares and traces (reports/*.ndjson). Reports are ALWAYS written while
    // Mongo is optional (engine/store.mjs), so the series path is the one the
    // dashboard can freeze every run through — and it freezes the same rows the
    // run page displays (D12: evidence is what the reader already saw).
    if (sourceId.includes('~')) {
      return hydrateRunSeries(sourceId, deps)
    }

    const { Run, Trade } = loaders
    const [RunM, TradeM] = await Promise.all([Run(), Trade()])
    if (!RunM) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')

    const run = await RunM.findOne({ _id: sourceId, ...own }).lean().catch(() => null)
    if (!run) throw new EvidenceError(`backtest run not found: ${sourceId}`, 404, 'run_not_found')
    const trades = TradeM
      ? await TradeM.find({ runId: run._id, ...own }).limit(500).lean().catch(() => [])
      : []

    return {
      session: null,
      orders: [],
      fills: [],
      // A backtest has orders only in the simulated sense: `trades` is the
      // realized record, and counting it as paper orders would claim fills a
      // simulation never produced.
      positions: trades,
      datasetIds: manifestDatasetIds(run.universeSnapshot),
      // The run's stamp IS its versioned identity (D1). A run is not a
      // strategy version — claiming one would let a params experiment pass as
      // a versioned strategy change.
      manifest: {
        runId: String(run._id),
        engineVersion: run.engineVersion ?? null,
        paramsHash: run.paramsHash ?? null,
        dataHash: run.dataHash ?? null,
        gitRev: run.gitRev ?? null,
        method: run.method ?? null,
        market: run.market ?? null,
        symbol: run.symbol ?? null,
        tf: run.tf ?? null,
        bars: run.bars ?? 0,
        from: run.from ?? null,
        to: run.to ?? null,
        universeSnapshot: run.universeSnapshot ?? null
      },
      instruments: run.symbol ? [run.symbol] : [],
      timeframes: run.tf ? [run.tf] : [],
      strategyVersionId: null,
      sessionId: null
    }
  }

  if (kind === 'dataset') {
    const { Dataset } = loaders
    const DatasetM = await Dataset()
    if (!DatasetM) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')

    const ds = await DatasetM.findOne({ $or: [{ _id: sourceId }, { datasetId: sourceId }] }).lean().catch(() => null)
    if (!ds) throw new EvidenceError(`dataset not found: ${sourceId}`, 404, 'dataset_not_found')

    const notes: string[] = []
    if (ds.suspect) notes.push('reconciliation marked this dataset suspect — anything derived from it must be re-derived')
    if (!ds.checksum) notes.push('no whole-dataset checksum yet (live append stream) — content is declared, not proven')
    if (!ds.count) notes.push('dataset holds no rows yet')
    notes.push('dataset evidence carries coverage and integrity facts only — it contains no trade outcomes')

    return {
      session: null,
      orders: [],
      fills: [],
      positions: [],
      datasetIds: [String(ds.datasetId ?? ds._id)],
      manifest: {
        datasetId: String(ds.datasetId ?? ds._id),
        kind: ds.kind ?? null,
        source: ds.source ?? null,
        symbol: ds.symbol ?? null,
        timeframe: ds.timeframe ?? null,
        schemaVersion: ds.schemaVersion ?? null,
        retentionDays: ds.retentionDays ?? null,
        compression: ds.compression ?? null,
        checksum: ds.checksum ?? null,
        startTs: ds.startTs ?? null,
        endTs: ds.endTs ?? null,
        count: ds.count ?? 0,
        suspect: ds.suspect === true,
        lastReconcileAt: ds.lastReconcileAt ?? null,
        lastReconcile: ds.lastReconcile ?? null
      },
      instruments: ds.symbol ? [ds.symbol] : [],
      timeframes: ds.timeframe ? [String(ds.timeframe)] : [],
      strategyVersionId: null,
      sessionId: null,
      dataQuality: {
        state: ds.suspect ? 'suspect' : (ds.checksum ? 'verified' : 'declared'),
        datasets: [String(ds.datasetId ?? ds._id)]
      },
      notes
    }
  }

  throw new EvidenceError(`unknown evidence kind: ${kind || 'empty'} (expected one of ${['paper-session', 'replay-session', 'backtest-run', 'dataset'].join('|')})`, 400, 'invalid_kind')
}

/**
 * Freeze the evidence of one source. Freezing is idempotent by identity (D3):
 * a second attempt returns the set that already exists rather than creating a
 * competing one, flagging `sourceChanged` when the recorded facts have moved on.
 */
export async function createEvidenceSet(input: CreateEvidenceInput, deps: EvidenceDeps = {}): Promise<AnyDoc> {
  const loaders = modelLoaders(deps)
  const { Evidence } = loaders
  const mod = await (deps.evidence ?? evidenceModule)()
  const kind = String(input.kind ?? 'paper-session').trim()
  const sourceId = String(input.sourceId ?? '').trim()
  if (!sourceId) throw new EvidenceError('sourceId is required', 400, 'invalid_source')
  if (!mod.EVIDENCE_KINDS.includes(kind as never)) {
    throw new EvidenceError(`invalid evidence kind: ${kind || 'empty'}`, 400, 'invalid_kind')
  }

  const EvidenceM = await Evidence()
  if (!EvidenceM) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')

  const source = await hydrateSource(kind, sourceId, input, loaders, deps, input.ownerId)
  const callerNotes = Array.isArray(input.notes) ? input.notes.map(String) : []
  const sourceNotes = (source.notes as string[] | undefined) ?? []

  let doc: AnyDoc
  try {
    const bundle = mod.buildEvidenceBundle({
      kind,
      sourceId,
      ...source,
      // Source-derived limitations come first; the caller's notes add to them
      // and can never replace them.
      notes: [...sourceNotes, ...callerNotes],
      frozenAt: Date.now()
    } as never)
    doc = mod.freezeEvidenceSet(bundle) as AnyDoc
  } catch (err) {
    throw new EvidenceError(err instanceof Error ? err.message : 'invalid evidence', 400, 'invalid_evidence')
  }

  // Never mutate the frozen doc: `freezeEvidenceSet` returns a frozen object on
  // purpose. Attribution lives outside the hash, so it is added by copy.
  // Tenancy (roadmap §61.3): ownerId is attribution, not part of the hash.
  doc = { ...doc, createdBy: input.createdBy ?? null, usedByExperimentIds: [], ownerId: input.ownerId ?? null }

  // One set per source (D3): a repeat freeze returns the set that already
  // exists — it does not fork a second version of the same run. If the source
  // moved on since (more trades, different hash), say so instead of quietly
  // pretending the frozen set still describes it.
  // Tenancy (§61.3): the lookup is owner-scoped so one owner never reads
  // another's set. NOTE the known limitation — the deterministic `_id`
  // (evidenceSetIdFor) is not owner-derived, so two owners freezing the SAME
  // source id collide; owner-scoped id derivation is a documented follow-up.
  const existing = await EvidenceM.findOne({ _id: doc._id, ...(input.ownerId ? { ownerId: input.ownerId } : {}) }).lean().catch(() => null) as AnyDoc | null
  if (existing) {
    return {
      ...existing,
      alreadyFrozen: true,
      // "Did the SOURCE move on?" — compared on facts only. A caller's note is
      // commentary, not a change in the run: freezing again with a different
      // note must not claim the session changed.
      sourceChanged: factsHash(mod, existing) !== factsHash(mod, doc)
    }
  }

  try {
    await EvidenceM.create(doc)
  } catch (err) {
    // Only a genuine race reaches here — the unique `_id` is the guard (D4).
    if ((err as { code?: unknown })?.code === 11000) {
      throw new EvidenceError(`${doc._id} is already frozen — freeze is write-once`, 409, 'evidence_already_frozen')
    }
    throw err
  }

  const stored = await EvidenceM.findOne({ _id: doc._id, ...(input.ownerId ? { ownerId: input.ownerId } : {}) }).lean().catch(() => null)
  return (stored ?? doc) as AnyDoc
}

// -----------------------------------------------------------------------------
// Auto-freeze on completion (§59.15) — a sealed session's evidence is frozen the
// moment it reaches a terminal state, so an AI proposal always has a citable,
// hash-verified set to point at instead of a run nobody remembered to freeze.
//
// Policy lives here (not in engine/session.mjs, which stays IO-free): engine
// decides WHEN a session is terminal, this decides WHAT that means for evidence.
// -----------------------------------------------------------------------------

/** Session states after which their evidence is frozen (terminal, sealed). */
export const AUTO_FREEZE_SESSION_STATES = Object.freeze(['completed', 'failed', 'halted'])

/**
 * The evidence kind a session maps to: a replay session's facts are labelled
 * differently from a live-paper one so a reader never mistakes a replay for
 * live evidence.
 */
export function sessionEvidenceKind(kind: unknown): 'paper-session' | 'replay-session' {
  return String(kind ?? '').trim() === 'replay' ? 'replay-session' : 'paper-session'
}

export interface AutoFreezeResult {
  /** True when a set now exists for the session (frozen now OR already there). */
  frozen: boolean
  /** True when this call created the set (vs it already existing). */
  created: boolean
  setId: string | null
  /** Non-fatal explanation when the set could not be frozen. */
  reason?: string
}

/**
 * Freeze a session's evidence if it is in a terminal state. Idempotent (D3):
 * a session already frozen returns its existing set with `created:false`, never
 * a competing one. Deliberately fail-soft — it reports WHY it could not freeze
 * (state, store down, source missing) instead of throwing, because it runs as a
 * side-effect of a completed lifecycle transition that must not be rolled back
 * by an evidence hiccup. The manual Freeze button still surfaces real errors.
 */
export async function autoFreezeSessionEvidence(
  session: Record<string, unknown> | null | undefined,
  deps: EvidenceDeps = {}
): Promise<AutoFreezeResult> {
  const sid = String(session?.sessionId ?? session?._id ?? '').trim()
  if (!sid) return { frozen: false, created: false, setId: null, reason: 'no session id' }

  const state = String(session?.state ?? '')
  if (!AUTO_FREEZE_SESSION_STATES.includes(state)) {
    return { frozen: false, created: false, setId: null, reason: `state ${state || 'empty'} is not terminal` }
  }

  try {
    const doc = await createEvidenceSet(
      { kind: sessionEvidenceKind(session?.kind), sourceId: sid, ownerId: (session?.ownerId as string | null) ?? null },
      deps
    )
    return {
      frozen: true,
      created: doc.alreadyFrozen !== true,
      setId: String(doc.setId ?? doc._id ?? '') || null
    }
  } catch (err) {
    // Fail-soft on purpose (see docblock). The session is already sealed; a
    // frozen set can still be created later via the manual button.
    return {
      frozen: false,
      created: false,
      setId: null,
      reason: err instanceof Error ? err.message : String(err)
    }
  }
}

export interface BackfillResult {
  /** Terminal sessions examined in this run. */
  scanned: number
  /** Sets created by this run. */
  frozen: number
  /** Sessions that already had their set (no work done). */
  already: number
  /** Sessions whose freeze failed this run (fail-soft, retried next run). */
  failed: number
  /** Non-fatal explanation when the sweep could not run at all. */
  reason?: string
}

/**
 * Backfill: freeze evidence for terminal sessions that have no set yet —
 * sessions sealed BEFORE auto-freeze existed, or whose seal-time freeze failed
 * fail-soft (store outage). Auto-freeze covers every NEW seal; this covers the
 * backlog. Idempotent by identity (D3) and capped, so a run is bounded work:
 * sessions are checked by expected `_id` first and only MISSING sets hydrate.
 * Never throws — the boot plugin reports whatever this returns.
 */
export async function backfillTerminalSessionEvidence(
  deps: EvidenceDeps = {},
  opts: { limit?: number } = {}
): Promise<BackfillResult> {
  const out: BackfillResult = { scanned: 0, frozen: 0, already: 0, failed: 0 }
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
  const loaders = modelLoaders(deps)
  const [SessionM, EvidenceM] = await Promise.all([loaders.Session(), loaders.Evidence()])
  if (!SessionM || !EvidenceM) {
    return { ...out, reason: 'mongo down (session or evidence store unavailable)' }
  }
  const mod = await (deps.evidence ?? evidenceModule)()

  let sessions: AnyDoc[] = []
  try {
    sessions = await SessionM.find({ state: { $in: [...AUTO_FREEZE_SESSION_STATES] } })
      .sort({ stoppedAt: -1, _id: -1 })
      .limit(limit)
      .lean() as AnyDoc[]
  } catch {
    return { ...out, reason: 'session query failed' }
  }
  out.scanned = sessions.length

  for (const s of sessions) {
    const sid = String(s.sessionId ?? s._id ?? '').trim()
    if (!sid) { out.failed += 1; continue }
    try {
      const setId = String(mod.evidenceSetIdFor({ kind: sessionEvidenceKind(s.kind), sourceId: sid }))
      const existing = await EvidenceM.findOne({ _id: setId }).lean().catch(() => null) as AnyDoc | null
      if (existing) { out.already += 1; continue }
      // Missing -> the same fail-soft, idempotent freeze the move handler uses.
      const res = await autoFreezeSessionEvidence(s, deps)
      if (res.frozen && res.created) out.frozen += 1
      else if (res.frozen) out.already += 1 // won a race with another writer
      else out.failed += 1
    } catch {
      out.failed += 1
    }
  }
  return out
}

export interface ListEvidenceQuery {
  kind?: string
  sessionId?: string
  strategyVersionId?: string
  limit?: number
}

export async function listEvidenceSets(q: ListEvidenceQuery = {}, deps: EvidenceDeps = {}, ownerId?: string | null): Promise<AnyDoc[]> {
  const Evidence = await modelLoaders(deps).Evidence()
  if (!Evidence) return []
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const filter: Record<string, unknown> = {}
  if (ownerId) filter.ownerId = ownerId
  if (q.kind) filter.kind = q.kind
  if (q.sessionId) filter.sessionId = q.sessionId
  if (q.strategyVersionId) filter.strategyVersionId = q.strategyVersionId
  try {
    return (await Evidence.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean()) as AnyDoc[]
  } catch {
    return []
  }
}

/** Read one set and re-verify its hash (a tampered set is reported, not repaired). */
export async function getEvidenceSet(id: string, deps: EvidenceDeps = {}, ownerId?: string | null): Promise<AnyDoc | null> {
  const key = String(id ?? '').trim()
  if (!key) return null
  const Evidence = await modelLoaders(deps).Evidence()
  if (!Evidence) return null
  const mod = await (deps.evidence ?? evidenceModule)()
  try {
    const doc = await Evidence.findOne({ $or: [{ _id: key }, { setId: key }], ...(ownerId ? { ownerId } : {}) }).lean() as AnyDoc | null
    if (!doc) return null
    const integrity = mod.verifyEvidenceSet(doc) as { ok: boolean; code?: string; hash?: string }
    const sufficiency = mod.evidenceSufficiency(doc) as { sufficient: boolean; reasons: string[] }
    return {
      ...doc,
      integrity: { ok: integrity.ok, code: integrity.ok ? 'OK' : integrity.code },
      sufficiency
    }
  } catch {
    return null
  }
}

/**
 * Record that an experiment cited this set (append-only back-reference). Kept
 * separate from the freeze so a citation can never alter the evidence itself.
 */
export async function citeEvidenceSet(setId: string, experimentId: string, deps: EvidenceDeps = {}, ownerId?: string | null): Promise<void> {
  const Evidence = await modelLoaders(deps).Evidence()
  if (!Evidence) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')
  try {
    await Evidence.updateOne({ _id: setId, ...(ownerId ? { ownerId } : {}) }, { $addToSet: { usedByExperimentIds: experimentId } })
  } catch (err) {
    throw new EvidenceError(`could not cite ${setId}: ${(err as Error)?.message ?? err}`, 503, 'evidence_cite_failed')
  }
}

export interface EvidenceLinkResult {
  ok: boolean
  code?: string
  message?: string
  required?: boolean
  hash?: string
  evidenceSetId: string | null
}

/**
 * Verify that a proposal may cite the evidence it claims. AI-generated proposals
 * (those with `generation` recorded, or carrying it on the request) MUST cite a
 * frozen, hash-intact set describing the same strategy version.
 */
export async function requireProposalEvidence(
  proposal: Record<string, unknown>,
  { evidenceSetId = null, aiGenerated = null }: { evidenceSetId?: string | null; aiGenerated?: boolean | null } = {},
  deps: EvidenceDeps = {},
  ownerId?: string | null
): Promise<EvidenceLinkResult> {
  const cited = String(evidenceSetId ?? proposal?.evidenceSetId ?? '').trim() || null
  const mod = await (deps.evidence ?? evidenceModule)()
  const set = cited ? await getEvidenceSet(cited, deps, ownerId) : null
  // engine/*.mjs carry no TS types, so their destructured defaults narrow the
  // parameter types to `null`. Cast at the boundary (same pattern as the other
  // engine calls in this file) and validate the result shape below.
  const res = mod.proposalEvidenceLink(
    { ...proposal, evidenceSetId: cited } as never,
    { evidenceSet: set, aiGenerated } as never
  ) as { ok: boolean; code?: string; message?: string; required?: boolean; hash?: string }
  if (!res.ok) throw linkError(String(res.code ?? 'evidence_required'), String(res.message ?? 'evidence required'))
  return { ...res, evidenceSetId: cited }
}

export interface PaperSessionInput {
  instruments?: string[]
  timeframes?: string[]
  accountId?: string
  createdBy?: string | null
  evidenceSetId?: string | null
}

/**
 * Launch the governed paper-validation session for an experiment (§59.13 /
 * §59.15). Refuses unless the experiment is in `paper_validation`, and refuses
 * when the candidate version is ALREADY the active profile pointer — that would
 * mean it was promoted silently (D31), not validated.
 */
export async function createPaperValidationSession(
  experimentId: string,
  input: PaperSessionInput = {},
  deps: EvidenceDeps = {},
  ownerId?: string | null
): Promise<AnyDoc> {
  const { Experiment, Profile } = modelLoaders(deps)
  const mod = await (deps.evidence ?? evidenceModule)()
  const id = String(experimentId ?? '').trim()
  if (!id) throw new EvidenceError('experiment id is required', 400, 'invalid_id')

  const [ExperimentM, ProfileM] = await Promise.all([Experiment(), Profile()])
  if (!ExperimentM) throw new EvidenceError('experiment store unavailable', 503, 'mongo_down')

  const experiment = await ExperimentM.findOne({ $or: [{ _id: id }, { experimentId: id }], ...(ownerId ? { ownerId } : {}) }).lean().catch(() => null) as AnyDoc | null
  if (!experiment) throw new EvidenceError(`experiment not found: ${id}`, 404, 'experiment_not_found')

  const edge = mod.paperValidationEdge(experiment) as { ok: boolean; code?: string; message?: string; candidateVersionId?: string }
  if (!edge.ok) throw linkError(String(edge.code ?? 'NOT_IN_PAPER_VALIDATION'), String(edge.message ?? 'not in paper validation'))
  const candidateVersionId = String(edge.candidateVersionId)

  // Authoritative active pointer: any ACTIVE profile already on the candidate.
  if (ProfileM) {
    const active = await ProfileM.findOne({ status: 'active', strategyVersionId: candidateVersionId, ...(ownerId ? { ownerId } : {}) }).lean().catch(() => null)
    const independent = mod.candidateIndependence({
      candidateVersionId,
      activeVersionId: active ? String(active.strategyVersionId) : null
    }) as { ok: boolean; code?: string; message?: string }
    if (!independent.ok) throw linkError(String(independent.code ?? 'CANDIDATE_IS_ACTIVE'), String(independent.message ?? 'candidate already active'))
  }

  const start = deps.startSession ?? (startSession as unknown as (input: Record<string, unknown>) => Promise<AnyDoc>)
  const session = await start({
    kind: 'live-paper',
    strategyVersionId: candidateVersionId,
    accountId: input.accountId ?? experiment.accountId ?? 'default',
    instruments: input.instruments ?? experiment.recommendedTest?.symbols ?? [],
    timeframes: input.timeframes ?? experiment.recommendedTest?.timeframes ?? [],
    // The session manifest carries the provenance of WHY this run exists — the
    // experiment and the frozen evidence it was derived from (Slice C + E).
    manifest: {
      purpose: 'paper-validation',
      experimentId: String(experiment.experimentId ?? experiment._id),
      candidateVersionId,
      baselineVersionId: experiment.baselineVersionId ?? null,
      evidenceSetId: input.evidenceSetId ?? experiment.evidenceSetId ?? null
    },
    createdBy: input.createdBy ?? null,
    ownerId: ownerId ?? null
  })

  const sessionId = String(session.sessionId ?? '')
  try {
    await ExperimentM.updateOne(
      { _id: experiment._id, ...(ownerId ? { ownerId } : {}) },
      { $addToSet: { paperSessionIds: sessionId } }
    )
  } catch (err) {
    throw new EvidenceError(`session ${sessionId} started but could not be linked to the experiment: ${(err as Error)?.message ?? err}`, 503, 'experiment_link_failed')
  }

  return { session, experimentId: String(experiment.experimentId ?? experiment._id), candidateVersionId }
}
