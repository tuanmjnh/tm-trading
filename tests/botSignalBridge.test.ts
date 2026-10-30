import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BOT_ALERT_SOURCE,
  ENTRY_SIGNAL_TYPES,
  accountOf,
  botAlertKey,
  bridgeSignalsForInstance,
  cursorFilter,
  signalSide,
  signalToAlert,
} from '../services/botSignalBridge.mjs'

// =============================================================================
//  Signal -> bot alert bridge (roadmap §61.17 Phase E, E4).
//
//  Offline: these tests never touch Mongo. They pin the mapping and the
//  replay-safe cursor; the durable path (signal row -> alert row -> paper order)
//  is exercised in engine/test-db.mjs section 13.
// =============================================================================

const INSTANCE = {
  instanceId: 'bot_bridge_1',
  ownerId: 'owner-bridge',
  accountId: 'default',
  state: 'running',
  subscriptions: [],
}

const signal = (over = {}) => ({
  signalKey: 'sig_abc',
  ts: new Date('2026-10-20T00:00:00.000Z'),
  symbol: 'BTCUSDT',
  tf: '1h',
  type: 'ST LONG',
  price: 100,
  ownerId: 'owner-bridge',
  accountId: null,
  attribution: { method: 'vsa', strategyVersion: 'vsa@1' },
  meta: { dir: 1, entry: 100, sl: 95, tp: 110 },
  ...over,
})

describe('bot signal bridge — mapping', () => {
  test('only entry events become orders', () => {
    assert.deepEqual([...ENTRY_SIGNAL_TYPES], ['ST LONG', 'ST SHORT'])
    assert.equal(signalSide(signal()), 'BUY')
    assert.equal(signalSide(signal({ type: 'ST SHORT' })), 'SELL')
    for (const type of ['SV', 'BC', 'NS', 'ND', 'EoM']) {
      assert.equal(signalSide(signal({ type })), null)
      assert.equal(signalToAlert({ signal: signal({ type }), instance: INSTANCE }), null)
    }
  })

  test('the alert key is deterministic and namespaced by instance', () => {
    assert.equal(botAlertKey('bot_x', 'sig_1'), 'bot_bot_x_sig_1')
    const a = signalToAlert({ signal: signal(), instance: INSTANCE })
    const b = signalToAlert({ signal: signal(), instance: INSTANCE })
    assert.equal(a.alertKey, b.alertKey)
    assert.equal(a.alertKey, 'bot_bot_bridge_1_sig_abc')
  })

  test('a bot alert carries source, traceability and a market entry intent', () => {
    const a = signalToAlert({ signal: signal(), instance: INSTANCE })
    assert.equal(a.source, BOT_ALERT_SOURCE)
    assert.equal(a.instanceId, 'bot_bridge_1')
    assert.equal(a.signalKey, 'sig_abc')
    assert.equal(a.ownerId, 'owner-bridge')
    assert.equal(a.accountId, 'default')
    assert.equal(a.side, 'BUY')
    assert.equal(a.action, 'ENTRY')
    assert.equal(a.sl, 95)
    assert.deepEqual(a.tps, [110])
    const raw = JSON.parse(a.raw)
    assert.equal(raw.type, 'market')
    assert.equal(raw.signalKey, 'sig_abc')
    assert.equal(raw.signalType, 'ST LONG')
  })

  test('a signal without a positive SL/TP is still routed but with no levels', () => {
    const a = signalToAlert({ signal: signal({ meta: { entry: null, sl: null, tp: 0 } }), instance: INSTANCE })
    assert.equal(a.sl, null)
    assert.deepEqual(a.tps, [])
    assert.equal(a.price, null)
  })

  test('legacy rows (no signalKey) never drive a bot', () => {
    assert.equal(signalToAlert({ signal: signal({ signalKey: null }), instance: INSTANCE }), null)
  })

  test('another owner, another account or a non-running instance is refused', () => {
    assert.equal(signalToAlert({ signal: signal({ ownerId: 'someone-else' }), instance: INSTANCE }), null)
    assert.equal(signalToAlert({ signal: signal({ accountId: 'sub-book-2' }), instance: INSTANCE }), null)
    assert.equal(signalToAlert({ signal: signal(), instance: { ...INSTANCE, state: 'paused' } }), null)
  })

  test('subscriptions narrow the routed symbols when set', () => {
    const scoped = { ...INSTANCE, subscriptions: ['ETHUSDT'] }
    assert.equal(signalToAlert({ signal: signal(), instance: scoped }), null)
    assert.ok(signalToAlert({ signal: signal({ symbol: 'ETHUSDT' }), instance: scoped }))
  })

  test("accountId defaults to the 'default' sub-book sentinel", () => {
    assert.equal(accountOf({}), 'default')
    assert.equal(accountOf({ accountId: '' }), 'default')
    assert.equal(accountOf({ accountId: 'acc-1' }), 'acc-1')
  })
})

describe('bot signal bridge — replay-safe cursor', () => {
  test('a fresh instance reads from the beginning', () => {
    assert.deepEqual(cursorFilter({}), {})
    assert.deepEqual(cursorFilter({ lastSignalTs: 0, lastSignalKey: null }), {})
  })

  test('the cursor is strictly after the watermark, keyed on a tie', () => {
    const f = cursorFilter({ lastSignalTs: 1000, lastSignalKey: 'sig_a' })
    // Three clauses (services/botSignalBridge.mjs): (1) strictly newer ts,
    // (2) same ts but a lexicographically larger key, (3) a larger key at any ts
    // (signalKey ordering is the primary one). Duplicate replays stay safe
    // through the unique alertKey index, not through this filter.
    assert.equal(f.$or.length, 3)
    assert.deepEqual(f.$or[0], { ts: { $gt: new Date(1000) } })
    assert.deepEqual(f.$or[1], { ts: new Date(1000), signalKey: { $gt: 'sig_a' } })
    assert.deepEqual(f.$or[2], { signalKey: { $gt: 'sig_a' } })
    assert.deepEqual(cursorFilter({ lastSignalTs: 1000 }), { ts: { $gt: new Date(1000) } })
  })
})

describe('bot signal bridge — guards without a database', () => {
  test('a missing model or instance fails closed instead of throwing', async () => {
    assert.equal((await bridgeSignalsForInstance({ instance: INSTANCE, models: {} })).code, 'missing_model')
    assert.equal((await bridgeSignalsForInstance({ instance: {}, models: { Signal: {}, Alert: {} } })).code, 'missing_instance')
    const paused = await bridgeSignalsForInstance({ instance: { ...INSTANCE, state: 'paused' }, models: { Signal: {}, Alert: {} } })
    assert.equal(paused.ok, false)
    assert.equal(paused.code, 'not_running')
  })
})
