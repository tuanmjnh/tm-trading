import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTicketAlert, validateTicket, ORDER_TYPES } from '../server/utils/orders'
import { alertKey } from '../engine/keys.mjs'

const BUY = { symbol: 'BTCUSDT', side: 'BUY', price: 100, sl: 95, tps: [105, 110], tf: '1m' }
const SELL = { symbol: 'BTCUSDT', side: 'SELL', price: 100, sl: 105, tps: [95, 90], tf: '1m' }

describe('ticket validation (mirrors webhook rules)', () => {
  test('accepts a correct BUY and SELL ladder', () => {
    assert.equal(validateTicket(BUY).ok, true)
    assert.equal(validateTicket(SELL).ok, true)
    assert.equal(validateTicket({ ...BUY, conf: 0.72 }).ok, true)
  })

  test('rejects non-object payloads', () => {
    assert.equal(validateTicket(null).ok, false)
    assert.equal(validateTicket('x').ok, false)
    assert.equal(validateTicket([1]).ok, false)
  })

  test('requires symbol, valid side and string tf', () => {
    assert.equal(validateTicket({ ...BUY, symbol: '' }).ok, false)
    assert.equal(validateTicket({ ...BUY, side: 'hold' }).ok, false)
    assert.equal(validateTicket({ ...BUY, tf: 5 }).ok, false)
  })

  test('requires finite positive price', () => {
    assert.equal(validateTicket({ ...BUY, price: 0 }).ok, false)
    assert.equal(validateTicket({ ...BUY, price: -1 }).ok, false)
    assert.equal(validateTicket({ ...BUY, price: '100' }).ok, false)
    assert.equal(validateTicket({ ...BUY, price: Number.NaN }).ok, false)
  })

  test('SL must sit on the correct side of the entry', () => {
    assert.equal(validateTicket({ ...BUY, sl: 100 }).ok, false)
    assert.equal(validateTicket({ ...BUY, sl: 101 }).ok, false)
    assert.equal(validateTicket({ ...SELL, sl: 100 }).ok, false)
    assert.equal(validateTicket({ ...SELL, sl: 99 }).ok, false)
  })

  test('TPs must target beyond the entry', () => {
    assert.equal(validateTicket({ ...BUY, tps: [100] }).ok, false)
    assert.equal(validateTicket({ ...BUY, tps: [99] }).ok, false)
    assert.equal(validateTicket({ ...SELL, tps: [101] }).ok, false)
    assert.equal(validateTicket({ ...BUY, tps: [105, 0] }).ok, false)
    assert.equal(validateTicket({ ...BUY, tps: [] }).ok, false)
  })

  test('rejects invalid conf', () => {
    assert.equal(validateTicket({ ...BUY, conf: 'high' }).ok, false)
  })

  // v3 §16.1: qty XOR riskPct sizing intent rides the raw payload — shape is
  // validated here, the risk gate still sizes/verifies (D7), never trusted
  // downstream. Absent = the gate sizes from config/kelly (D7a).
  test('accepts qty or riskPct sizing intents', () => {
    assert.equal(validateTicket({ ...BUY, qty: 0.42 }).ok, true)
    assert.equal(validateTicket({ ...BUY, riskPct: 2 }).ok, true)
    assert.equal(validateTicket({ ...BUY, qty: 0.42, riskPct: 2 }).ok, false) // XOR
  })

  test('qty must be a finite positive number', () => {
    assert.equal(validateTicket({ ...BUY, qty: 0 }).ok, false)
    assert.equal(validateTicket({ ...BUY, qty: -1 }).ok, false)
    assert.equal(validateTicket({ ...BUY, qty: '5' }).ok, false)
    assert.equal(validateTicket({ ...BUY, qty: Number.NaN }).ok, false)
    assert.equal(validateTicket({ ...BUY, qty: null }).ok, true) // absent intent
  })

  test('riskPct must be in (0, 100]', () => {
    assert.equal(validateTicket({ ...BUY, riskPct: 0 }).ok, false)
    assert.equal(validateTicket({ ...BUY, riskPct: -2 }).ok, false)
    assert.equal(validateTicket({ ...BUY, riskPct: 101 }).ok, false)
    assert.equal(validateTicket({ ...BUY, riskPct: '2' }).ok, false)
    assert.equal(validateTicket({ ...BUY, riskPct: 100 }).ok, true)
    assert.equal(validateTicket({ ...BUY, riskPct: null }).ok, true) // absent intent
  })

  // Phase 7P: order types ride the ticket into the paper fill model.
  test('accepts every modelled order type', () => {
    assert.deepEqual([...ORDER_TYPES], ['market', 'limit', 'stop'])
    for (const type of ORDER_TYPES) {
      assert.equal(validateTicket({ ...BUY, type }).ok, true, `type=${type}`)
    }
  })

  test('absent or null type keeps the legacy limit-at-signal default', () => {
    assert.equal(validateTicket(BUY).ok, true)
    assert.equal(validateTicket({ ...BUY, type: null }).ok, true)
    assert.equal(validateTicket({ ...BUY, type: undefined }).ok, true)
  })

  test('rejects unknown order types (fail closed at the door)', () => {
    assert.equal(validateTicket({ ...BUY, type: 'trailing' }).ok, false)
    assert.equal(validateTicket({ ...BUY, type: 'MARKET' }).ok, false) // case matters
    assert.equal(validateTicket({ ...BUY, type: 123 }).ok, false)
    assert.equal(validateTicket({ ...BUY, type: ['market'] }).ok, false)
    assert.equal(validateTicket({ ...BUY, type: ' market' }).ok, false) // no trimming
  })
})

describe('buildTicketAlert (document shape)', () => {
  const ts = new Date('2026-10-07T03:00:00.000Z')

  test('produces a received manual ENTRY alert', () => {
    const doc = buildTicketAlert(BUY, ts)
    assert.equal(doc.source, 'manual')
    assert.equal(doc.action, 'ENTRY')
    assert.equal(doc.status, 'received')
    assert.equal(doc.mode, 'ticket')
    assert.equal(doc.v, 1)
    assert.equal(doc.ts, ts)
    assert.equal(doc.symbol, 'BTCUSDT')
    assert.deepEqual(doc.tps, [105, 110])
    assert.equal(doc.conf, null)
    assert.equal(doc.level, null)
    assert.equal(doc.atr, null)
    assert.ok(JSON.parse(doc.raw).side === 'BUY')
  })

  test('keeps a supplied conf and trims the symbol', () => {
    const doc = buildTicketAlert({ ...BUY, symbol: '  ETHUSDT ', conf: 0.5 }, ts)
    assert.equal(doc.symbol, 'ETHUSDT')
    assert.equal(doc.conf, 0.5)
  })

  test('raw carries the order type to the paper pipeline (orderTypeOf reads it)', () => {
    const doc = buildTicketAlert({ ...BUY, type: 'market' }, ts)
    assert.equal(JSON.parse(doc.raw).type, 'market')
    const legacy = buildTicketAlert(BUY, ts)
    assert.equal(JSON.parse(legacy.raw).type, undefined)
  })
})

describe('alertKey idempotency (D3)', () => {
  const ts = new Date('2026-10-07T03:00:00.000Z')

  test('same payload + ts -> same key; any field change -> new key', () => {
    const a = buildTicketAlert(BUY, ts)
    const b = buildTicketAlert(BUY, ts)
    const ka = alertKey(a, 'manual')
    assert.equal(ka, alertKey(b, 'manual'))
    assert.ok(ka.startsWith('a1_'))

    assert.notEqual(ka, alertKey(buildTicketAlert(SELL, ts), 'manual'))
    assert.notEqual(ka, alertKey(buildTicketAlert(BUY, new Date(ts.getTime() + 1000)), 'manual'))
    assert.notEqual(ka, alertKey({ ...a, price: 101 }, 'manual'))
    // source is part of the canon — manual never collides with a TV retry
    assert.notEqual(ka, alertKey(a, 'tradingview'))
  })
})
