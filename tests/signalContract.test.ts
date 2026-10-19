import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SIGNAL_CONTRACT_VERSION,
  SIGNAL_EVENT_TYPES,
  isSignalEventType,
  normalizeIndicatorRefs,
  signalAttribution,
  signalKeyFor,
  signalDoc,
} from '../engine/signalContract.mjs'
import { SIGNAL_TYPES } from '../engine/models/signal.mjs'

// =============================================================================
//  Signal identity & attribution contract (roadmap §61.17 Phase D).
//
//  A signal must be traceable (which method/indicator/strategy/engine version
//  produced it) and its durable key must be deterministic, so a replayed or
//  retried event does not persist a second row. These are the guarantees the
//  native generator (D2) and the store (D3) build on.
// =============================================================================

const OWNER = 'owner-alice'

function attribution(over = {}) {
  return {
    method: 'vsa',
    methodVersion: '1',
    strategyVersion: 'vsa@1',
    engineVersion: '0.5.0',
    paramsHash: 'a'.repeat(64),
    ...over,
  }
}

describe('signalContract vocabulary', () => {
  test('contract version is stamped', () => {
    assert.equal(SIGNAL_CONTRACT_VERSION, '1')
  })

  test('event vocabulary stays in sync with the persisted signal model', () => {
    assert.deepEqual([...SIGNAL_EVENT_TYPES].sort(), [...SIGNAL_TYPES].sort())
    for (const t of SIGNAL_EVENT_TYPES) assert.equal(isSignalEventType(t), true)
    assert.equal(isSignalEventType('NOPE'), false)
  })
})

describe('signalKeyFor', () => {
  const base = { symbol: 'XAUUSD', tf: '5m', ts: Date.parse('2026-01-05T00:00:00.000Z'), type: 'SV', method: 'vsa', strategyVersion: 'vsa@1', ownerId: OWNER }

  test('is deterministic and prefixed', () => {
    const k = signalKeyFor(base)
    assert.match(k, /^sig_[0-9a-f]{40}$/)
    assert.equal(k, signalKeyFor({ ...base }))
  })

  test('accepts Date, epoch ms and ISO string ts identically', () => {
    const k = signalKeyFor(base)
    assert.equal(k, signalKeyFor({ ...base, ts: new Date(base.ts) }))
    assert.equal(k, signalKeyFor({ ...base, ts: '2026-01-05T00:00:00.000Z' }))
  })

  test('is owner-scoped', () => {
    const k = signalKeyFor(base)
    assert.notEqual(k, signalKeyFor({ ...base, ownerId: 'owner-bob' }))
    // Absent owner === explicit null (pre-tenancy rows keep their old key).
    assert.equal(signalKeyFor({ ...base, ownerId: undefined }), signalKeyFor({ ...base, ownerId: null }))
  })

  test('changes when identity changes, but not with price', () => {
    const k = signalKeyFor(base)
    assert.notEqual(k, signalKeyFor({ ...base, type: 'BC' }))
    assert.notEqual(k, signalKeyFor({ ...base, tf: '15m' }))
    assert.notEqual(k, signalKeyFor({ ...base, strategyVersion: 'vsa@2' }))
    // price is payload, not identity -> not part of the key inputs at all
    assert.equal(k, signalKeyFor({ ...base, price: 96.5 }))
  })

  test('rejects invalid type or ts', () => {
    assert.throws(() => signalKeyFor({ ...base, type: 'NOPE' }), /invalid type/)
    assert.throws(() => signalKeyFor({ ...base, ts: 'not-a-date' }), /invalid ts/)
  })
})

describe('signalAttribution', () => {
  test('returns a normalized attribution', () => {
    const a = signalAttribution(attribution())
    assert.equal(a.method, 'vsa')
    assert.equal(a.methodVersion, '1')
    assert.deepEqual(a.indicatorRefs, [])
  })

  test('sorts indicator refs and keeps id/version only', () => {
    const a = signalAttribution(attribution({ indicatorRefs: [{ version: '1', id: 'rsi', extra: 'x' }, { id: 'atr', version: '2' }] }))
    assert.deepEqual(a.indicatorRefs, [{ id: 'atr', version: '2' }, { id: 'rsi', version: '1' }])
  })

  test('throws on any missing required field', () => {
    for (const key of ['method', 'methodVersion', 'strategyVersion', 'engineVersion', 'paramsHash']) {
      assert.throws(() => signalAttribution(attribution({ [key]: '' })), /signal attribution missing/)
    }
  })

  test('rejects malformed indicator refs', () => {
    assert.throws(() => normalizeIndicatorRefs('nope'), TypeError)
    assert.throws(() => normalizeIndicatorRefs([{ id: 'rsi' }]), /version/)
    assert.throws(() => normalizeIndicatorRefs([{ version: '1' }]), /id/)
  })
})

describe('signalDoc', () => {
  const input = { symbol: 'XAUUSD', tf: '5m', ts: Date.parse('2026-01-05T00:00:00.000Z'), type: 'ST LONG', price: 96.8, ownerId: OWNER, accountId: 'paper', attribution: attribution(), meta: { bar: 23 } }

  test('builds a normalized, versioned document', () => {
    const d = signalDoc(input)
    assert.equal(d.schemaVersion, SIGNAL_CONTRACT_VERSION)
    assert.equal(d.type, 'ST LONG')
    assert.ok(d.ts instanceof Date)
    assert.equal(d.signalKey, signalKeyFor({ ...input, method: 'vsa', strategyVersion: 'vsa@1' }))
    assert.equal(d.attribution.method, 'vsa')
    assert.deepEqual(d.meta, { bar: 23 })
  })

  test('defaults price/owner/account to null', () => {
    const d = signalDoc({ symbol: 'XAUUSD', tf: '5m', ts: Date.now(), type: 'SV', attribution: attribution() })
    assert.equal(d.price, null)
    assert.equal(d.ownerId, null)
    assert.equal(d.accountId, null)
  })

  test('rejects invalid type, ts and price', () => {
    assert.throws(() => signalDoc({ ...input, type: 'NOPE' }), /invalid type/)
    assert.throws(() => signalDoc({ ...input, ts: 'nope' }), /invalid ts/)
    assert.throws(() => signalDoc({ ...input, price: 'x' }), /invalid price/)
  })
})
