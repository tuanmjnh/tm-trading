import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHALLENGE_MODEL_VERSION,
  CHALLENGE_SIDES,
  challengeLevels,
  challengeScore,
  scoreDecision
} from '../simulation/challenge.mjs'

// =============================================================================
//  Replay CHALLENGE mode (roadmap v3 §22.5, optional).
//  Pure scoring over the replayed position book. One decision maps to the FIRST
//  position opened at-or-after its timestamp; a decision that produced no
//  position is counted 'no_trade' (gate reject or not yet filled) — never a
//  silent skip. Levels for the ticket derive from the CURRENT played bar +
//  explicit user percentages only (D12). This is a simulation/review feature,
//  not financial advice.
// =============================================================================

const pos = (over) => ({
  id: 'p1', orderId: 'o1', account: 'replay', source: 'replay', symbol: 'BTCUSDT',
  tf: '1m', dir: 1, qty: 1, entryPrice: 100, sl: 98, tps: [104], status: 'closed',
  fees: 0.02, orderType: 'market', slippageBps: 2, alertKey: null,
  externalId: 'x', entryTime: 1_700_000_000_000, exitTime: 1_700_000_060_000,
  exitPrice: 104, exitReason: 'data:tp', pnlAbs: 5, pnlPct: 5, lastScanMs: 0,
  ...over
})

describe('challengeLevels (§22.5 protective levels from the played bar)', () => {
  test('LONG derives SL below and TP above the current close', () => {
    const r = challengeLevels('LONG', 100, { slPct: 2, tpPct: 4 })
    assert.deepEqual(r, { ok: true, sl: 98, tp: 104 })
  })
  test('SHORT mirrors the levels (SL above, TP below)', () => {
    const r = challengeLevels('SHORT', 100, { slPct: 2, tpPct: 4 })
    assert.deepEqual(r, { ok: true, sl: 102, tp: 96 })
  })
  test('defaults to 2% / 4% when percentages are absent', () => {
    const r = challengeLevels('LONG', 200, {})
    assert.deepEqual(r, { ok: true, sl: 196, tp: 208 })
  })
  test('rejects unusable levels — nothing invented (D12)', () => {
    assert.equal(challengeLevels('LONG', 100, { slPct: 0 }).ok, false)
    assert.equal(challengeLevels('LONG', 100, { slPct: 101 }).ok, false)
    assert.equal(challengeLevels('LONG', 100, { slPct: 2, tpPct: 1 }).ok, false)
    assert.equal(challengeLevels('LONG', NaN, { slPct: 2, tpPct: 4 }).ok, false)
  })
})

describe('scoreDecision', () => {
  test('a decision before the position entryTime matches and scores by pnlAbs', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, [pos({ pnlAbs: 5 })])
    assert.equal(r.outcome, 'win')
    assert.equal(r.pnlAbs, 5)
  })
  test('loss on a losing position', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'SHORT' }, [pos({ dir: -1, pnlAbs: -3 })])
    assert.equal(r.outcome, 'loss')
  })
  test('an open match is pending — the session is still live', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, [pos({ status: 'open' })])
    assert.equal(r.outcome, 'pending')
  })
  test('no matching position -> no_trade (gate rejected / not yet filled)', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, [])
    assert.equal(r.outcome, 'no_trade')
  })
  test('the LATEST decision maps to the FIRST position opened after it', () => {
    const earlier = scoreDecision({ ts: 1_700_000_100_000, side: 'LONG' }, [
      pos({ entryTime: 1_700_000_000_000, pnlAbs: 5 }) // opened BEFORE the decision
    ])
    assert.equal(earlier.outcome, 'no_trade') // never crediting a pre-existing position
  })
  test('WAIT before a broker position stays pending (a real setup was on the table)', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'WAIT' }, [pos({})])
    assert.equal(r.outcome, 'pending')
  })
  test('WAIT with no subsequent position is a clean wait', () => {
    const r = scoreDecision({ ts: 1_699_999_999_000, side: 'WAIT' }, [])
    assert.equal(r.outcome, 'no_trade')
  })
})

describe('challengeScore aggregate', () => {
  test('tallies wins/losses/waits + net pnl and stamps the model version', () => {
    // One decision maps to the FIRST position opened at-or-after its ts, so
    // timestamps are spaced so each maps to its intended position:
    //   LONG  at ...999   -> first position  (win   +5)
    //   SHORT at ...200   -> second position (loss  -3, opened at ...300)
    //   WAIT  at ...400   -> after both       (clean wait)
    const s = challengeScore([
      { ts: 1_699_999_999_000, side: 'LONG' },
      { ts: 1_700_000_200_000, side: 'SHORT' },
      { ts: 1_700_000_400_000, side: 'WAIT' }
    ], [
      pos({ entryTime: 1_700_000_000_000, pnlAbs: 5 }),
      pos({ entryTime: 1_700_000_300_000, dir: -1, pnlAbs: -3 })
    ])
    assert.equal(s.decisions, 3)
    assert.equal(s.wins, 1)
    assert.equal(s.losses, 1)
    assert.equal(s.wait, 1)
    assert.equal(s.pending, 0)
    assert.equal(s.pnlAbs, 2)
    assert.equal(s.version, CHALLENGE_MODEL_VERSION)
  })
  test('side registry matches the roadmap exactly', () => {
    assert.deepEqual([...CHALLENGE_SIDES], ['LONG', 'SHORT', 'WAIT'])
  })
})