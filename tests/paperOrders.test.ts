import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPaperOrder,
  transition,
  isActive,
  isTerminal,
  ORDER_STATES,
  ORDER_TYPES
} from '../simulation/order.mjs'

// =============================================================================
//  Paper ORDER state machine (roadmap v3 §17.2 / §26.4) — golden transitions.
//  Mirrors exactly what exec/paper.mjs drives on the LIVE paper path:
//    created --risk_approved--> riskChecked --queue--> pending --fill--> filled
//    pending --partial--> partiallyFilled --fill--> filled
//    pending --cancel--> cancelled | --expire--> expired | created --reject--> rejected
//  The Mongo CAS (cancel only when the alert is still received/working) lives
//  in server/utils/paperOrders.ts and needs a live engine to exercise, so the
//  guarded API surface is covered here at the pure-machine level (D21/D25).
// =============================================================================

function order(over: Record<string, unknown> = {}) {
  return createPaperOrder(
    {
      clientOrderId: 'co_x',
      alertKey: 'ak_x',
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'limit',
      qty: 2,
      price: 100,
      sl: 95,
      tps: [110],
      tf: '5m',
      account: 'default',
      ...over
    },
    { now: 1_000 }
  )
}

describe('order.mjs state machine', () => {
  test('starts created with intent + dedupe anchors intact', () => {
    const o = order()
    assert.equal(o.status, 'created')
    assert.equal(o.qty, 2)
    assert.equal(o.type, 'limit')
    assert.equal(o.clientOrderId, 'co_x')
    assert.equal(o.alertKey, 'ak_x')
    assert.equal(o.tps.length, 1)
    assert.equal(o.filledQty, 0)
    assert.equal(o.fillPrice, null)
  })

  test('queue requires risk approval (ILLEGAL)', () => {
    const r = transition(order(), 'queue', { now: 1100 })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'ILLEGAL')
  })

  test('created -> riskChecked -> pending -> filled (measured fill)', () => {
    const r1 = transition(order(), 'risk_approved', { now: 1100 })
    assert.equal(r1.ok, true)
    assert.equal(r1.order.status, 'riskChecked')
    assert.equal(r1.order.riskCheckedAt, 1100)

    const r2 = transition(r1.order, 'queue', { now: 1200 })
    assert.equal(r2.ok, true)
    assert.equal(r2.order.status, 'pending')
    assert.equal(r2.order.submittedAt, 1200)

    const rf = transition(r2.order, 'fill', {
      now: 1500,
      fill: { price: 101, qty: 2, fee: 0.8, slippageBps: 2 }
    })
    assert.equal(rf.ok, true)
    assert.equal(rf.order.status, 'filled')
    assert.equal(rf.order.filledQty, 2)
    assert.equal(rf.order.fillPrice, 101)
    assert.equal(rf.order.fee, 0.8)
    assert.equal(rf.order.slippageBps, 2)
    assert.equal(rf.order.filledAt, 1500)
  })

  test('pending -> partiallyFilled stays live, then fill completes it', () => {
    const o = transition(transition(order(), 'risk_approved').order, 'queue').order
    const part = transition(o, 'partial', { fill: { price: 100.5, qty: 1.2 } })
    assert.equal(part.ok, true)
    assert.equal(part.order.status, 'partiallyFilled')
    assert.equal(part.order.filledQty, 1.2)
    assert.equal(isActive(part.order.status), true)

    const done = transition(part.order, 'fill', { now: 1600, fill: { price: 101, qty: 0.8, fee: 0.4 } })
    assert.equal(done.ok, true)
    assert.equal(done.order.status, 'filled')
    assert.equal(done.order.filledQty, 2)
    assert.equal(done.order.filledAt, 1600)
  })

  test('pending -> cancel records by + reason + time; then it is terminal', () => {
    const o = transition(transition(order(), 'risk_approved').order, 'queue').order
    const rc = transition(o, 'cancel', { by: 'terminal', reason: 'user', now: 1300 })
    assert.equal(rc.ok, true)
    assert.equal(rc.order.status, 'cancelled')
    assert.equal(rc.order.cancelBy, 'terminal')
    assert.equal(rc.order.cancelReason, 'user')
    assert.equal(rc.order.cancelledAt, 1300)
    assert.equal(isTerminal(rc.order.status), true)
    assert.equal(isActive(rc.order.status), false)
    // Terminal refuses any further move.
    assert.equal(transition(rc.order, 'fill', { fill: { price: 100, qty: 1 } }).code, 'TERMINAL')
  })

  test('pending -> expire stamps expiredAt; created -> reject carries reason', () => {
    const pe = transition(transition(order(), 'risk_approved').order, 'queue').order
    const ex = transition(pe, 'expire', { now: 9999 })
    assert.equal(ex.ok, true)
    assert.equal(ex.order.status, 'expired')
    assert.equal(ex.order.expiredAt, 9999)

    const rj = transition(order(), 'reject', { reason: 'RISK_BUDGET' })
    assert.equal(rj.ok, true)
    assert.equal(rj.order.status, 'rejected')
    assert.equal(rj.order.rejectReason, 'RISK_BUDGET')
    assert.equal(isTerminal(rj.order.status), true)
  })

  test('safety guards: BAD_FILL / ILLEGAL / NO_ORDER', () => {
    const o = transition(transition(order(), 'risk_approved').order, 'queue').order
    assert.equal(transition(o, 'fill', { fill: { price: 101, qty: 0 } }).code, 'BAD_FILL')
    assert.equal(transition(o, 'fill', { fill: { price: 0, qty: 1 } }).code, 'BAD_FILL')
    assert.equal(transition(o, 'flip').code, 'ILLEGAL')
    assert.equal(transition(null, 'fill').code, 'NO_ORDER')
  })

  test('enums: 8 states × 3 order types, ACTIVE = riskChecked/pending/partial', () => {
    assert.deepEqual(ORDER_STATES, [
      'created', 'riskChecked', 'pending', 'partiallyFilled',
      'filled', 'cancelled', 'expired', 'rejected'
    ])
    assert.deepEqual(ORDER_TYPES, ['market', 'limit', 'stop'])
    assert.equal(isActive('riskChecked'), true)
    assert.equal(isActive('pending'), true)
    assert.equal(isActive('partiallyFilled'), true)
    assert.equal(isActive('filled'), false)
    assert.equal(isActive('cancelled'), false)
  })
})