import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichPosition, summarizeLive } from '../server/utils/livePositions'
import { MARGIN_DEFAULTS } from '../simulation/margin.mjs'
import type { PositionItem } from '../types/positions'

// =============================================================================
//  LIVE position + account enrichment (roadmap v3 §19/§20) — golden numbers.
//  Every value below must equal what simulation/engine.mjs + margin/liquidation
//  produce for the SAME doc + quote, so the server view can never drift from
//  the execution core (D21/D25). MARGIN_DEFAULTS: initial 20% (=5x), mmr 0.4%.
// =============================================================================

const NOW = 1_700_000_000_000

function item(partial: Partial<PositionItem>): PositionItem {
  return {
    id: 'p1',
    account: 'default',
    source: 'paper',
    externalId: null,
    symbol: 'BTCUSDT',
    dir: 1,
    qty: 2,
    entryPrice: 100,
    entryTime: '2026-10-09T00:00:00.000Z',
    sl: 95,
    tps: [110],
    exitPrice: null,
    exitTime: null,
    status: 'open',
    pnlPct: null,
    pnlAbs: null,
    method: 'vsa',
    signalKey: 'k1',
    tf: '5m',
    exitReason: null,
    fees: 5,
    stampKind: 'declared',
    stampParamsHash: 'h',
    stampEngineVersion: '1.0',
    updatedAt: '2026-10-09T00:00:00.000Z',
    ...partial
  }
}

const LONG = item({})
const SHORT = item({ dir: -1, sl: 105, tps: [90], signalKey: 'k2' })
const QUOTE = { bid: 101, ask: 101.5, last: 101.2, time: NOW }

describe('enrichPosition (v3 §19 per-position live numbers)', () => {
  test('no quote -> every field null, never a guess', async () => {
    const e = await enrichPosition(LONG, null)
    assert.deepEqual(e, { mark: null, unrealized: null, unrealizedPct: null, liqPrice: null, marginUsed: null, leverage: null })
  })

  test('LONG marks at the BID side, nets entry fees', async () => {
    const e = await enrichPosition(LONG, QUOTE)
    assert.equal(e.mark, 101)
    assert.equal(e.unrealized, -3) // (101-100)*2 - 5 fees
    assert.equal(e.unrealizedPct, -1.5) // -3 / 200 notional * 100
  })

  test('LONG isolated liq price sits below entry', async () => {
    const e = await enrichPosition(LONG, QUOTE)
    assert.equal(e.liqPrice, 80.4) // 100 * (1 - (20-0.4)/100)
  })

  test('margin + implied leverage from the 20% initial model', async () => {
    const e = await enrichPosition(LONG, QUOTE)
    assert.equal(e.marginUsed, 40) // 200 notional * 20%
    assert.equal(e.leverage, 5) // 100 / 20
  })

  test('SHORT marks at the ASK and liq sits above entry', async () => {
    const e = await enrichPosition(SHORT, QUOTE)
    assert.equal(e.mark, 101.5)
    assert.equal(e.unrealized, -8) // -(101.5-100)*2 - 5
    assert.equal(e.unrealizedPct, -4)
    assert.equal(e.liqPrice, 119.6) // 100 * (1 + (20-0.4)/100)
  })

  test('closed rows never get live numbers', async () => {
    const e = await enrichPosition(item({ status: 'closed', exitPrice: 102, exitTime: '2026-10-09T01:00:00.000Z' }), QUOTE)
    assert.deepEqual(e, { mark: null, unrealized: null, unrealizedPct: null, liqPrice: null, marginUsed: null, leverage: null })
  })

  test('garbage quote shape is null-safe (no usable bid/ask/last)', async () => {
    const e = await enrichPosition(LONG, { time: NOW })
    assert.equal(e.mark, null)
    assert.equal(e.liqPrice, 80.4) // liq needs no quote
  })
})

describe('summarizeLive (v3 §20 account portrait)', () => {
  test('locked margin + free + utilization with no quotes', async () => {
    const s = await summarizeLive({ base: 10000, items: [LONG], quoteFor: () => null })
    assert.equal(s.equity, 10000)
    assert.equal(s.notional, 200)
    assert.equal(s.marginUsed, 40)
    assert.equal(s.freeMargin, 9960)
    assert.equal(s.utilizationPct, 0.4)
    assert.equal(s.unrealized, 0) // no quote -> not guessed
    assert.equal(s.maintenance, 0.8) // 200 * 0.4%
    assert.equal(s.liquidated, false)
    assert.equal(s.openPositions, 1)
  })

  test('live unrealized nets into the portrait', async () => {
    const s = await summarizeLive({ base: 10000, items: [LONG], quoteFor: (sym) => (sym === 'BTCUSDT' ? QUOTE : null) })
    assert.equal(s.notional, 200)
    assert.equal(s.marginUsed, 40)
    assert.equal(s.unrealized, -3)
  })

  test('multiple open positions aggregate notional and margin', async () => {
    const mid = item({ signalKey: 'k3' })
    const s = await summarizeLive({ base: 10000, items: [LONG, mid], quoteFor: () => null })
    assert.equal(s.notional, 400)
    assert.equal(s.marginUsed, 80)
    assert.equal(s.openPositions, 2)
  })

  test('a legacy doc without usable qty never corrupts totals', async () => {
    const bad = item({ qty: 0 })
    const s = await summarizeLive({ base: 10000, items: [bad] })
    assert.equal(s.notional, null)
    assert.equal(s.marginUsed, 0)
    assert.equal(s.openPositions, 1)
  })

  test('the maintenance floor triggers the cross-style liquidated flag', async () => {
    const s = await summarizeLive({ base: 0, items: [LONG] })
    assert.equal(s.liquidated, true) // equity 0 <= maintenance 0.8
    assert.equal(s.freeMargin, -40)
  })

  test('defaults behave (no items, base 0)', async () => {
    const s = await summarizeLive({ base: 0, items: [] })
    assert.equal(s.notional, null)
    assert.equal(s.marginUsed, 0)
    assert.equal(s.openPositions, 0)
    assert.equal(s.liquidated, true) // 0 <= 0
  })
})