// services/newsEvents.mjs
// Event clustering glue (V3.5 §60 Slice C): cluster recent NewsItems into
// MarketEvents after each ingest run. Deterministic ids (engine/newsEvents.mjs)
// make re-clustering idempotent — the same story never forks a second event.
// Fail-soft: clustering must never break ingest (runs inside runNews try/catch).

import {
  corroborate,
  correctionSignal,
  eventIdFor,
  eventTypeForTags,
  fingerprintOf,
  fingerprintTokens,
  linkEntities,
  nearDuplicate,
} from '../engine/newsEvents.mjs'
import { assessNewsItem } from '../engine/newsAssess.mjs'
import { diffMarketEvent, invalidatesViews } from '../engine/newsDomainEvents.mjs'
import { getNewsItem, persistDomainEvents } from './newsStore.mjs'
import { connectMongo } from '../engine/db.mjs'

let eventMemo = null
let assessMemo = null
let outlookMemo = null

export async function getMarketOutlook() {
  if (outlookMemo) return outlookMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/marketOutlook.mjs')
  outlookMemo = mod.MarketOutlook
  return outlookMemo
}

/**
 * §60.12 propagation: a correction/retraction invalidates the derived outlook
 * snapshots it fed, so a stale view stops being presented as current. Only
 * snapshots that have not already invalidated and have not expired are touched;
 * the write is idempotent. Fail-soft — propagation must not break clustering.
 */
export async function invalidateOutlooks(marketGroup, reason, { MarketOutlookModel = null, now = new Date() } = {}) {
  if (!marketGroup) return 0
  try {
    const Model = MarketOutlookModel || (await getMarketOutlook())
    if (!Model) return 0
    const res = await Model.updateMany(
      { marketGroup: String(marketGroup), expiresAt: { $gt: now }, invalidatedAt: null },
      { $set: { invalidatedAt: now, staleReason: String(reason) } },
    )
    return res?.modifiedCount || 0
  } catch {
    return 0
  }
}

export async function getMarketEvent() {
  if (eventMemo) return eventMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/marketEvent.mjs')
  eventMemo = mod.MarketEvent
  return eventMemo
}

export function resetNewsEventsMemo() {
  eventMemo = null
  assessMemo = null
  outlookMemo = null
}

export async function getNewsAssessment() {
  if (assessMemo) return assessMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsAssessment.mjs')
  assessMemo = mod.NewsAssessment
  return assessMemo
}

/**
 * Group items into clusters: exact fingerprint first, then near-duplicate
 * merge (token-set Jaccard >= threshold). Deterministic order (by _id) so the
 * representative title (earliest item) is stable across runs.
 */
export function clusterItems(items) {
  const sorted = [...(items || [])].sort((a, b) => String(a._id).localeCompare(String(b._id)))
  const clusters = [] // { fingerprint, members }
  for (const it of sorted) {
    const fp = fingerprintOf(it.title)
    if (!fp) continue
    let placed = false
    for (const c of clusters) {
      if (c.fingerprint === fp || nearDuplicate(c.representative, it.title)) {
        c.members.push(it)
        placed = true
        break
      }
    }
    if (!placed) clusters.push({ fingerprint: fp, representative: it.title, members: [it] })
  }
  return clusters
}

/** Build the event doc for one cluster (pure-ish; no I/O). */
export function toMarketEvent(cluster, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const members = [...cluster.members].sort((a, b) => {
    const at = new Date(a.publishedAt || a.firstSeenAt).getTime()
    const bt = new Date(b.publishedAt || b.firstSeenAt).getTime()
    return (Number.isFinite(at) ? at : Infinity) - (Number.isFinite(bt) ? bt : Infinity)
  })
  const rep = members[0]
  const corr = corroborate(members.map((m) => ({ sourceId: m.sourceId, dir: m.dir })))
  // Entity union across members: max confidence, uncertain if any member is.
  const entBySymbol = new Map()
  for (const m of members) {
    for (const e of linkEntities(m.title, m.excerpt)) {
      const prev = entBySymbol.get(e.symbol)
      if (!prev || e.confidence > prev.confidence) entBySymbol.set(e.symbol, e)
      else if (e.uncertain) entBySymbol.set(e.symbol, { ...prev, uncertain: true })
    }
  }
  const firstSeen = members.reduce((t, m) => {
    const v = new Date(m.firstSeenAt).getTime()
    return Number.isFinite(v) && v < t ? v : t
  }, now)
  return {
    _id: eventIdFor(cluster.fingerprint),
    fingerprint: cluster.fingerprint,
    title: rep.title,
    marketGroup: rep.marketGroup || 'crypto',
    eventType: eventTypeForTags(rep.tags),
    status: 'active',
    firstSeenAt: new Date(firstSeen),
    lastSeenAt: new Date(now),
    itemIds: members.map((m) => String(m._id)),
    corroboration: corr,
    entities: [...entBySymbol.values()],
    revisions: [],
    schemaVersion: '1',
  }
}

/**
 * Cluster recent items (default 48h window, cap 500) into MarketEvents.
 * Upserts by deterministic _id: immutable fields $setOnInsert, evolving
 * fields $set. Correction/retraction signals append a revision and escalate
 * status (never de-escalate, never rewrite history).
 */
export async function clusterRecentEvents({
  NewsItemModel = null,
  MarketEventModel = null,
  windowHours = 48,
  cap = 500,
  now = new Date(),
} = {}) {
  const out = { events: 0, items: 0, corrections: 0 }
  const Item = NewsItemModel || (await getNewsItem())
  const Event = MarketEventModel || (await getMarketEvent())
  if (!Item || !Event) return out
  const since = new Date(now.getTime() - windowHours * 3600 * 1000)
  const raw = await Item.find({ ingestedAt: { $gte: since } })
    .sort({ ingestedAt: -1 })
    .limit(cap)
    .lean()
  if (!raw.length) return out
  out.items = raw.length
  const clusters = clusterItems(raw)
  const ops = clusters.map((c) => {
    const doc = toMarketEvent(c, now.getTime())
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $setOnInsert: {
            _id: doc._id,
            fingerprint: doc.fingerprint,
            title: doc.title,
            marketGroup: doc.marketGroup,
            eventType: doc.eventType,
            firstSeenAt: doc.firstSeenAt,
            revisions: [],
          },
          $set: {
            lastSeenAt: doc.lastSeenAt,
            itemIds: doc.itemIds,
            corroboration: doc.corroboration,
            entities: doc.entities,
          },
        },
        upsert: true,
      },
    }
  })
  const res = await Event.bulkWrite(ops, { ordered: false })
  const upserted = typeof res?.getUpsertedIds === 'function' ? Object.keys(res.getUpsertedIds()).length : 0
  out.events = clusters.length
  out.newEvents = upserted
  // Correction flow: append-only revision + status escalation for flagged items.
  const flagged = []
  for (const c of clusters) {
    for (const m of c.members) {
      const signal = correctionSignal(m.title, m.excerpt)
      if (signal) flagged.push({ eventId: eventIdFor(c.fingerprint), itemId: String(m._id), signal })
    }
  }
  const domainEvents = []
  const invalidatedGroups = new Set()
  for (const f of flagged) {
    const status = f.signal === 'retraction' ? 'retracted' : 'corrected'
    const kind = f.signal === 'retraction' ? 'retraction' : f.signal === 'amendment' ? 'amendment' : 'correction'
    // Append-only but idempotent: the same item never records twice.
    const cur = await Event.findOne({ _id: f.eventId }).select({ status: 1, revisions: 1, corroboration: 1, marketGroup: 1, itemIds: 1 }).lean()
    const seen = (cur?.revisions || []).some((r) => r.itemId === f.itemId && r.kind === kind)
    if (!seen) {
      await Event.updateOne({ _id: f.eventId }, { $push: { revisions: { at: now, kind, itemId: f.itemId, note: '' } } })
    }
    // Escalate only (active -> corrected -> retracted); never de-escalate.
    const order = { active: 0, corrected: 1, retracted: 2 }
    if (cur && order[status] > order[cur.status || 'active']) {
      await Event.updateOne({ _id: f.eventId }, { $set: { status } })
      // §60.12: the change produces durable domain events, and a correction or
      // retraction must reach the views derived from it.
      domainEvents.push(...diffMarketEvent(
        { status: cur.status || 'active', corroboration: cur.corroboration || null },
        { _id: f.eventId, status, corroboration: cur.corroboration || null, itemIds: [f.itemId] },
        { at: now.getTime(), correlationId: 'news.cluster' },
      ))
      if (invalidatesViews(status === 'retracted' ? 'news.item.retracted' : 'news.item.corrected')) {
        invalidatedGroups.add(String(cur.marketGroup || ''))
      }
    }
    out.corrections += 1
  }
  if (domainEvents.length) {
    const written = await persistDomainEvents(domainEvents)
    out.domainEvents = written.inserted
  }
  let invalidated = 0
  for (const group of invalidatedGroups) {
    if (!group) continue
    invalidated += await invalidateOutlooks(group, 'correction_or_retraction', { now })
  }
  out.invalidatedOutlooks = invalidated
  out.assessments = await assessRecentItems(raw, clusters, { AssessmentModel: null, now }).catch(() => 0)
  return out
}

/**
 * Persist rule-v1 assessments for freshly clustered items. Item -> event is
 * joined via cluster membership (no extra reads). Upsert by deterministic
 * `_id = itemId|rule-v1`; returns count written. Fail-soft via caller.
 */
export async function assessRecentItems(raw, clusters, { AssessmentModel = null, now = new Date() } = {}) {
  if (!raw?.length || !clusters?.length) return 0
  const Model = AssessmentModel || (await getNewsAssessment())
  if (!Model) return 0
  const eventByItem = new Map()
  const eventById = new Map()
  for (const c of clusters) {
    const doc = toMarketEvent(c, now.getTime())
    eventById.set(doc._id, doc)
    for (const m of c.members) eventByItem.set(String(m._id), doc)
  }
  const ops = []
  for (const it of raw) {
    const a = assessNewsItem(it, eventByItem.get(String(it._id)) || null, now.getTime())
    ops.push({ updateOne: { filter: { _id: a._id }, update: { $setOnInsert: a }, upsert: true } })
  }
  if (!ops.length) return 0
  const res = await Model.bulkWrite(ops, { ordered: false })
  return typeof res?.getUpsertedIds === 'function' ? Object.keys(res.getUpsertedIds()).length : (res?.upsertedCount ?? 0)
}
