// engine/newsEvidenceSet.mjs
// News evidence freeze (V3.5 §60 Slice E) — PURE, offline-testable.
//
// freezeNewsEvidence: selects the exact rows available at `asOf`
// (PIT: firstSeenAt <= asOf; macro via vintage-pinned observation ids) and
// returns the deterministic set doc. Historical evaluations MUST use the
// frozen ids — re-querying live collections would mix future items into past
// predictions (§60.17 time-correctness).

import { createHash } from 'node:crypto'
import { NEWS_RETENTION_SECONDS } from './newsIngest.mjs'

export const NEWS_EVIDENCE_SCHEMA_VERSION = '1'

/**
 * Citation-reference policy version (§60.11 "rights-safe references and
 * hashes"). v1 copies the allowlisted reference fields at freeze time;
 * never body text, never the excerpt.
 */
export const NEWS_EVIDENCE_REF_POLICY = 'refs-v1'

/** Per-collection ref caps — mirror the freeze query limits in the server glue. */
export const NEWS_EVIDENCE_REF_CAPS = Object.freeze({ items: 500, events: 200, observations: 200 })

const ISO = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const str = (v) => (v === undefined || v === null || v === '' ? null : String(v))

/**
 * Rights-safe citation reference for one NewsItem. Allowlisted fields only:
 * who said it, when, where to re-read it and the hash that proves which row it
 * was. `excerpt` is deliberately NOT copied — a frozen set declares
 * `metadataOnly`/`noFullText`, and a reference must not smuggle text past that
 * declaration. Returns null when the row has no usable id (never invent one).
 */
export function newsItemRef(it = {}) {
  const itemId = str(it._id || it.id)
  if (!itemId) return null
  return {
    itemId,
    title: String(it.title || ''),
    sourceId: str(it.sourceId),
    sourceTier: str(it.sourceTier),
    marketGroup: str(it.marketGroup),
    // Citation needs the ORIGINAL link (toPublicNewsItem precedent).
    url: String(it.originUrl || it.url || '') || null,
    publishedAt: ISO(it.publishedAt),
    firstSeenAt: ISO(it.firstSeenAt),
    status: ['active', 'corrected', 'retracted'].includes(it.status) ? it.status : 'active',
    contentHash: str(it.hash || it.contentHash),
  }
}

/** Rights-safe reference for one MarketEvent (cluster): provenance, no text. */
export function marketEventRef(e = {}) {
  const eventId = str(e._id || e.id)
  if (!eventId) return null
  return {
    eventId,
    title: String(e.title || ''),
    marketGroup: str(e.marketGroup),
    eventType: str(e.eventType),
    status: ['active', 'corrected', 'retracted'].includes(e.status) ? e.status : 'active',
    firstSeenAt: ISO(e.firstSeenAt),
    corroboration: str(e.corroboration?.status),
    sourceIds: Array.isArray(e.corroboration?.sourceIds) ? e.corroboration.sourceIds.map(String) : [],
    itemIds: Array.isArray(e.itemIds) ? e.itemIds.map(String) : [],
  }
}

/** Rights-safe reference for one vintage-pinned MacroObservation. */
export function macroObservationRef(ob = {}) {
  const observationId = str(ob._id)
  if (!observationId) return null
  return {
    observationId,
    seriesId: str(ob.seriesId),
    refPeriod: str(ob.refPeriod),
    value: typeof ob.value === 'number' ? ob.value : null,
    unit: String(ob.unit || ''),
    vintageAt: ISO(ob.vintageAt),
    status: str(ob.status),
  }
}

const byId = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)

function availMs(r) {
  const t = new Date(r.firstSeenAt || r.publishedAt || r.vintageAt || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

export function newsEvidenceSetIdFor({ itemIds = [], eventIds = [], observationIds = [], asOf, purpose }) {
  const body = [...itemIds].sort().join(',') + '|' + [...eventIds].sort().join(',') + '|' +
    [...observationIds].sort().join(',') + '|' + new Date(asOf).toISOString() + '|' + purpose
  return `nev_${createHash('sha1').update(body).digest('hex')}`
}

/**
 * @param {object} o { items, events, observations, group, symbols, horizon, purpose, asOfMs, createdBy }
 * observations: macro rows with vintageAt (only vintages <= asOf are taken).
 */
export function freezeNewsEvidence(o = {}) {
  const asOf = Number.isFinite(o.asOfMs) ? o.asOfMs : Date.now()
  const purpose = o.purpose || 'evaluation'
  const items = [], futureItems = [], itemRefs = []
  let refsMissing = 0
  for (const it of o.items || []) {
    const id = String(it._id || it.id)
    if (availMs(it) > asOf) {
      futureItems.push(id)
      continue
    }
    items.push(id)
    const ref = newsItemRef(it)
    if (ref) itemRefs.push(ref)
    else refsMissing += 1
  }
  const events = [], futureEvents = [], eventRefs = []
  for (const e of o.events || []) {
    if (e.status === 'retracted') continue // retracted rows never enter evidence
    if (availMs(e) > asOf) {
      futureEvents.push(String(e._id || e.id))
      continue
    }
    events.push(String(e._id || e.id))
    const ref = marketEventRef(e)
    if (ref) eventRefs.push(ref)
    else refsMissing += 1
  }
  const observations = [], observationRefs = []
  for (const ob of o.observations || []) {
    const v = new Date(ob.vintageAt).getTime()
    if (!Number.isFinite(v) || v > asOf) continue
    observations.push(String(ob._id))
    const ref = macroObservationRef(ob)
    if (ref) observationRefs.push(ref)
    else refsMissing += 1
  }
  const setId = newsEvidenceSetIdFor({ itemIds: items, eventIds: events, observationIds: observations, asOf, purpose })
  const hash = createHash('sha1').update([...items].sort().join('|') + '#' + [...events].sort().join('|')).digest('hex')
  itemRefs.sort(byId('itemId'))
  eventRefs.sort(byId('eventId'))
  observationRefs.sort(byId('observationId'))
  return {
    _id: setId,
    setId,
    purpose,
    group: o.group || 'crypto',
    symbols: o.symbols || [],
    horizon: o.horizon || null,
    asOf: new Date(asOf),
    itemIds: [...items].sort(),
    eventIds: [...events].sort(),
    observationIds: [...observations].sort(),
    // §60.11 retention exception: the cited rows' references are COPIED here at
    // freeze time. NewsItem carries a 7-day TTL, so a set that only stored ids
    // would decay into dangling citations — the exact thing the roadmap forbids.
    itemRefs: itemRefs.slice(0, NEWS_EVIDENCE_REF_CAPS.items),
    eventRefs: eventRefs.slice(0, NEWS_EVIDENCE_REF_CAPS.events),
    observationRefs: observationRefs.slice(0, NEWS_EVIDENCE_REF_CAPS.observations),
    refPolicy: {
      version: NEWS_EVIDENCE_REF_POLICY,
      capturedAtFreeze: true,
      sourceTtlSeconds: NEWS_RETENTION_SECONDS,
      missing: refsMissing,
      caps: { ...NEWS_EVIDENCE_REF_CAPS },
    },
    pitFlags: {
      futureItemsExcluded: futureItems.length,
      futureEventsExcluded: futureEvents.length,
      retractedExcluded: true,
      macroVintagesPinned: true,
    },
    rights: { metadataOnly: true, noFullText: true, noTrainingUse: true },
    hash,
    frozen: true,
    immutable: true,
    usedByExperimentIds: [],
    createdBy: o.createdBy || null,
    schemaVersion: NEWS_EVIDENCE_SCHEMA_VERSION,
  }
}

/**
 * Honesty check for a frozen set against the rows that still exist NOW
 * (`liveItemIds` = ids still present in `news_items`).
 *
 * `reproducible` is the guarantee this module makes: every id the set cites has
 * a frozen reference beside it, so a source row deleted by TTL expiry cannot
 * turn the set into a dangling citation. `expired` reports the decay that did
 * happen — counted, never hidden.
 */
export function evidenceRefSurvival(setDoc = {}, liveItemIds = []) {
  const live = new Set((liveItemIds || []).map(String))
  const cited = (setDoc.itemIds || []).map(String)
  const refIds = new Set((setDoc.itemRefs || []).map((r) => String(r.itemId)))
  const expiredItemIds = cited.filter((id) => !live.has(id))
  return {
    cited: cited.length,
    live: cited.length - expiredItemIds.length,
    expired: expiredItemIds.length,
    expiredItemIds,
    refsCovered: cited.filter((id) => refIds.has(id)).length,
    reproducible: cited.every((id) => refIds.has(id)),
  }
}
