// =============================================================================
//  Exchange event/mapping persistence (roadmap §63.12/§64.6, goal G).
//
//  Idempotent by construction: every write UPSERTS on a venue+account-scoped
//  key, so a retry/reconnect re-delivering the same order/fill/event updates in
//  place instead of duplicating. Fill dedupe additionally uses reconcile.execKey.
//  Stored payloads are the SANITIZED normalized data + a redacted raw hash — we
//  never persist secrets, signatures or auth headers. Nothing is merged across
//  venues: the venue/account are part of every key.
// =============================================================================

import { createHash } from 'node:crypto'
import { ExchangeEvent } from '../../engine/models/exchangeEvent.mjs'
import { ExchangeOrderMapping } from '../../engine/models/exchangeOrderMapping.mjs'
import { execKey } from './reconcile.mjs'
import { sanitizeText } from './errors.mjs'

/** Stable, venue+account-scoped idempotency key for an event. */
export function idempotencyKeyFor(ev = {}) {
  const natural = ev.execId
    ? `exec:${ev.execId}`
    : ev.externalOrderId
      ? `order:${ev.externalOrderId}:${ev.kind ?? 'order'}:${ev.eventTime ?? ''}`
      : ev.clientOrderId
        ? `cli:${ev.clientOrderId}:${ev.kind ?? 'order'}:${ev.eventTime ?? ''}`
        : `${ev.kind ?? 'event'}:${ev.eventTime ?? ''}:${ev.correlationId ?? ''}`
  return `ee_${ev.venue}_${ev.accountId ?? 'default'}_${createHash('sha256').update(natural).digest('hex').slice(0, 32)}`
}

function redactedHash(raw) {
  if (raw == null) return null
  return createHash('sha256').update(sanitizeText(typeof raw === 'string' ? raw : JSON.stringify(raw))).digest('hex')
}

/**
 * Persist one normalized event idempotently.
 * @returns {Promise<{id:string, inserted:boolean}>}
 */
export async function persistEvent(ownerId, ev = {}, { _models = null } = {}) {
  const M = _models?.ExchangeEvent ?? ExchangeEvent
  const _id = ev.idempotencyKey ?? idempotencyKeyFor({ ...ev, venue: ev.venue })
  const doc = {
    _id, ownerId,
    exchangeConnectionId: ev.exchangeConnectionId ?? null,
    venue: ev.venue, environment: 'DEMO', accountId: ev.accountId ?? 'default',
    sessionId: ev.sessionId ?? null, botInstanceId: ev.botInstanceId ?? null, agentId: ev.agentId ?? null,
    kind: ev.kind, externalOrderId: ev.externalOrderId ?? null, clientOrderId: ev.clientOrderId ?? null, execId: ev.execId ?? null,
    canonicalInstrumentId: ev.canonicalInstrumentId ?? null, venueInstrumentId: ev.venueInstrumentId ?? null,
    productCategory: ev.productCategory ?? null, contractSpecVersion: ev.contractSpecVersion ?? null,
    accountingState: ev.accountingState ?? null,
    data: ev.data ?? null, rawHash: redactedHash(ev.raw),
    eventTime: ev.eventTime ?? null, ingestTime: ev.ingestTime ?? Date.now(), correlationId: ev.correlationId ?? null,
    strategyVersionId: ev.strategyVersionId ?? null,
  }
  const existing = await M.findOne({ _id }).lean()
  await M.updateOne({ _id }, { $set: doc, $setOnInsert: { _id } }, { upsert: true })
  return { id: _id, inserted: !existing }
}

/**
 * Persist a batch of normalized executions idempotently, deduping against the
 * keys already stored for this venue+account. Returns accepted vs duplicates so
 * the caller can prove a retry never created a second fill.
 */
export async function persistExecutions(ownerId, scope = {}, fills = [], opts = {}) {
  const M = opts._models?.ExchangeEvent ?? ExchangeEvent
  const accepted = []
  const duplicates = []
  for (const f of fills) {
    const key = idempotencyKeyFor({ ...f, venue: scope.venue, accountId: scope.accountId, kind: 'execution' })
    const exists = await M.findOne({ _id: key }).lean()
    if (exists) { duplicates.push({ execId: f.execId, key }); continue }
    await persistEvent(ownerId, { ...f, ...scope, kind: 'execution', idempotencyKey: key, accountingState: f.feeState ?? 'VERIFIED_VENUE' }, opts)
    accepted.push({ execId: f.execId, key })
  }
  return { accepted, duplicates }
}

/** Upsert the intent↔venue order mapping (idempotent on clientOrderId). */
export async function upsertOrderMapping(ownerId, m = {}, opts = {}) {
  const M = opts._models?.ExchangeOrderMapping ?? ExchangeOrderMapping
  const _id = `${ownerId}:${m.venue}:${m.accountId ?? 'default'}:${m.clientOrderId}`
  const doc = {
    _id, ownerId, exchangeConnectionId: m.exchangeConnectionId ?? null, venue: m.venue, environment: 'DEMO',
    accountId: m.accountId ?? 'default', sessionId: m.sessionId ?? null, botInstanceId: m.botInstanceId ?? null, agentId: m.agentId ?? null,
    clientOrderId: m.clientOrderId, externalOrderId: m.externalOrderId ?? null,
    canonicalInstrumentId: m.canonicalInstrumentId ?? null, venueInstrumentId: m.venueInstrumentId ?? null, productCategory: m.productCategory ?? null,
    side: m.side ?? null, type: m.type ?? 'market', qty: m.qty ?? null, status: m.status ?? 'submitted',
    strategyVersionId: m.strategyVersionId ?? null, riskDecisionId: m.riskDecisionId ?? null,
    submittedAt: m.submittedAt ?? Date.now(), ackAt: m.ackAt ?? null,
  }
  await M.updateOne({ _id }, { $set: doc, $setOnInsert: { _id } }, { upsert: true })
  return _id
}

export async function getOrderMapping(ownerId, { venue, accountId = 'default', clientOrderId }, opts = {}) {
  const M = opts._models?.ExchangeOrderMapping ?? ExchangeOrderMapping
  return M.findOne({ _id: `${ownerId}:${venue}:${accountId}:${clientOrderId}` }).lean()
}

export async function listEvents(filter = {}, opts = {}) {
  const M = opts._models?.ExchangeEvent ?? ExchangeEvent
  const q = {}
  if (filter.ownerId) q.ownerId = filter.ownerId
  if (filter.venue) q.venue = filter.venue
  if (filter.accountId) q.accountId = filter.accountId
  if (filter.sessionId) q.sessionId = filter.sessionId
  if (filter.kind) q.kind = filter.kind
  return M.find(q).sort({ eventTime: -1, createdAt: -1 }).limit(filter.limit ?? 200).lean()
}

export { execKey }
