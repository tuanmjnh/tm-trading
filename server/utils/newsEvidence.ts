import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createError } from 'h3'
import { engineModel } from './engineModel'
import { listMarketEvents, listNewsItems } from './newsStore'
import { getExperimentResearch } from './research'

// =============================================================================
//  News evidence + scorecard glue (V3.5 §60 Slice E).
//
//  - freezeNewsEvidenceSet: PIT-cut snapshot of news/event/macro rows into an
//    immutable NewsEvidenceSet (deterministic id — refreeze is a no-op).
//  - citeNewsEvidenceSet: experiment back-reference (append-only), mirroring
//    the §59 citeEvidenceSet contract. Historical tests MUST cite the frozen
//    ids; re-querying live collections would leak the future.
//  - runNewsScorecard: scores EXPIRED outlook snapshots against subsequent
//    price action with a persistence baseline; writes one NewsEvaluation doc.
//  Engine pure cores load at runtime (Nitro bundling rule, app-inheritance).
// =============================================================================

type FreezeModule = typeof import('../../engine/newsEvidenceSet.mjs')
type ScoreModule = typeof import('../../engine/newsScorecard.mjs')
type DataModule = typeof import('../../engine/data.mjs')

async function loadEngine<T>(file: string): Promise<T> {
  const href = pathToFileURL(join(process.cwd(), 'engine', file)).href
  return (await import(/* @vite-ignore */ href)) as T
}

export interface FreezeNewsInput {
  group?: string
  symbols?: string[]
  horizon?: string | null
  purpose?: string
  lookbackHours?: number
  asOfMs?: number
  createdBy?: string | null
  /** Tenancy (roadmap §61.3): the freezing hub user id. */
  ownerId?: string | null
  /** Injectable models / experiment lookup for offline tests. */
  deps?: {
    NewsItemModel?: any
    NewsEventModel?: any
    MacroObservationModel?: any
    NewsEvidenceSetModel?: any
    getExperiment?: (id: string) => Promise<unknown>
  }
}

export async function freezeNewsEvidenceSet(input: FreezeNewsInput): Promise<Record<string, any>> {
  const NewsItem = input.deps?.NewsItemModel || (await engineModel('newsItem.mjs', 'NewsItem'))
  if (!NewsItem) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot freeze evidence' })
  }
  const mod = await loadEngine<FreezeModule>('newsEvidenceSet.mjs')
  const asOf = Number.isFinite(input.asOfMs) ? Number(input.asOfMs) : Date.now()
  const since = new Date(asOf - (input.lookbackHours || 168) * 3600 * 1000)
  const NewsEvent = input.deps?.NewsEventModel || (await engineModel('marketEvent.mjs', 'MarketEvent'))
  const MacroObservation = input.deps?.MacroObservationModel || (await engineModel('macroObservation.mjs', 'MacroObservation'))
  const [items, events, observations] = await Promise.all([
    NewsItem.find({ firstSeenAt: { $lte: new Date(asOf), $gte: since } }).limit(500).lean(),
    NewsEvent ? NewsEvent.find({ firstSeenAt: { $lte: new Date(asOf), $gte: since } }).limit(200).lean() : [],
    MacroObservation
      ? MacroObservation.find({ vintageAt: { $lte: new Date(asOf) } }).sort({ vintageAt: -1 }).limit(200).lean()
      : [],
  ])
  const doc = mod.freezeNewsEvidence({
    items, events, observations,
    group: input.group || 'crypto',
    symbols: input.symbols || [],
    horizon: input.horizon || null,
    purpose: input.purpose || 'evaluation',
    asOfMs: asOf,
    createdBy: input.createdBy || null,
  })
  const NewsEvidenceSet = input.deps?.NewsEvidenceSetModel || (await engineModel('newsEvidenceSet.mjs', 'NewsEvidenceSet'))
  if (!NewsEvidenceSet) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot persist evidence set' })
  }
  const { _id, ...rest } = doc
  await NewsEvidenceSet.updateOne({ _id }, { $setOnInsert: { _id, ownerId: input.ownerId || null, ...rest } }, { upsert: true })
  return { ...doc, ownerId: input.ownerId || null }
}

/**
 * Read one frozen set (§60.11 retention exception, made usable).
 *
 * The set is immutable and carries its own `itemRefs`/`eventRefs`/
 * `observationRefs` copied at freeze time, so it survives the 7-day `NewsItem`
 * TTL. `survival` reports honestly how much of the cited evidence still exists
 * live: `live` rows are still queryable, `expired` ones are cited by reference
 * only. `reproducible: false` would mean the set was frozen before the ref
 * policy existed — surfaced, never hidden.
 */
export async function getNewsEvidenceSet(
  setId: string,
  deps?: FreezeNewsInput['deps'],
  ownerId?: string | null,
): Promise<Record<string, any>> {
  const NewsEvidenceSet = deps?.NewsEvidenceSetModel || (await engineModel('newsEvidenceSet.mjs', 'NewsEvidenceSet'))
  if (!NewsEvidenceSet) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot read evidence set' })
  }
  const set = await NewsEvidenceSet.findOne({ _id: String(setId), ...(ownerId ? { ownerId } : {}) }).lean()
  if (!set) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `news evidence set khong ton tai: ${setId}` })
  }
  const doc = set as Record<string, any>
  const NewsItem = deps?.NewsItemModel || (await engineModel('newsItem.mjs', 'NewsItem'))
  const cited = Array.isArray(doc.itemIds) ? doc.itemIds : []
  let liveItemIds: string[] = []
  if (NewsItem && cited.length) {
    const rows = await NewsItem.find({ _id: { $in: cited } }).select({ _id: 1 }).lean()
    liveItemIds = (rows as Array<{ _id: unknown }>).map((r) => String(r._id))
  }
  const mod = await loadEngine<FreezeModule>('newsEvidenceSet.mjs')
  return {
    set: doc,
    refs: {
      items: doc.itemRefs || [],
      events: doc.eventRefs || [],
      observations: doc.observationRefs || [],
    },
    survival: mod.evidenceRefSurvival(doc, liveItemIds),
  }
}

export async function citeNewsEvidenceSet(setId: string, experimentId: string, deps?: FreezeNewsInput['deps'], ownerId?: string | null): Promise<{ setId: string; experimentId: string }> {
  const NewsEvidenceSet = deps?.NewsEvidenceSetModel || (await engineModel('newsEvidenceSet.mjs', 'NewsEvidenceSet'))
  if (!NewsEvidenceSet) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot cite evidence' })
  }
  const set = await NewsEvidenceSet.findOne({ _id: String(setId), ...(ownerId ? { ownerId } : {}) }).lean()
  if (!set) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `news evidence set khong ton tai: ${setId}` })
  }
  // The experiment must exist — a citation to nothing is a silent fork.
  // (getExperimentResearch never throws: missing reads come back null.)
  const rep = deps?.getExperiment
    ? await deps.getExperiment(String(experimentId))
    : await getExperimentResearch(String(experimentId), {}, ownerId)
  if (!rep || !(rep as Record<string, any>).experiment) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `experiment khong ton tai: ${experimentId}` })
  }
  await NewsEvidenceSet.updateOne({ _id: String(setId), ...(ownerId ? { ownerId } : {}) }, { $addToSet: { usedByExperimentIds: String(experimentId) } })
  return { setId: String(setId), experimentId: String(experimentId) }
}

export interface ScorecardInput {
  group?: string
  horizon?: string
  symbols?: string[]
  asOfMs?: number
  createdBy?: string | null
  /** Tenancy (roadmap §61.3): the requesting hub user id. */
  ownerId?: string | null
  /** Injectable klines ({ symbol, tf, limit }) -> [{ time, close }] for tests. */
  klinesImpl?: (args: { symbol: string; tf: string; limit: number }) => Promise<Array<{ time: number; close: number }>>
  deps?: FreezeNewsInput['deps'] & { MarketOutlookModel?: any; NewsEvaluationModel?: any }
}

const SCORECARD_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

async function closesFor(symbol: string, atMs: number, days: number, klinesImpl?: ScorecardInput['klinesImpl']) {
  const bars = klinesImpl
    ? await klinesImpl({ symbol, tf: '86400', limit: 500 })
    : await (async () => {
        const data = await loadEngine<DataModule>('data.mjs')
        const k = await data.fetchKlines({ symbol, tf: '86400', limit: 500 })
        return ((k.bars || []) as Array<{ time: number; close: number }>).map((b) => ({ time: b.time, close: b.close }))
      })()
  const at = (t: number) => {
    let best: { time: number; close: number } | null = null
    for (const b of bars) {
      if (b.time <= t && (!best || b.time > best.time)) best = b
    }
    return best?.close ?? null
  }
  const day = 86400 * 1000
  return { atStart: at(atMs), atEnd: at(atMs + days * day), atPrior: at(atMs - days * day) }
}

export async function runNewsScorecard(input: ScorecardInput): Promise<Record<string, any>> {
  const MarketOutlook = input.deps?.MarketOutlookModel || (await engineModel('marketOutlook.mjs', 'MarketOutlook'))
  if (!MarketOutlook) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot evaluate' })
  }
  const mod = await loadEngine<ScoreModule>('newsScorecard.mjs')
  const group = input.group || 'crypto'
  const horizon = input.horizon || 'short_term'
  const symbols = input.symbols?.length ? input.symbols : SCORECARD_SYMBOLS
  const asOf = Number.isFinite(input.asOfMs) ? Number(input.asOfMs) : Date.now()
  // Only EXPIRED snapshots: the horizon window has fully elapsed (PIT-safe).
  const snaps = await MarketOutlook.find({ marketGroup: group, horizon, expiresAt: { $lte: new Date(asOf) } })
    .sort({ generatedAt: -1 })
    .limit(50)
    .lean()
  const rows = []
  for (const s of snaps) {
    const days = s.horizonDays || 7
    for (const sym of symbols) {
      try {
        const prices = await closesFor(sym, new Date(s.generatedAt).getTime(), days, input.klinesImpl)
        const r = mod.scoreOutlookSnapshot(s, sym, prices)
        if (r.scored) rows.push(r)
        else rows.push({ scored: false, reason: r.reason, snapshotId: s._id, symbol: sym })
      } catch {
        rows.push({ scored: false, reason: 'price unavailable', snapshotId: s._id, symbol: sym })
      }
    }
  }
  const card = mod.buildScorecard({ group, horizon, symbols, rows, asOfMs: asOf, createdBy: input.createdBy || null })
  const NewsEvaluation = input.deps?.NewsEvaluationModel || (await engineModel('newsEvaluation.mjs', 'NewsEvaluation'))
  if (!NewsEvaluation) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — cannot persist evaluation' })
  }
  const { _id, ...rest } = card
  await NewsEvaluation.updateOne({ _id }, { $setOnInsert: { _id, ownerId: input.ownerId || null, ...rest } }, { upsert: true })
  return { ...card, ownerId: input.ownerId || null }
}
