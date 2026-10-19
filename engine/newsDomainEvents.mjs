// engine/newsDomainEvents.mjs
// News/macro domain events (V3.5 §60.12 "Internal domain events") — PURE,
// offline-testable.
//
//  §60.12 lists the event types AND their contract: "All events need a durable
//  event ID, schema version, entity reference, UTC occurred-at and emitted-at
//  timestamps, idempotency key, source/job correlation IDs and audit context. A
//  correction/retraction must reach derived outlooks and active research views;
//  do not silently leave an old outlook presented as current."
//
//  That last sentence is why this module exists: before it, a retraction was a
//  status on a MarketEvent that nothing propagated. Now a diff produces the
//  events, `invalidatesViews()` says which of them must invalidate a derived
//  view, and the service layer applies that to the outlook snapshots.
//
//  Ids are DETERMINISTIC (`nde_<sha1>`), so re-clustering the same window emits
//  the same events — a re-run updates one row instead of appending a duplicate.

import { createHash } from 'node:crypto'

export const NEWS_DOMAIN_EVENT_SCHEMA_VERSION = '1'

/** The §60.12 event vocabulary. Adding a type here is the only way to emit one. */
export const NEWS_DOMAIN_EVENT_TYPES = Object.freeze([
  'news.item.ingested',
  'news.item.updated',
  'news.item.corrected',
  'news.item.retracted',
  'news.cluster.updated',
  'news.event.confirmed',
  'news.event.disputed',
  'news.source.degraded',
  'news.source.recovered',
  'macro.release.published',
  'macro.release.revised',
  'outlook.snapshot.ready',
  'outlook.snapshot.expired',
  'news.evidence-set.created',
  'news.model-evaluation.completed',
])

/**
 * Events that invalidate a derived view. A correction or a retraction means an
 * outlook/research view built on the old reading must stop being presented as
 * current (a degraded or recovered source is not by itself a view change, it is
 * an availability signal — the delivery policy decides).
 */
export const VIEW_INVALIDATING_TYPES = Object.freeze([
  'news.item.corrected',
  'news.item.retracted',
  'news.event.disputed',
])

export function isDomainEventType(type) {
  return NEWS_DOMAIN_EVENT_TYPES.includes(String(type))
}

export function invalidatesViews(type) {
  return VIEW_INVALIDATING_TYPES.includes(String(type))
}

export function domainEventIdFor(type, entityId, occurredAtMs, key = '') {
  const at = new Date(Number(occurredAtMs) || 0).toISOString()
  return `nde_${createHash('sha1').update(`${type}|${entityId}|${at}|${key}`).digest('hex')}`
}

/**
 * Build one durable domain event. Throws on an unknown type — a typo must fail
 * loudly here rather than land in the log as an event nobody consumes.
 */
export function domainEvent({ type, entityId, entityKind = 'news_item', at, data = null, correlationId = null, key = '' } = {}) {
  if (!isDomainEventType(type)) throw new Error(`newsDomainEvents: unknown type ${String(type)}`)
  const occurredAt = Number(at)
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) throw new Error('newsDomainEvents: at must be a positive epoch ms')
  if (!entityId) throw new Error('newsDomainEvents: entityId required')
  const id = domainEventIdFor(type, String(entityId), occurredAt, key)
  return {
    _id: id,
    eventId: id,
    type: String(type),
    schemaVersion: NEWS_DOMAIN_EVENT_SCHEMA_VERSION,
    entityRef: { kind: String(entityKind), id: String(entityId) },
    occurredAt: new Date(occurredAt), // event time (UTC) — when it happened at the source
    emittedAt: new Date(occurredAt), // emission time; the writer may restamp to its own clock
    idempotencyKey: `${type}:${entityId}:${key || 'default'}`,
    correlationId: correlationId || null,
    data,
  }
}

const ORDER = { active: 0, corrected: 1, retracted: 2 }

/**
 * Diff one MarketEvent before/after a re-cluster and return the domain events
 * that follow from the change. Only ESCALATIONS and state flips produce events
 * (re-clustering the same story every cycle is not news).
 */
export function diffMarketEvent(prev, next, { at, correlationId = null, itemIds = null } = {}) {
  if (!next) return []
  const eventId = String(next._id || next.id || '')
  if (!eventId) return []
  const events = []
  const from = prev?.status || 'active'
  const to = next.status || 'active'
  const ids = itemIds || next.itemIds || []

  if (ORDER[to] > ORDER[from]) {
    for (const itemId of ids) {
      events.push(domainEvent({
        type: to === 'retracted' ? 'news.item.retracted' : 'news.item.corrected',
        entityId: String(itemId),
        at,
        correlationId,
        data: { eventId, from, to },
      }))
    }
    if (to === 'retracted') {
      events.push(domainEvent({ type: 'news.event.disputed', entityId: eventId, entityKind: 'market_event', at, correlationId, data: { reason: 'retraction', itemIds: ids.map(String) } }))
    }
  }

  const corrFrom = prev?.corroboration?.status || null
  const corrTo = next.corroboration?.status || null
  if (corrFrom !== corrTo && corrTo) {
    events.push(domainEvent({
      type: corrTo === 'contradicted' ? 'news.event.disputed' : 'news.event.confirmed',
      entityId: eventId,
      entityKind: 'market_event',
      at,
      correlationId,
      data: { from: corrFrom, to: corrTo, independentSources: next.corroboration?.independentSources ?? null },
    }))
  }
  return events
}

/** Source health flips: degraded when it leaves `ok`, recovered when it returns. */
export function diffSourceHealth(prev, next, { at, correlationId = null } = {}) {
  const from = prev?.state || null
  const to = next?.state || null
  if (!to || from === to) return []
  const sourceId = String(next?.sourceId || '')
  if (!sourceId) return []
  if (to !== 'ok' && from === 'ok') {
    return [domainEvent({ type: 'news.source.degraded', entityId: sourceId, entityKind: 'news_source', at, correlationId, data: { from, to, error: next.error || null } })]
  }
  if (to === 'ok' && from && from !== 'ok') {
    return [domainEvent({ type: 'news.source.recovered', entityId: sourceId, entityKind: 'news_source', at, correlationId, data: { from, to } })]
  }
  return []
}

/** Outlook lifecycle: a fresh snapshot is ready; an expired one must stop showing as current. */
export function diffOutlook(prev, next, { at, correlationId = null } = {}) {
  const id = String(next?._id || next?.snapshotId || '')
  if (!id) return []
  const state = next.state || 'insufficient_evidence'
  const out = []
  if (!prev) {
    out.push(domainEvent({ type: 'outlook.snapshot.ready', entityId: id, entityKind: 'market_outlook', at, correlationId, data: { state, marketGroup: next.marketGroup || null, horizon: next.horizon || null } }))
  }
  const expires = next.expiresAt ? new Date(next.expiresAt).getTime() : null
  const prevExpired = prev?.expiresAt ? new Date(prev.expiresAt).getTime() <= Number(at) : false
  if (expires && expires <= Number(at) && !prevExpired) {
    out.push(domainEvent({ type: 'outlook.snapshot.expired', entityId: id, entityKind: 'market_outlook', at, correlationId, data: { marketGroup: next.marketGroup || null, horizon: next.horizon || null } }))
  }
  return out
}

/** Collect every event implied by a batch of diffs, dropping deterministic duplicates. */
export function collectDomainEvents(batches = []) {
  const byId = new Map()
  for (const b of batches) {
    for (const e of b || []) {
      if (e && e._id && !byId.has(e._id)) byId.set(e._id, e)
    }
  }
  return [...byId.values()]
}
