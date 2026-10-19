// engine/tradingDomainEvents.mjs
// Trading domain events (roadmap §61.17 Phase C "Canonical events and UI state
// propagation") — PURE, offline-testable.
//
//  Phase C asks for "domain event schemas and idempotency contracts" before an
//  outbox/queue and shared workspace invalidation can be built on top. This
//  module is that contract for the TRADING domain (accounts, orders, fills,
//  positions, in-app signals): every event carries a durable deterministic id, a
//  schema version, an entity reference, the owning user, UTC occurred/emitted
//  stamps and an idempotency key — the same shape `engine/newsDomainEvents.mjs`
//  already gives the news domain.
//
//  It also declares WHICH derived views each event invalidates. The server
//  publishes the events; the client uses the mapping to refetch only the screens
//  that actually changed (no manual hard refresh, §61.17 Phase C acceptance).
//
//  Ids are DETERMINISTIC (`tde_<sha1>`), so consuming/replaying the same fact
//  emits the same id: a re-run updates one row instead of appending a duplicate
//  (same idempotency discipline as D3/D4).
//
//  TENANCY (§61.3): every trading event MUST carry the owning user. An event
//  without an `ownerId` is a bug and throws — one user's state must never leak
//  into another's workspace.

import { createHash } from 'node:crypto'

export const TRADING_DOMAIN_EVENT_SCHEMA_VERSION = '1'

/**
 * The Phase C trading event vocabulary. Adding a type here is the only way to
 * emit one, so the set of "things that can change a workspace" stays explicit.
 */
export const TRADING_DOMAIN_EVENT_TYPES = Object.freeze([
  // Account (durable paper book SPEC) lifecycle.
  'account.created',
  'account.renamed',
  'account.archived',
  'account.unarchived',
  'account.deleted',
  // Order lifecycle (risk gate + paper executor).
  'order.created',
  'order.risk-rejected',
  'order.partially-filled',
  'order.filled',
  'order.cancelled',
  'order.expired',
  // Fill + position book.
  'fill.recorded',
  'position.opened',
  'position.updated',
  'position.closed',
  // In-app signal (§61.17 Phase D producer).
  'signal.received',
])

/** Entity kind defaults per event type — the `entityRef.kind` written downstream. */
const ENTITY_KIND_BY_TYPE = Object.freeze({
  'account.created': 'account',
  'account.renamed': 'account',
  'account.archived': 'account',
  'account.unarchived': 'account',
  'account.deleted': 'account',
  'order.created': 'order',
  'order.risk-rejected': 'order',
  'order.partially-filled': 'order',
  'order.filled': 'order',
  'order.cancelled': 'order',
  'order.expired': 'order',
  'fill.recorded': 'fill',
  'position.opened': 'position',
  'position.updated': 'position',
  'position.closed': 'position',
  'signal.received': 'signal',
})

/**
 * Which derived views an event invalidates. Keys are the workspace view ids the
 * client subscribes to: `accounts`, `orders`, `positions`, `paper`, `signals`.
 * Fills are shown INSIDE the orders view, so a fill invalidates `orders` (not a
 * separate `fills` key) — the mapping mirrors what the screens actually render.
 */
const VIEWS_BY_TYPE = Object.freeze({
  'account.created': ['accounts', 'paper'],
  'account.renamed': ['accounts', 'paper'],
  'account.archived': ['accounts', 'orders', 'positions', 'paper'],
  'account.unarchived': ['accounts', 'orders', 'positions', 'paper'],
  'account.deleted': ['accounts', 'paper'],
  'order.created': ['orders', 'positions', 'accounts'],
  'order.risk-rejected': ['orders'],
  'order.partially-filled': ['orders', 'positions', 'accounts'],
  'order.filled': ['orders', 'positions', 'accounts'],
  'order.cancelled': ['orders', 'positions', 'accounts'],
  'order.expired': ['orders', 'positions', 'accounts'],
  'fill.recorded': ['orders', 'positions', 'accounts'],
  'position.opened': ['positions', 'accounts'],
  'position.updated': ['positions', 'accounts'],
  'position.closed': ['positions', 'accounts'],
  'signal.received': ['signals'],
})

export function isTradingDomainEventType(type) {
  return TRADING_DOMAIN_EVENT_TYPES.includes(String(type))
}

/** Entity kind this event type refers to (falls back to the type's first segment). */
export function entityKindFor(type) {
  const t = String(type)
  return ENTITY_KIND_BY_TYPE[t] || t.split('.')[0] || 'unknown'
}

/** The view ids this event invalidates (empty for an unknown type — never throws). */
export function invalidatesViews(type) {
  return VIEWS_BY_TYPE[String(type)] ? [...VIEWS_BY_TYPE[String(type)]] : []
}

/** Union of view ids invalidated by a batch of event types (deduped, stable order). */
export function viewKeysFor(types = []) {
  const out = new Set()
  for (const t of types) for (const v of invalidatesViews(t)) out.add(v)
  return [...out]
}

export function domainEventIdFor(type, entityId, occurredAtMs, key = '') {
  const at = new Date(Number(occurredAtMs) || 0).toISOString()
  return `tde_${createHash('sha1').update(`${type}|${entityId}|${at}|${key}`).digest('hex')}`
}

/** Stable idempotency key for one (type, entity, key) fact. */
export function idempotencyKeyFor(type, entityId, key = '') {
  return `${type}:${entityId}:${key || 'default'}`
}

/**
 * Build one durable trading domain event. Throws loudly on a bad input (unknown
 * type, non-positive time, missing entity, or — critically — a missing owner)
 * rather than landing an unconsumable or cross-user row in the log.
 *
 * @param {{type:string, entityId:string, ownerId:string, accountId?:string|null,
 *          entityKind?:string, at:number, data?:object|null,
 *          correlationId?:string|null, key?:string}} input
 */
export function tradingDomainEvent(input = {}) {
  const { type, entityId, ownerId, accountId = null, at, data = null, correlationId = null, key = '' } = input
  if (!isTradingDomainEventType(type)) throw new Error(`tradingDomainEvents: unknown type ${String(type)}`)
  const occurredAt = Number(at)
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) throw new Error('tradingDomainEvents: at must be a positive epoch ms')
  if (!entityId) throw new Error('tradingDomainEvents: entityId required')
  if (!ownerId || typeof ownerId !== 'string') throw new Error('tradingDomainEvents: ownerId required (tenancy §61.3)')
  const entityKind = input.entityKind || entityKindFor(type)
  const id = domainEventIdFor(type, String(entityId), occurredAt, key)
  return {
    _id: id,
    eventId: id,
    type: String(type),
    schemaVersion: TRADING_DOMAIN_EVENT_SCHEMA_VERSION,
    entityRef: { kind: String(entityKind), id: String(entityId) },
    ownerId: String(ownerId),
    accountId: accountId == null ? null : String(accountId),
    occurredAt: new Date(occurredAt), // event time (UTC) — when it happened
    emittedAt: new Date(occurredAt), // emission time; a writer may restamp to its own clock
    idempotencyKey: idempotencyKeyFor(type, String(entityId), key),
    correlationId: correlationId || null,
    invalidates: invalidatesViews(type),
    data,
  }
}

/** Collect every event in a batch of batches, dropping deterministic duplicates. */
export function collectTradingDomainEvents(batches = []) {
  const byId = new Map()
  for (const b of batches) {
    for (const e of b || []) {
      if (e && e._id && !byId.has(e._id)) byId.set(e._id, e)
    }
  }
  return [...byId.values()]
}
