import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { toInAppAlertDoc, RULE_ALERT_SOURCE } from '../services/alertRules.mjs'
import { ruleEventDedupeKey } from '../engine/alertRules.mjs'

// =============================================================================
//  In-app signals (roadmap §61.17 Phase D).
//
//  Alert rules fan out to owner-scoped `alerts` rows the Signals view reads, so
//  a signal is generated in-app without TradingView. `toInAppAlertDoc` is pure:
//  it must stay INERT to the paper executor (action null) and carry the owner.
// =============================================================================

const rule = { _id: 'rule-1', ownerId: 'owner-alice', name: 'BTC breakout' }
const event = { key: 'intel-9', kind: 'news', title: 'ETF inflow', dir: 'pos', score: 0.72, symbol: 'BTCUSDT', tsMs: Date.parse('2026-10-19T12:00:00.000Z') }

describe('toInAppAlertDoc', () => {
  test('is owner-scoped and inert (action null, never an order)', () => {
    const d = toInAppAlertDoc(rule, event)
    assert.equal(d.ownerId, 'owner-alice')
    assert.equal(d.source, RULE_ALERT_SOURCE)
    assert.equal(d.source, 'alert-rule')
    assert.equal(d.action, null)
    assert.equal(d.status, 'received')
  })

  test('maps direction to side and score to conf', () => {
    assert.equal(toInAppAlertDoc(rule, event).side, 'BUY')
    assert.equal(toInAppAlertDoc(rule, { ...event, dir: 'neg' }).side, 'SELL')
    assert.equal(toInAppAlertDoc(rule, { ...event, dir: 'flat' }).side, null)
    assert.equal(toInAppAlertDoc(rule, event).conf, 0.72)
    assert.equal(toInAppAlertDoc(rule, { ...event, score: 'x' }).conf, null)
  })

  test('derives the same dedupe key as the rule engine when none is passed', () => {
    const d = toInAppAlertDoc(rule, event)
    assert.equal(d.alertKey, ruleEventDedupeKey(rule, event))
    assert.equal(toInAppAlertDoc(rule, event, 'fixed').alertKey, 'fixed')
  })

  test('stamps ts from the event and keeps a JSON raw summary', () => {
    const d = toInAppAlertDoc(rule, event)
    assert.equal(d.ts.toISOString(), '2026-10-19T12:00:00.000Z')
    const raw = JSON.parse(d.raw)
    assert.equal(raw.rule, 'BTC breakout')
    assert.equal(raw.kind, 'news')
    assert.equal(raw.title, 'ETF inflow')
  })

  test('defaults to a null owner when the rule has none (global rules)', () => {
    assert.equal(toInAppAlertDoc({}, event).ownerId, null)
  })
})
