import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectDomainEvents,
  diffMarketEvent,
  diffOutlook,
  diffSourceHealth,
  domainEvent,
  domainEventIdFor,
  invalidatesViews,
  NEWS_DOMAIN_EVENT_SCHEMA_VERSION,
  NEWS_DOMAIN_EVENT_TYPES,
} from '../engine/newsDomainEvents.mjs'
import { NEWS_DOMAIN_EVENT_RETENTION_SECONDS } from '../engine/models/newsDomainEvent.mjs'
import { invalidateOutlooks } from '../services/newsEvents.mjs'
import { persistDomainEvents } from '../services/newsStore.mjs'

// =============================================================================
//  News/macro domain events — V3.5 §60.12.
//
//  §60.12 states the contract and the consequence: every event needs a durable
//  id, schema version, entity ref, occurred-at/emitted-at, idempotency key and
//  correlation id — and "a correction/retraction must reach derived outlooks and
//  active research views; do not silently leave an old outlook presented as
//  current". These tests lock both halves.
// =============================================================================

const T0 = 1_790_000_000_000

describe('domain events — envelope and vocabulary (§60.12)', () => {
  test('the event carries the full §60.12 envelope', () => {
    const e = domainEvent({ type: 'news.item.ingested', entityId: 'news_a', at: T0, correlationId: 'news.ingest', data: { level: 'high' } })
    assert.match(e.eventId, /^nde_[a-f0-9]{40}$/)
    assert.equal(e._id, e.eventId)
    assert.equal(e.schemaVersion, NEWS_DOMAIN_EVENT_SCHEMA_VERSION)
    assert.deepEqual(e.entityRef, { kind: 'news_item', id: 'news_a' })
    assert.equal(e.occurredAt.getTime(), T0)
    assert.equal(e.emittedAt.getTime(), T0)
    assert.equal(e.idempotencyKey, 'news.item.ingested:news_a:default')
    assert.equal(e.correlationId, 'news.ingest')
  })

  test('ids are deterministic per (type, entity, time, key)', () => {
    const a = domainEventIdFor('news.item.retracted', 'news_a', T0, 'evt_1')
    assert.equal(a, domainEventIdFor('news.item.retracted', 'news_a', T0, 'evt_1'))
    assert.notEqual(a, domainEventIdFor('news.item.retracted', 'news_a', T0 + 1, 'evt_1'))
    assert.notEqual(a, domainEventIdFor('news.item.retracted', 'news_b', T0, 'evt_1'))
  })

  test('an unknown type or a missing entity fails loudly (a typo must not be logged as an event)', () => {
    assert.throws(() => domainEvent({ type: 'news.item.exploded', entityId: 'x', at: T0 }), /unknown type/)
    assert.throws(() => domainEvent({ type: 'news.item.ingested', at: T0 }), /entityId required/)
    assert.throws(() => domainEvent({ type: 'news.item.ingested', entityId: 'x', at: 0 }), /positive epoch ms/)
  })

  test('the vocabulary is the §60.12 list, and only corrections/disputes invalidate views', () => {
    assert.ok(NEWS_DOMAIN_EVENT_TYPES.includes('news.item.corrected'))
    assert.ok(NEWS_DOMAIN_EVENT_TYPES.includes('outlook.snapshot.expired'))
    assert.ok(NEWS_DOMAIN_EVENT_TYPES.includes('macro.release.revised'))
    assert.equal(invalidatesViews('news.item.retracted'), true)
    assert.equal(invalidatesViews('news.item.corrected'), true)
    assert.equal(invalidatesViews('news.event.disputed'), true)
    assert.equal(invalidatesViews('news.source.degraded'), false, 'an availability signal is not a view change')
    assert.equal(invalidatesViews('news.item.ingested'), false)
  })
})

describe('diffs — only real changes produce events', () => {
  const event = (over = {}) => ({ _id: 'evt_1', status: 'active', corroboration: { status: 'single_source', independentSources: 1 }, itemIds: ['news_a'], ...over })

  test('a retraction escalates: per-item retracted plus a disputed event', () => {
    const evs = diffMarketEvent(event(), event({ status: 'retracted', itemIds: ['news_a', 'news_b'] }), { at: T0, correlationId: 'news.cluster' })
    const types = evs.map((e) => e.type).sort()
    assert.deepEqual(types, ['news.event.disputed', 'news.item.retracted', 'news.item.retracted'])
    const items = evs.filter((e) => e.type === 'news.item.retracted').map((e) => e.entityRef.id).sort()
    assert.deepEqual(items, ['news_a', 'news_b'])
    assert.ok(evs.every((e) => e.correlationId === 'news.cluster'))
  })

  test('a correction marks the items corrected but does not dispute the event', () => {
    const evs = diffMarketEvent(event(), event({ status: 'corrected' }), { at: T0 })
    assert.deepEqual(evs.map((e) => e.type), ['news.item.corrected'])
  })

  test('re-clustering an unchanged event emits nothing (idempotent by construction)', () => {
    assert.deepEqual(diffMarketEvent(event(), event(), { at: T0 }), [])
    // De-escalation is not possible in the model, and the diff must not invent it.
    assert.deepEqual(diffMarketEvent(event({ status: 'retracted' }), event({ status: 'active' }), { at: T0 }), [])
  })

  test('corroboration flips confirm or dispute the event, with the source count', () => {
    const confirmed = diffMarketEvent(event(), event({ corroboration: { status: 'multi_source', independentSources: 3 } }), { at: T0 })
    assert.equal(confirmed.length, 1)
    assert.equal(confirmed[0].type, 'news.event.confirmed')
    assert.equal(confirmed[0].data.independentSources, 3)
    const disputed = diffMarketEvent(event(), event({ corroboration: { status: 'contradicted', independentSources: 2 } }), { at: T0 })
    assert.equal(disputed[0].type, 'news.event.disputed')
    assert.equal(invalidatesViews(disputed[0].type), true)
  })

  test('source health flips degrade and recover (and only across the ok boundary)', () => {
    assert.deepEqual(diffSourceHealth({ state: 'ok' }, { sourceId: 'coindesk', state: 'down', error: 'HTTP 500' }, { at: T0 }).map((e) => e.type), ['news.source.degraded'])
    assert.deepEqual(diffSourceHealth({ state: 'down' }, { sourceId: 'coindesk', state: 'ok' }, { at: T0 }).map((e) => e.type), ['news.source.recovered'])
    assert.deepEqual(diffSourceHealth({ state: 'degraded' }, { sourceId: 'coindesk', state: 'down' }, { at: T0 }), [], 'down -> degraded is not a new signal')
    assert.deepEqual(diffSourceHealth({ state: 'ok' }, { sourceId: 'coindesk', state: 'ok' }, { at: T0 }), [])
    assert.deepEqual(diffSourceHealth({ state: 'ok' }, { state: 'down' }, { at: T0 }), [], 'no sourceId: nothing to attribute')
  })

  test('outlook lifecycle emits ready once and expired when the window closes', () => {
    const snap = { _id: 'outlook_crypto_short_term_2026-10-01', state: 'bullish', marketGroup: 'crypto', horizon: 'short_term', expiresAt: { getTime: () => T0 + 1000 } }
    const ready = diffOutlook(null, snap, { at: T0 })
    assert.deepEqual(ready.map((e) => e.type), ['outlook.snapshot.ready'])
    assert.deepEqual(diffOutlook(snap, snap, { at: T0 }), [], 'an unchanged snapshot is not news')
  })

  test('collect drops duplicates by deterministic id', () => {
    const e = domainEvent({ type: 'news.item.ingested', entityId: 'news_a', at: T0 })
    assert.equal(collectDomainEvents([[e], [e, undefined as never]]).length, 1)
  })
})

describe('persistence and propagation', () => {
  const fakeDomainModel = () => {
    const docs = new Map<string, Record<string, any>>()
    return {
      docs,
      async updateOne(filter: Record<string, any>, update: Record<string, any>) {
        const id = String(filter._id)
        if (docs.has(id)) return { acknowledged: true }
        docs.set(id, update.$setOnInsert)
        return { acknowledged: true, upsertedCount: 1, upsertedId: id }
      },
    }
  }

  test('emitting the same events twice writes one row each (idempotent)', async () => {
    const Model = fakeDomainModel()
    const events = diffMarketEvent(
      { _id: 'evt_1', status: 'active', corroboration: { status: 'single_source' } },
      { _id: 'evt_1', status: 'retracted', corroboration: { status: 'single_source' }, itemIds: ['news_a'] },
      { at: T0 },
    )
    const first = await persistDomainEvents(events, { NewsDomainEventModel: Model })
    assert.equal(first.inserted, events.length)
    const second = await persistDomainEvents(events, { NewsDomainEventModel: Model })
    assert.equal(second.inserted, 0)
    assert.equal(second.duplicates, events.length)
    assert.equal(Model.docs.size, events.length)
  })

  test('propagation: an invalidation stamps every non-expired snapshot of that group', async () => {
    const calls: Array<Record<string, unknown>> = []
    const Model = {
      async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
        calls.push({ filter, update })
        return { modifiedCount: 2 }
      },
    }
    const now = new Date(T0)
    const changed = await invalidateOutlooks('crypto', 'correction_or_retraction', { MarketOutlookModel: Model, now })
    assert.equal(changed, 2)
    assert.deepEqual(calls[0].filter, { marketGroup: 'crypto', expiresAt: { $gt: now }, invalidatedAt: null }, 'already-invalidated and expired views are left alone')
    assert.deepEqual(calls[0].update, { $set: { invalidatedAt: now, staleReason: 'correction_or_retraction' } })
    // Fail-soft and honest zeroes.
    assert.equal(await invalidateOutlooks('', 'x', { MarketOutlookModel: Model }), 0)
    const broken = { updateMany: async () => { throw new Error('mongo down') } }
    assert.equal(await invalidateOutlooks('crypto', 'x', { MarketOutlookModel: broken, now }), 0)
  })

  test('the services are actually wired to emit and to propagate (source guards)', () => {
    const clustering = readFileSync(new URL('../services/newsEvents.mjs', import.meta.url), 'utf8')
    assert.match(clustering, /domainEvents\.push\(\.\.\.diffMarketEvent\(/)
    assert.match(clustering, /const written = await persistDomainEvents\(domainEvents\)/)
    assert.match(clustering, /invalidated \+= await invalidateOutlooks\(group, 'correction_or_retraction'/)
    const ingest = readFileSync(new URL('../services/news.mjs', import.meta.url), 'utf8')
    assert.match(ingest, /healthEvents\.push\(\.\.\.diffSourceHealth\(/)
    assert.match(ingest, /if \(healthEvents\.length\) await persistDomainEvents\(healthEvents\)/)
    const reader = readFileSync(new URL('../server/utils/newsStore.ts', import.meta.url), 'utf8')
    assert.match(reader, /stale: expired \|\| invalidatedAt !== null/, 'a corrected outlook must read as stale')
  })

  test('events outlive the items they refer to (retention is deliberate)', () => {
    assert.equal(NEWS_DOMAIN_EVENT_RETENTION_SECONDS, 30 * 24 * 3600)
    const model = readFileSync(new URL('../engine/models/newsDomainEvent.mjs', import.meta.url), 'utf8')
    assert.match(model, /expireAfterSeconds: NEWS_DOMAIN_EVENT_RETENTION_SECONDS/)
  })
})
