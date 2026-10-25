import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createError } from 'h3'
import { engineModel } from './engineModel'

// =============================================================================
//  News Desk read API (V3.5 §60 Slice B) — reads the durable `news_items`
//  envelope + `news_sources` registry. Read-only, no recompute (D1).
//
//  Rights are enforced server-side: only `toPublicNewsItem` allowlisted fields
//  leave this module, items from revoked/unverified sources are excluded, and
//  Mongo down -> 200 + meta.mongo='down' + empty (never 500).
//
//  The PURE core is engine/newsIngest.mjs (ids, envelope, license gate,
//  projection). Loaded at runtime — Nitro mis-bundles static relative imports
//  reaching outside server/ (docs/app-inheritance.md).
// =============================================================================

type NewsIngestModule = typeof import('../../engine/newsIngest.mjs')

let ingestPromise: Promise<NewsIngestModule> | null = null

function newsIngest(): Promise<NewsIngestModule> {
  if (!ingestPromise) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'newsIngest.mjs')).href
    ingestPromise = import(/* @vite-ignore */ href) as Promise<NewsIngestModule>
  }
  return ingestPromise
}

export interface ListNewsItemsQuery {
  limit: number
  marketGroup?: string
  level?: 'high' | 'med'
  sourceId?: string
  q?: string
  since?: string
}

export interface ServerNewsDeskMeta {
  mongo: 'up' | 'down'
  total: number
  generatedAt: string | null
  degradedSources: string[]
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 50
  return Math.min(Math.floor(limit), 200)
}

function parseSince(since?: string): Date | undefined {
  if (!since) return undefined
  const ms = Number(since)
  const t = Number.isFinite(ms) ? ms : Date.parse(since)
  if (Number.isNaN(t)) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidSince', message: `since khong hop le: ${since}` })
  }
  return new Date(t)
}

async function displayableSourceIds(): Promise<string[] | null> {
  const NewsSource = await engineModel('newsSource.mjs', 'NewsSource')
  if (!NewsSource) return null
  const rows = await NewsSource.find({ licenseStatus: 'ok', enabled: { $ne: false }, 'rights.allowedDisplay': { $ne: false } })
    .select({ _id: 1 })
    .lean()
  return rows.map((r: { _id: unknown }) => String(r._id))
}

export async function listNewsItems(q: ListNewsItemsQuery): Promise<{ items: unknown[]; meta: ServerNewsDeskMeta }> {
  const NewsItem = await engineModel('newsItem.mjs', 'NewsItem')
  if (!NewsItem) {
    return { items: [], meta: { mongo: 'down', total: 0, generatedAt: null, degradedSources: [] } }
  }
  const allowed = await displayableSourceIds()
  if (allowed && !allowed.length) {
    return { items: [], meta: { mongo: 'up', total: 0, generatedAt: null, degradedSources: [] } }
  }
  const filter: Record<string, unknown> = { 'rights.allowedDisplay': { $ne: false } }
  if (allowed) filter.sourceId = { $in: allowed }
  if (q.marketGroup) filter.marketGroup = q.marketGroup
  if (q.level === 'high' || q.level === 'med') filter.level = q.level
  if (q.sourceId) filter.sourceId = q.sourceId
  const since = parseSince(q.since)
  if (since) filter.ingestedAt = { $gte: since }
  if (q.q) {
    const rx = { $regex: q.q.slice(0, 80), $options: 'i' }
    filter.$or = [{ title: rx }, { excerpt: rx }]
  }
  const limit = clampLimit(q.limit)
  const ingest = await newsIngest()
  const [docs, total] = await Promise.all([
    NewsItem.find(filter).sort({ ingestedAt: -1 }).limit(limit).lean(),
    NewsItem.countDocuments(filter),
  ])
  const items = docs.map((d: unknown) => ingest.toPublicNewsItem(d)).filter((x: unknown) => x !== null)
  const latest = docs.length ? docs[0] : null
  const generatedAt = latest?.ingestedAt ? new Date(latest.ingestedAt).toISOString() : null
  return { items, meta: { mongo: 'up', total, generatedAt, degradedSources: [] } }
}

export interface ServerNewsSourcePublic {
  sourceId: string
  name: string
  transport: string
  trustTier: string
  marketGroups: string[]
  languages: string[]
  licenseStatus: string
  enabled: boolean
  pollIntervalSec: number
  retentionDays: number
  health: {
    state: string
    lastFetchAt: string | null
    lastOkAt: string | null
    lastItemAt: string | null
    lastError: string | null
    consecutiveErrors: number
  }
}

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function listNewsSources(): Promise<{ sources: ServerNewsSourcePublic[]; mongo: 'up' | 'down' }> {
  const NewsSource = await engineModel('newsSource.mjs', 'NewsSource')
  if (!NewsSource) return { sources: [], mongo: 'down' }
  // Never expose feedUrl query internals beyond the public endpoint host;
  // tokens are never stored, but the projection stays minimal regardless.
  const docs = await NewsSource.find({}).sort({ sourceId: 1 }).lean()
  return {
    mongo: 'up',
    sources: docs.map((d: Record<string, any>) => toPublicNewsSource(d)),
  }
}

export function toPublicNewsSource(d: Record<string, any>): ServerNewsSourcePublic {
  return {
    sourceId: String(d.sourceId || d._id),
    name: d.name || '',
    transport: d.transport || '',
    trustTier: d.trustTier || 'T2_SECONDARY',
    marketGroups: Array.isArray(d.marketGroups) ? d.marketGroups : [],
    languages: Array.isArray(d.languages) ? d.languages : [],
    licenseStatus: d.licenseStatus || 'unknown',
    enabled: d.enabled !== false,
    pollIntervalSec: typeof d.pollIntervalSec === 'number' ? d.pollIntervalSec : 600,
    retentionDays: typeof d.retentionDays === 'number' ? d.retentionDays : 7,
    health: {
      state: d.health?.state || 'unknown',
      lastFetchAt: isoOrNull(d.health?.lastFetchAt),
      lastOkAt: isoOrNull(d.health?.lastOkAt),
      lastItemAt: isoOrNull(d.health?.lastItemAt),
      lastError: d.health?.lastError || null,
      consecutiveErrors: d.health?.consecutiveErrors || 0,
    },
  }
}

export async function getNewsSource(id: string, deps?: { NewsSourceModel?: any }): Promise<ServerNewsSourcePublic> {
  const NewsSource = deps?.NewsSourceModel || (await engineModel('newsSource.mjs', 'NewsSource'))
  if (!NewsSource) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline' })
  }
  const doc = await NewsSource.findOne({ _id: String(id) }).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `source khong ton tai: ${id}` })
  }
  return toPublicNewsSource(doc as Record<string, any>)
}

/** Operator enable/disable (§60.2 registry). Policy/rights fields are NOT writable here. */
export async function setNewsSourceEnabled(id: string, enabled: unknown, deps?: { NewsSourceModel?: any }): Promise<ServerNewsSourcePublic> {
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidArgs', message: 'enabled must be boolean' })
  }
  const NewsSource = deps?.NewsSourceModel || (await engineModel('newsSource.mjs', 'NewsSource'))
  if (!NewsSource) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline' })
  }
  const doc = await NewsSource.findOneAndUpdate(
    { _id: String(id) },
    { $set: { enabled } },
    { returnDocument: 'after' },
  ).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `source khong ton tai: ${id}` })
  }
  return toPublicNewsSource(doc as Record<string, any>)
}

const VALIDATE_TIMEOUT_MS = 10000

/**
 * Connectivity validation for one source (§60.12 validate): fetches the
 * public feed endpoint with a timeout and reports reachability. Never sends
 * secrets (registry stores none) and never mutates the registry — health is
 * written by the ingest runner, not by probes.
 */
export async function validateNewsSource(
  id: string,
  opts?: { NewsSourceModel?: any; fetchImpl?: typeof fetch },
): Promise<Record<string, any>> {
  const NewsSource = opts?.NewsSourceModel || (await engineModel('newsSource.mjs', 'NewsSource'))
  if (!NewsSource) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline' })
  }
  const doc = await NewsSource.findOne({ _id: String(id) }).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `source khong ton tai: ${id}` })
  }
  const d = doc as Record<string, any>
  if (d.transport === 'api' && d.sourceId === 'cryptopanic' && !process.env.CRYPTOPANIC_TOKEN) {
    return { sourceId: d.sourceId, reachable: false, reason: 'token_not_configured', hint: 'Set CRYPTOPANIC_TOKEN to enable.' }
  }
  const url = String(d.feedUrl || '')
  if (!url || !/^https?:\/\//.test(url)) {
    return { sourceId: d.sourceId, reachable: false, reason: 'no_public_endpoint' }
  }
  const t0 = Date.now()
  try {
    const doFetch = opts?.fetchImpl || fetch
    const res = await doFetch(url, { signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS) })
    const text = res.ok ? await res.text() : ''
    return {
      sourceId: d.sourceId,
      reachable: res.ok,
      httpStatus: res.status,
      latencyMs: Date.now() - t0,
      bytes: text.length,
      looksLikeFeed: /<(rss|feed|rdf)[\s>]/.test(text.slice(0, 2000)),
      reason: res.ok ? 'ok' : `http_${res.status}`,
    }
  } catch (e) {
    return { sourceId: d.sourceId, reachable: false, latencyMs: Date.now() - t0, reason: String((e as Error)?.message || e).slice(0, 200) }
  }
}

export interface ServerMarketEventPublic {
  id: string
  title: string
  marketGroup: string
  eventType: string | null
  status: 'active' | 'corrected' | 'retracted'
  firstSeenAt: string | null
  lastSeenAt: string | null
  itemCount: number
  sourceIds: string[]
  corroboration: string
  independentSources: number
  dirs: string[]
  entities: Array<{ symbol: string; confidence: number; uncertain: boolean }>
  revisionCount: number
}

/** Allowlist projection of one MarketEvent doc (Slice C). */
export function toPublicMarketEvent(d: Record<string, any>): ServerMarketEventPublic {
  return {
    id: String(d._id || ''),
    title: d.title || '',
    marketGroup: d.marketGroup || 'crypto',
    eventType: d.eventType || null,
    status: d.status === 'corrected' || d.status === 'retracted' ? d.status : 'active',
    firstSeenAt: isoOrNull(d.firstSeenAt),
    lastSeenAt: isoOrNull(d.lastSeenAt),
    itemCount: Array.isArray(d.itemIds) ? d.itemIds.length : 0,
    sourceIds: Array.isArray(d.corroboration?.sourceIds) ? d.corroboration.sourceIds : [],
    corroboration: d.corroboration?.status || 'single_source',
    independentSources: d.corroboration?.independentSources || 0,
    dirs: Array.isArray(d.corroboration?.dirs) ? d.corroboration.dirs : [],
    entities: (Array.isArray(d.entities) ? d.entities : []).map((e: Record<string, any>) => ({
      symbol: String(e.symbol || ''),
      confidence: typeof e.confidence === 'number' ? e.confidence : 0,
      uncertain: e.uncertain !== false,
    })),
    revisionCount: Array.isArray(d.revisions) ? d.revisions.length : 0,
  }
}

export interface ListEventsQuery {
  limit: number
  marketGroup?: string
  status?: 'active' | 'corrected' | 'retracted'
  corroboration?: 'single_source' | 'multi_source' | 'contradicted'
  symbol?: string
}

export async function listMarketEvents(q: ListEventsQuery): Promise<{ events: ServerMarketEventPublic[]; meta: ServerNewsDeskMeta }> {
  const MarketEvent = await engineModel('marketEvent.mjs', 'MarketEvent')
  if (!MarketEvent) {
    return { events: [], meta: { mongo: 'down', total: 0, generatedAt: null, degradedSources: [] } }
  }
  const filter: Record<string, unknown> = {}
  if (q.marketGroup) filter.marketGroup = q.marketGroup
  if (q.status) filter.status = q.status
  if (q.corroboration) filter['corroboration.status'] = q.corroboration
  if (q.symbol) filter['entities.symbol'] = String(q.symbol).toUpperCase()
  const limit = Number.isFinite(q.limit) && q.limit > 0 ? Math.min(Math.floor(q.limit), 200) : 50
  const [docs, total] = await Promise.all([
    MarketEvent.find(filter).sort({ lastSeenAt: -1 }).limit(limit).lean(),
    MarketEvent.countDocuments(filter),
  ])
  const latest = docs.length ? docs[0] : null
  return {
    events: docs.map((d: Record<string, any>) => toPublicMarketEvent(d)),
    meta: {
      mongo: 'up',
      total,
      generatedAt: latest?.lastSeenAt ? new Date(latest.lastSeenAt).toISOString() : null,
      degradedSources: [],
    },
  }
}

export async function getMarketEvent(id: string): Promise<ServerMarketEventPublic | null> {
  const d = await getMarketEventDoc(id)
  if (!d) return null
  return toPublicMarketEvent(d)
}

async function getMarketEventDoc(id: string): Promise<Record<string, any> | null> {
  const MarketEvent = await engineModel('marketEvent.mjs', 'MarketEvent')
  if (!MarketEvent) return null
  if (!String(id || '').startsWith('evt_')) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: `event id khong hop le: ${id}` })
  }
  const doc = await MarketEvent.findOne({ _id: String(id) }).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `event khong ton tai: ${id}` })
  }
  return doc as Record<string, any>
}

/**
 * Event detail for the Market Events page (§60.2): the event plus its
 * corroborating source items (allowlisted projections, capped) and the
 * append-only revision trail. Provenance stays complete: every item id links
 * back to its source row.
 */
export async function getMarketEventDetail(id: string, itemCap = 20): Promise<Record<string, any> | null> {
  const event = await getMarketEventDoc(id)
  if (!event) return null
  const NewsItem = await engineModel('newsItem.mjs', 'NewsItem')
  let items: unknown[] = []
  if (NewsItem && Array.isArray(event.itemIds) && event.itemIds.length) {
    const ingest = await newsIngest()
    const docs = await NewsItem.find({ _id: { $in: event.itemIds.slice(0, Math.max(1, Math.min(100, itemCap))) } }).lean()
    items = docs.map((d: unknown) => ingest.toPublicNewsItem(d)).filter((x: unknown) => x !== null)
  }
  const revisions = (Array.isArray(event.revisions) ? event.revisions : []).map((r: Record<string, any>) => ({
    at: isoOrNull(r.at),
    kind: r.kind || 'note',
    itemId: r.itemId || null,
    note: r.note || '',
  }))
  return { event: toPublicMarketEvent(event), items, revisions }
}

/** GET /news/:id — one item detail (§60.12). Same rights gate as the list. */
export async function getNewsItem(id: string): Promise<unknown | null> {
  const NewsItem = await engineModel('newsItem.mjs', 'NewsItem')
  if (!NewsItem) return null
  if (!String(id || '').startsWith('news_')) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: `item id khong hop le: ${id}` })
  }
  const doc = await NewsItem.findOne({ _id: String(id) }).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `item khong ton tai: ${id}` })
  }
  const d = doc as Record<string, any>
  if (d.rights?.allowedDisplay === false) return null
  const allowed = await displayableSourceIds()
  if (allowed && !allowed.includes(String(d.sourceId))) return null
  const ingest = await newsIngest()
  return ingest.toPublicNewsItem(d)
}

/**
 * GET /news/:id?detail=full — the item plus its append-only revision trail
 * (§60.11 "get one item and its provenance"). Revisions carry only the PREVIOUS
 * rights-safe fields (title/excerpt/level/dir/tags), capped and newest-first.
 */
export async function getNewsItemDetail(id: string, revisionCap = 50): Promise<Record<string, any> | null> {
  const item = await getNewsItem(id)
  if (!item) return null
  const NewsItemRevision = await engineModel('newsItemRevision.mjs', 'NewsItemRevision')
  let revisions: unknown[] = []
  if (NewsItemRevision) {
    const rows = await NewsItemRevision.find({ itemId: String(id) })
      .sort({ at: -1 })
      .limit(Math.max(1, Math.min(200, revisionCap)))
      .lean()
    revisions = rows.map((r: Record<string, any>) => ({
      at: r.at ? new Date(r.at).toISOString() : null,
      kind: r.kind || 'revised',
      contentHash: r.contentHash || null,
      prevContentHash: r.prevContentHash || null,
      prev: {
        title: r.prev?.title || '',
        excerpt: r.prev?.excerpt || '',
        level: r.prev?.level ?? null,
        dir: r.prev?.dir ?? null,
        tags: Array.isArray(r.prev?.tags) ? r.prev.tags : [],
        eventType: r.prev?.eventType ?? null,
      },
    }))
  }
  return { item, revisions }
}

type OutlookModule = typeof import('../../engine/outlook.mjs')

let outlookPromise: Promise<OutlookModule> | null = null

function outlookEngine(): Promise<OutlookModule> {
  if (!outlookPromise) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'outlook.mjs')).href
    outlookPromise = import(/* @vite-ignore */ href) as Promise<OutlookModule>
  }
  return outlookPromise
}

/**
 * Build the outlook snapshot on read (Slice D): fresh every call from current
 * events + items, upserted by deterministic _id for the evidence trail.
 * Unsupported groups / thin evidence -> insufficient_evidence (never generic).
 * Mongo down -> null (page renders degraded, never a crash).
 */
export async function getOutlook(group: string, horizon: string): Promise<Record<string, any> | null> {
  const outlook = await outlookEngine()
  const horizons = (outlook.OUTLOOK_HORIZONS || {}) as Record<string, unknown>
  if (!group || !horizons[horizon]) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidArgs', message: `outlook khong hop le: ${group}/${horizon}` })
  }
  const MarketEvent = await engineModel('marketEvent.mjs', 'MarketEvent')
  if (!MarketEvent) return null
  const [eventsRes, itemsRes] = await Promise.all([
    listMarketEvents({ limit: 100, marketGroup: group }),
    listNewsItems({ limit: 100, marketGroup: group }),
  ])
  const snap = outlook.buildOutlook({
    group,
    horizon,
    events: eventsRes.events,
    items: itemsRes.items,
    nowMs: Date.now(),
  })
  if (!snap) return null
  // §60.12 propagation: the stored snapshot may have been invalidated by a
  // correction/retraction since it was first written ($setOnInsert never
  // overwrites it), so the read reports WHY it is stale instead of only whether
  // its own window has expired.
  let invalidatedAt: string | null = null
  let staleReason: string | null = null
  try {
    const MarketOutlook = await engineModel('marketOutlook.mjs', 'MarketOutlook')
    if (MarketOutlook) {
      const { _id, ...rest } = snap
      await MarketOutlook.updateOne({ _id }, { $setOnInsert: { _id, ...rest } }, { upsert: true })
      const row = await MarketOutlook.findOne({ _id }).select({ invalidatedAt: 1, staleReason: 1 }).lean()
      if (row?.invalidatedAt) {
        invalidatedAt = new Date(row.invalidatedAt).toISOString()
        staleReason = row.staleReason || null
      }
    }
  } catch {
    // Snapshot persistence is evidence-trail best effort; the read stays live.
  }
  const expired = new Date(snap.expiresAt).getTime() < Date.now()
  return { ...snap, stale: expired || invalidatedAt !== null, invalidatedAt, staleReason }
}

/**
 * GET /outlook/:id — the stored snapshot verbatim (§60.12 immutable outlook
 * detail + evidence). Unlike the `?group=&horizon=` read (which rebuilds the
 * current snapshot), this returns exactly what was written — the evidence trail
 * a past decision pointed at — and flags it stale when its window expired or an
 * upstream correction invalidated it. Mongo down -> null (page degrades).
 */
export async function getOutlookById(id: string): Promise<Record<string, any> | null> {
  const MarketOutlook = await engineModel('marketOutlook.mjs', 'MarketOutlook')
  if (!MarketOutlook) return null
  if (!String(id || '').startsWith('outlook_')) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: `outlook id khong hop le: ${id}` })
  }
  const row = await MarketOutlook.findOne({ _id: String(id) }).lean()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `outlook khong ton tai: ${id}` })
  }
  const d = row as Record<string, any>
  const expired = new Date(d.expiresAt).getTime() < Date.now()
  const invalidatedAt = d.invalidatedAt ? new Date(d.invalidatedAt).toISOString() : null
  return { ...d, stale: expired || invalidatedAt !== null, invalidatedAt, staleReason: d.staleReason || null }
}

/**
 * POST /news/ingestion/retry (§60.12 manual reprocessing) — a privileged,
 * audited action. Stamps `retryRequestedAt` on the named (or all enabled)
 * sources so the next ingest cycle polls them immediately; no new queue system
 * is introduced (the registry row IS the durable request). Returns the accepted
 * ids and any ids not in the registry.
 */
export async function requestNewsRetry(sourceIds: unknown): Promise<{ accepted: string[]; missing: string[]; status: 'queued'; requestedAt: string }> {
  const ids = Array.isArray(sourceIds) ? sourceIds.map((s) => String(s)).filter(Boolean) : []
  const NewsSource = await engineModel('newsSource.mjs', 'NewsSource')
  if (!NewsSource) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline' })
  }
  const filter = ids.length ? { _id: { $in: ids } } : { enabled: { $ne: false } }
  const rows = await NewsSource.find(filter).select({ _id: 1 }).lean()
  const found = rows.map((r: { _id: unknown }) => String(r._id))
  const requestedAt = new Date()
  if (found.length) await NewsSource.updateMany({ _id: { $in: found } }, { $set: { retryRequestedAt: requestedAt } })
  const missing = ids.filter((id) => !found.includes(id))
  if (ids.length && !found.length) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `khong co source nao ton tai: ${ids.join(', ')}` })
  }
  return { accepted: found, missing, status: 'queued', requestedAt: requestedAt.toISOString() }
}
