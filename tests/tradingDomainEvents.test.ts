import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRADING_DOMAIN_EVENT_SCHEMA_VERSION,
  TRADING_DOMAIN_EVENT_TYPES,
  tradingDomainEvent,
  domainEventIdFor,
  idempotencyKeyFor,
  isTradingDomainEventType,
  entityKindFor,
  invalidatesViews,
  viewKeysFor,
  collectTradingDomainEvents
} from '../engine/tradingDomainEvents.mjs'

// =============================================================================
//  Trading domain-event contract (roadmap §61.17 Phase C).
//
//  The contract must be: durable + deterministic (same fact -> same id), tenant
//  safe (owner required), and explicit about which workspace views an event
//  invalidates. These are the guarantees the outbox + UI propagation build on.
// =============================================================================

const AT = Date.parse('2026-10-19T12:00:00.000Z')
const OWNER = 'owner-alice'

describe('tradingDomainEvent contract', () => {
  test('stamps a durable, versioned, owner-scoped event', () => {
    const e = tradingDomainEvent({ type: 'order.filled', entityId: 'ord-1', ownerId: OWNER, accountId: 'paper', at: AT })
    assert.equal(e.schemaVersion, TRADING_DOMAIN_EVENT_SCHEMA_VERSION)
    assert.equal(e.eventId, e._id)
    assert.equal(e.ownerId, OWNER)
    assert.equal(e.accountId, 'paper')
    assert.equal(e.entityRef.kind, 'order')
    assert.equal(e.entityRef.id, 'ord-1')
    assert.equal(e.occurredAt.toISOString(), '2026-10-19T12:00:00.000Z')
    assert.equal(e.idempotencyKey, 'order.filled:ord-1:default')
  })

  test('is deterministic: the same fact yields the same id', () => {
    const a = tradingDomainEvent({ type: 'fill.recorded', entityId: 'fill-9', ownerId: OWNER, at: AT })
    const b = tradingDomainEvent({ type: 'fill.recorded', entityId: 'fill-9', ownerId: OWNER, at: AT })
    assert.equal(a._id, b._id)
    assert.equal(a._id, domainEventIdFor('fill.recorded', 'fill-9', AT, ''))
    // a different key is a different fact
    const c = tradingDomainEvent({ type: 'fill.recorded', entityId: 'fill-9', ownerId: OWNER, at: AT, key: 'partial' })
    assert.notEqual(a._id, c._id)
    assert.equal(c.idempotencyKey, idempotencyKeyFor('fill.recorded', 'fill-9', 'partial'))
  })

  test('rejects an unknown type, bad time, missing entity and missing owner', () => {
    assert.throws(() => tradingDomainEvent({ type: 'order.nope', entityId: 'x', ownerId: OWNER, at: AT }), /unknown type/)
    assert.throws(() => tradingDomainEvent({ type: 'order.created', entityId: 'x', ownerId: OWNER, at: 0 }), /positive epoch ms/)
    assert.throws(() => tradingDomainEvent({ type: 'order.created', entityId: '', ownerId: OWNER, at: AT }), /entityId required/)
    assert.throws(() => tradingDomainEvent({ type: 'order.created', entityId: 'x', ownerId: '', at: AT }), /ownerId required/)
    assert.throws(() => tradingDomainEvent({ type: 'order.created', entityId: 'x', at: AT }), /ownerId required/)
  })

  test('every declared type has an entity kind and a view mapping', () => {
    for (const type of TRADING_DOMAIN_EVENT_TYPES) {
      assert.equal(isTradingDomainEventType(type), true)
      assert.ok(entityKindFor(type) && entityKindFor(type) !== 'unknown', `kind for ${type}`)
      assert.ok(invalidatesViews(type).length > 0, `views for ${type}`)
    }
  })
})

describe('workspace invalidation mapping', () => {
  test('maps the views each event touches', () => {
    assert.deepEqual(invalidatesViews('signal.received'), ['signals'])
    assert.deepEqual(invalidatesViews('position.closed'), ['positions', 'accounts'])
    assert.ok(invalidatesViews('account.archived').includes('orders'))
    assert.ok(invalidatesViews('fill.recorded').includes('orders'))
  })

  test('unknown type invalidates nothing (never throws)', () => {
    assert.deepEqual(invalidatesViews('order.nope'), [])
    assert.deepEqual(viewKeysFor(['order.nope']), [])
  })

  test('viewKeysFor unions and dedupes a batch', () => {
    const views = viewKeysFor(['order.filled', 'position.closed', 'signal.received', 'fill.recorded'])
    assert.deepEqual([...views].sort(), ['accounts', 'orders', 'positions', 'signals'])
  })

  test('collectTradingDomainEvents drops deterministic duplicates', () => {
    const a = tradingDomainEvent({ type: 'order.created', entityId: 'o1', ownerId: OWNER, at: AT })
    const a2 = tradingDomainEvent({ type: 'order.created', entityId: 'o1', ownerId: OWNER, at: AT })
    const b = tradingDomainEvent({ type: 'position.opened', entityId: 'p1', ownerId: OWNER, at: AT })
    assert.equal(collectTradingDomainEvents([[a, a2], [b]]).length, 2)
  })
})
