import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFillRecord, FILL_MODEL_VERSION } from '../simulation/fills.mjs'
import { attemptFill, FILL_DEFAULTS } from '../simulation/fill.mjs'
import { toFillItem } from '../server/utils/paperFills'

// =============================================================================
//  Paper FILL ledger (roadmap v3 §18.5/§18.6/§26.5).
//  buildFillRecord is the PURE shape the executor calls (exec/paper.mjs) for
//  every executed fill; toFillItem is the server's read reshape. Golden:
//  measured fields ride through untouched (never re-derived), absent ones stay
//  null (D12), latency = quote age + simulated latency (only ADDS), and the
//  model version stamps the row (D1).
// =============================================================================

const EXEC = {
  fillId: 'fill_ak_1700000000000',
  orderId: 'co_open_1',
  alertKey: 'ak_1',
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'limit',
  qty: 2,
  fillPrice: 101.25,
  fillQty: 2,
  feeRateBps: 1,
  feeAmount: 0.02,
  spreadAbs: 0.5,
  slippageBps: 2,
  latencyMs: 250,
  simLatencyMs: 0,
  signalTime: 1_699_999_999_000,
  decisionTime: 1_700_000_000_000,
  eventTime: 1_700_000_000_000
}

describe('buildFillRecord (pure ledger shape)', () => {
  test('maps a measured execution 1:1 into the ledger doc', () => {
    const d = buildFillRecord(EXEC)
    assert.equal(d.fillId, EXEC.fillId)
    assert.equal(d.orderId, EXEC.orderId)
    assert.equal(d.side, 'SELL')
    assert.equal(d.type, 'limit')
    assert.equal(d.fillPrice, 101.25)
    assert.equal(d.fillQty, 2)
    assert.equal(d.feeRateBps, 1)
    assert.equal(d.feeAmount, 0.02)
    assert.equal(d.spreadAbs, 0.5)
    assert.equal(d.slippageBps, 2)
    assert.equal(d.latencyMs, 250)
    assert.equal(d.simLatencyMs, 0)
    assert.equal(d.eventTime, 1_700_000_000_000)
    assert.equal(d.modelVersion, FILL_MODEL_VERSION)
  })

  test('simulated latency only ADDS to the modeled quote age', () => {
    const d = buildFillRecord({ ...EXEC, latencyMs: 100, simLatencyMs: 50 })
    assert.equal(d.latencyMs, 150)
    assert.equal(d.simLatencyMs, 50)
  })

  test('absent measurements stay null (never fabricated), qty defaults 0', () => {
    const d = buildFillRecord({ fillId: 'f', orderId: 'o', fillPrice: null, feeAmount: null, slippageBps: null, fillQty: null })
    assert.equal(d.fillPrice, null)
    assert.equal(d.feeAmount, null)
    assert.equal(d.slippageBps, null)
    assert.equal(d.latencyMs, 0)
    assert.equal(d.fillQty, 0)
    assert.equal(d.signalTime, null)
  })

  test('guards unknown types/sides at the boundary', () => {
    assert.equal(buildFillRecord({ ...EXEC, type: 'iceberg' }).type, 'market')
    assert.equal(buildFillRecord({ ...EXEC, side: 'BUY' }).side, 'BUY')
    assert.equal(buildFillRecord({ ...EXEC, side: 'hold' }).side, 'BUY')
  })
})

describe('fill model contract (attemptFill now exposes §18.5/§18.6 fields)', () => {
  test('taker role records the taker rate and eventTime', () => {
    const r = attemptFill(
      { type: 'market', side: 'BUY', qty: 2 },
      { bid: 100, ask: 100.5, time: 10_000 },
      FILL_DEFAULTS,
      11_000
    )
    assert.equal(r.status, 'filled')
    assert.equal(r.feeRateBps, FILL_DEFAULTS.takerFeeBps)
    assert.equal(r.eventTime, 11_000)
    assert.equal(r.latencyMs, 1_000)
  })

  test('maker role switches the rate', () => {
    const r = attemptFill(
      { type: 'market', side: 'SELL', qty: 1 },
      { bid: 100, ask: 100.5, time: 10_000 },
      FILL_DEFAULTS,
      11_000,
      { role: 'maker' }
    )
    assert.equal(r.feeRateBps, FILL_DEFAULTS.makerFeeBps)
  })
})

describe('toFillItem (server read reshape)', () => {
  const SRC = {
    _id: '507f1f77bcf86cd799439011',
    fillId: 'fill_1',
    orderId: 'co_1',
    alertKey: 'ak_1',
    accountId: 'default',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'market',
    qty: 2,
    fillPrice: 100.5,
    fillQty: 2,
    feeRateBps: 4,
    feeAmount: 0.08,
    spreadAbs: 0.5,
    slippageBps: 2,
    latencyMs: 100,
    simLatencyMs: 0,
    signalTime: 1_700_000_000_000,
    decisionTime: 1_700_000_001_000,
    eventTime: 1_700_000_001_000,
    simulateOnly: false,
    createdAt: new Date(1_700_000_000_000)
  }

  test('maps the mongo lean doc to the API item', () => {
    const item = toFillItem(SRC)
    assert.equal(item.id, '507f1f77bcf86cd799439011')
    assert.equal(item.fillId, 'fill_1')
    assert.equal(item.symbol, 'BTCUSDT')
    assert.equal(item.fillPrice, 100.5)
    assert.equal(item.feeRateBps, 4)
    assert.equal(item.signalTime, '2023-11-14T22:13:20.000Z')
    assert.equal(item.createdAt, '2023-11-14T22:13:20.000Z')
    assert.equal(item.simulateOnly, false)
  })

  test('gracefully handles missing optional fields', () => {
    const item = toFillItem({ _id: 'a', fillId: 'f', orderId: 'o', symbol: 'X', side: 'SELL' })
    assert.equal(item.qty, null)
    assert.equal(item.spreadAbs, null)
    assert.equal(item.fillQty, 0)
    assert.equal(item.latencyMs, 0)
    assert.equal(item.signalTime, null)
    assert.equal(item.type, 'market')
  })
})