import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { accountProjection, utcDay, ACCOUNT_MODEL_VERSION } from '../simulation/account.mjs'

// =============================================================================
//  Persistent PAPER ACCOUNT (roadmap v3 §20).
//  accountProjection is the PURE view the server serves (server/utils/paper
//  account.ts): every number is DERIVED from persisted positions — the account
//  survives refresh / reconnect / backend restart without rewriting history.
//  Realized/drawdown are exact from measured pnlAbs; unrealized is null when no
//  quote exists (D12). mode/currency/modelVersion stamp the doc (D1).
// =============================================================================

const NOW = Date.parse('2026-10-09T15:00:00.000Z')

const pos = (over) => ({
  dir: 1, qty: 2, entryPrice: 100, entryTime: new Date('2026-10-08T10:00:00.000Z'),
  status: 'open', fees: 5, sl: 95, tps: [110], symbol: 'BTCUSDT', ...over
})

describe('accountProjection (§20 realized roller)', () => {
  test('balance = seed + realized measured pnlAbs; dailyPnl groups by UTC day', () => {
    const a = accountProjection({
      base: 10_000, accountId: 'default', now: NOW,
      positions: [
        { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T11:00:00.000Z'), pnlAbs: 18 }) },
        { ...pos({ status: 'closed', exitTime: new Date('2026-10-08T09:00:00.000Z'), pnlAbs: -30 }) }
      ]
    })
    assert.equal(a.initialBalance, 10_000)
    assert.equal(a.balance, 9_988)
    assert.equal(a.realizedPnl, -12)
    assert.equal(a.dailyPnl, 18)
    assert.equal(a.lastActivityDay, '2026-10-09')
    assert.equal(a.currency, 'USDT')
    assert.equal(a.mode, 'LIVE_PAPER')
    assert.equal(a.modelVersion, ACCOUNT_MODEL_VERSION)
  })

  test('maxDrawdown tracks peak-to-trough of the REALIZED curve (basis explicit)', () => {
    const a = accountProjection({
      base: 10_000, now: NOW,
      positions: [
        { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T10:00:00.000Z'), pnlAbs: 10 }) },
        { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T12:00:00.000Z'), pnlAbs: -40 }) }
      ]
    })
    assert.equal(a.balance, 9_970)
    assert.equal(a.maxDrawdown, 40)
    assert.equal(a.maxDrawdownPct, 0.3996) // 40 / peak 10010
    assert.equal(a.drawdownBasis, 'realized')
    assert.equal(a.dailyPnl, -30)
  })

  test('no closes yet: realized null, drawdown 0, unrealized null with nothing open', () => {
    const a = accountProjection({ base: 5_000, now: NOW, positions: [] })
    assert.equal(a.balance, 5_000)
    assert.equal(a.realizedPnl, null)
    assert.equal(a.maxDrawdown, 0)
    assert.equal(a.unrealized, null)
    assert.equal(a.openPositions, 0)
    assert.equal(a.notional, null)
  })
})

describe('accountProjection (§20 open book + quotes)', () => {
  test('open position is marked through the SAME fill model (net of fees)', () => {
    const a = accountProjection({
      base: 10_000, now: NOW,
      positions: [{ ...pos({}) }],
      quoteFor: () => ({ bid: 101, ask: 101.5, last: 101.2, time: NOW })
    })
    assert.equal(a.openPositions, 1)
    assert.equal(a.notional, 200)          // qty 2 @ 100
    assert.equal(a.marginUsed, 40)         // 20% initial
    assert.equal(a.unrealized, -3)         // (101-100)*2 - fees 5
    assert.equal(a.equity, a.balance + a.unrealized)
    assert.equal(a.maxDrawdown, 0)
    assert.ok(a.availableBalance <= a.balance)
  })

  test('no quote for the open position -> unrealized stays null (honest, D12)', () => {
    const a = accountProjection({ base: 10_000, now: NOW, positions: [{ ...pos({}) }] })
    assert.equal(a.unrealized, null)
    assert.equal(a.equity, a.balance)
  })

  test('utcDay is a D2 UTC day string, never local', () => {
    assert.equal(utcDay(Date.parse('2026-10-09T23:30:00.000Z')), '2026-10-09')
    assert.equal(utcDay(Date.parse('2026-10-10T00:30:00.000Z')), '2026-10-10')
  })
})