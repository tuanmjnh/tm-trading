import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineModel, evidenceSetModel, experimentModel, tradingSessionModel } from './engineModel'
import {
  EvidenceError,
  evidenceHttpError,
  expectedSetId,
  getEvidenceSet,
  loadSessionJournal,
  previewEvidence,
  sessionEvidenceKind
} from './evidenceSets'

// =============================================================================
//  Session evidence graph (roadmap Phase F).
//
//  "Reconstruct one session from persisted evidence" means: the session, its
//  frozen (or previewed) evidence bundle, the journal rows derived from it, the
//  news evidence and the experiments that cite it, and the related sets that
//  share its identity. The PURE rules live in engine/evidenceGraph.mjs; this
//  file only hydrates, owner-scopes and maps failures to HTTP.
//
//  Reads are fail-soft (a missing link is reported as missing, never a 500);
//  only a missing session is a 404, because then there is nothing to explain.
// =============================================================================

type AnyDoc = Record<string, any>
type ModelLoader = () => Promise<AnyDoc | null>
// See evidenceSets.ts: dynamic engine imports widen optional params, so calls
// are typed against the exports but accept plain data.
type Loose<T> = { [K in keyof T]: T[K] extends (...a: any[]) => infer R ? (...a: any[]) => R : T[K] }
type GraphModule = Loose<typeof import('../../engine/evidenceGraph.mjs')>
type PointInTimeModule = Loose<typeof import('../../engine/pointInTime.mjs')>

let graphModP: Promise<GraphModule> | null = null
let pitModP: Promise<PointInTimeModule> | null = null

function graphModule(): Promise<GraphModule> {
  if (!graphModP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'evidenceGraph.mjs')).href
    // @vite-ignore — engine/ lives outside server/ (docs/app-inheritance.md).
    graphModP = import(/* @vite-ignore */ href) as Promise<GraphModule>
  }
  return graphModP
}

function pointInTimeModule(): Promise<PointInTimeModule> {
  if (!pitModP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'pointInTime.mjs')).href
    // @vite-ignore — engine/ lives outside server/ (docs/app-inheritance.md).
    pitModP = import(/* @vite-ignore */ href) as Promise<PointInTimeModule>
  }
  return pitModP
}

export interface EvidenceGraphDeps {
  sessionModel?: ModelLoader
  evidenceSetModel?: ModelLoader
  orderModel?: ModelLoader
  fillModel?: ModelLoader
  journalModel?: ModelLoader
  newsModel?: ModelLoader
  experimentModel?: ModelLoader
  /** Injected preview + journal readers keep the graph testable offline. */
  preview?: typeof previewEvidence
  journal?: typeof loadSessionJournal
  setIdFor?: typeof expectedSetId
  graph?: () => Promise<GraphModule>
}

const loadModel = (deps: EvidenceGraphDeps, key: keyof EvidenceGraphDeps, fallback: ModelLoader) =>
  (deps[key] as ModelLoader | undefined) ?? fallback

function loadersOf(deps: EvidenceGraphDeps) {
  return {
    Session: loadModel(deps, 'sessionModel', tradingSessionModel),
    Evidence: loadModel(deps, 'evidenceSetModel', evidenceSetModel),
    Order: loadModel(deps, 'orderModel', () => engineModel('order.mjs', 'PaperOrder')),
    Fill: loadModel(deps, 'fillModel', () => engineModel('fill.mjs', 'PaperFill')),
    Journal: loadModel(deps, 'journalModel', () => engineModel('journal.mjs', 'Journal')),
    News: loadModel(deps, 'newsModel', () => engineModel('newsEvidenceSet.mjs', 'NewsEvidenceSet')),
    Experiment: loadModel(deps, 'experimentModel', experimentModel)
  }
}

export function evidenceGraphHttpError(err: unknown) {
  if (err instanceof EvidenceError) return evidenceHttpError(err)
  return createError({ statusCode: 500, statusMessage: 'evidence_graph_failed', message: (err as Error)?.message || 'evidence graph failed' })
}

const byCreated = (rows: AnyDoc[]) => [...rows].sort((a, b) => {
  const ta = Number(a?.createdAt instanceof Date ? a.createdAt.getTime() : a?.createdAt ?? 0)
  const tb = Number(b?.createdAt instanceof Date ? b.createdAt.getTime() : b?.createdAt ?? 0)
  return tb - ta
})

export interface SessionEvidenceGraph {
  session: AnyDoc
  evidenceSet: AnyDoc | null
  bundle: AnyDoc
  journal: AnyDoc[]
  news: AnyDoc[]
  experiments: AnyDoc[]
  relatedSets: AnyDoc[]
  links: AnyDoc
  digest: string
  ids: string[]
  limitations: string[]
  pointInTime: AnyDoc
  pit: AnyDoc
  mongo: 'up' | 'down' | 'partial'
}

/**
 * Reconstruct a session from persisted evidence. Owner-scoped throughout; a
 * session that does not exist for this owner is a 404 (no cross-tenant leak).
 */
export async function getSessionEvidenceGraph(
  sessionId: string,
  deps: EvidenceGraphDeps = {},
  ownerId?: string | null
): Promise<SessionEvidenceGraph> {
  const id = String(sessionId ?? '').trim()
  if (!id) throw new EvidenceError('sessionId is required', 400, 'invalid_session')
  const Session = await loadersOf(deps).Session()
  if (!Session) throw new EvidenceError('evidence store unavailable', 503, 'mongo_down')

  const own = ownerId ? { ownerId } : {}
  const session = await Session.findOne({ $or: [{ _id: id }, { sessionId: id }], ...own }).lean().catch(() => null) as AnyDoc | null
  if (!session) throw new EvidenceError(`trading session not found: ${id}`, 404, 'session_not_found')

  const key = String(session.sessionId ?? session._id)
  const kind = sessionEvidenceKind(session.kind)
  const setReader = deps.setIdFor ?? expectedSetId
  const setId = await setReader(kind, key)

  const [set, journal] = await Promise.all([
    getEvidenceSet(setId, deps as never, ownerId).catch(() => null),
    (deps.journal ?? loadSessionJournal)(key, deps as never, ownerId).catch(() => [])
  ])

  const bundle = set ?? await (deps.preview ?? previewEvidence)(kind, key, deps as never, ownerId).catch(() => null)
  if (!bundle) throw new EvidenceError('evidence could not be reconstructed for this session', 503, 'evidence_unavailable')

  const loaders = loadersOf(deps)
  // Orders/fills are only needed for the digest text; a store outage degrades
  // the digest (fewer rows), it does not fail the reconstruction.
  const [OrderM, FillM, NewsM, ExperimentM] = await Promise.all([loaders.Order(), loaders.Fill(), loaders.News(), loaders.Experiment()])
  const [orders, fills] = await Promise.all([
    OrderM ? OrderM.find({ sessionId: key, ...own }).limit(500).lean().catch(() => []) : Promise.resolve([]),
    FillM ? FillM.find({ sessionId: key, ...own }).limit(500).lean().catch(() => []) : Promise.resolve([])
  ])

  const manifestExperimentId = String(session?.manifest?.scope?.experimentId ?? '').trim() || null
  const citedExperimentIds = [
    ...(Array.isArray(set?.usedByExperimentIds) ? set.usedByExperimentIds.map(String) : []),
    ...(manifestExperimentId ? [manifestExperimentId] : [])
  ]
  const experimentIdFilter = [...new Set(citedExperimentIds)]

  const experiments = ExperimentM
    ? await ExperimentM.find({
      ...own,
      $or: [
        { evidenceSetId: setId },
        ...(experimentIdFilter.length ? [{ experimentId: { $in: experimentIdFilter } }] : []),
        ...(experimentIdFilter.length ? [{ _id: { $in: experimentIdFilter } }] : [])
      ]
    }).limit(50).lean().catch(() => []) as AnyDoc[]
    : []
  const experimentIds = [...new Set([
    ...experimentIdFilter,
    ...(experiments as AnyDoc[]).flatMap((e) => [e?.experimentId, e?._id]).filter(Boolean).map(String)
  ])]

  const news = NewsM && experimentIds.length
    ? await NewsM.find({ usedByExperimentIds: { $in: experimentIds }, ...own }).limit(50).lean().catch(() => []) as AnyDoc[]
    : []

  const EvidenceM = await loaders.Evidence()
  const strategyVersionId = String(bundle?.strategyVersionId ?? session?.strategyVersionId ?? '').trim() || null
  const relatedSets = EvidenceM && strategyVersionId
    ? await EvidenceM.find({ strategyVersionId, _id: { $ne: setId }, ...own })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .catch(() => []) as AnyDoc[]
    : []

  const mod = await (deps.graph ?? graphModule)()
  const pitMod = await pointInTimeModule()
  const pit = pitMod.pitAudit({
    bundle,
    journal: journal as AnyDoc[],
    news,
    asOf: Number(bundle?.pointInTime?.frozenAt ?? 0) || null
  }) as AnyDoc
  const graphInput = {
    session,
    bundle,
    orders,
    fills,
    journal: journal as AnyDoc[],
    news,
    experiments,
    relatedSets,
    pit
  }
  const links = mod.linkSummary(graphInput) as AnyDoc
  const digest = String(mod.graphDigest(graphInput))
  const ids = mod.graphIds(graphInput) as string[]
  const pitLimit = pitMod.pitLimitation(pit) as string | null
  const limitations = [
    ...(Array.isArray(bundle.limitations) ? bundle.limitations.map(String) : []),
    ...(mod.graphLimitations(graphInput) as string[]),
    ...(pitLimit ? [pitLimit] : [])
  ]

  return {
    session,
    evidenceSet: set ?? null,
    bundle,
    journal: byCreated(journal as AnyDoc[]),
    news: byCreated(news),
    experiments,
    relatedSets,
    links,
    digest,
    ids,
    limitations,
    pointInTime: bundle.pointInTime ?? null,
    pit,
    mongo: set ? 'up' : 'partial'
  }
}
