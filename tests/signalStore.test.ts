import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { Signal, SIGNAL_TYPES } from '../engine/models/signal.mjs'
import { signalDoc } from '../engine/signalContract.mjs'

// =============================================================================
//  Native signal persistence (roadmap §61.17 Phase D — D3).
//
//  The store must be idempotent (writes go through $setOnInsert), the model must
//  carry attribution, and the unique index must be PARTIAL so legacy webhook rows
//  (no signalKey) are never blocked against each other. These are DB-level
//  guarantees; the live round-trip is exercised in engine/test-db.mjs section 10.
// =============================================================================

const STORE_SRC = readFileSync(new URL('../services/signalStore.mjs', import.meta.url), 'utf8')

function indexEntry(fields) {
  return Signal.schema.indexes().find(([f]) => JSON.stringify(f) === JSON.stringify(fields))
}

describe('signal model attribution', () => {
  test('still speaks the same event vocabulary', () => {
    assert.deepEqual([...SIGNAL_TYPES], ['SV', 'BC', 'ST LONG', 'ST SHORT', 'NS', 'ND', 'EoM'])
  })

  test('declares the attribution + identity paths', () => {
    for (const p of ['signalKey', 'schemaVersion', 'accountId', 'attribution', 'method', 'ownerId']) {
      assert.ok(Signal.schema.path(p), `missing schema path: ${p}`)
    }
  })

  test('has a PARTIAL unique index on ownerId+signalKey', () => {
    const entry = indexEntry({ ownerId: 1, signalKey: 1 })
    assert.ok(entry, 'missing ownerId+signalKey index')
    const [, opts] = entry
    assert.equal(opts.unique, true)
    assert.deepEqual(opts.partialFilterExpression, { signalKey: { $type: 'string' } })
  })

  test('makes attribution.strategyVersion queryable', () => {
    assert.ok(indexEntry({ 'attribution.strategyVersion': 1 }), 'missing attribution.strategyVersion index')
  })

  test('accepts a signal document produced by the contract', async () => {
    const doc = signalDoc({
      symbol: 'XAUUSD',
      tf: '5m',
      ts: Date.parse('2026-01-05T00:00:00.000Z'),
      type: 'ST LONG',
      price: 96.8,
      ownerId: 'owner-alice',
      attribution: { method: 'vsa', methodVersion: '1', strategyVersion: 'vsa@1', engineVersion: '0.5.0', paramsHash: 'a'.repeat(64) },
    })
    const d = new Signal(doc)
    await assert.doesNotReject(() => d.validate())
    assert.equal(d.signalKey, doc.signalKey)
    assert.equal(d.attribution.strategyVersion, 'vsa@1')
  })
})

describe('signalStore source contract', () => {
  test('exposes the durable write + read API', () => {
    for (const name of ['publishSignal', 'publishSignals', 'findSignalByKey', 'countSignals', 'findSignalsByAttribution']) {
      assert.match(STORE_SRC, new RegExp(`export async function ${name}\\b`), `missing export: ${name}`)
    }
  })

  test('persists idempotently and fail-soft', () => {
    assert.match(STORE_SRC, /\$setOnInsert/)
    assert.match(STORE_SRC, /upsert: true/)
    assert.match(STORE_SRC, /connectMongo/)
    assert.match(STORE_SRC, /e\?\.code === 11000/) // concurrent duplicate is success, not loss
    assert.match(STORE_SRC, /catch/)
  })
})
