import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRADE_CONTEXT_SCHEMA_VERSION,
  tradeContextIdFor,
  tradeContextRecord,
  recordTradeContext,
} from '../exec/tradeContext.mjs'
import { snapshotRecord, snapshotIdFor, SNAPSHOT_KIND } from '../exec/snapshot.mjs'

// =============================================================================
//  §26.6 trade_context — joins position facts + close result + snapshot ids
//  into ONE AI-dataset row. Pure builder, fail-soft persist, honest nulls.
// =============================================================================

const basePosition = () => ({
  _id: 'pos123',
  account: 'paper-main',
  externalId: 'co_tv_ENTRY_BTCUSDT_1_abc',
  signalKey: 'tv:ENTRY:BTCUSDT:1',
  symbol: 'BTCUSDT',
  dir: 1,
  qty: 0.5,
  entryPrice: 60000,
  entryTime: new Date(1_700_000_000_000),
  tf: '15m',
  method: 'vsa',
  stamp: { engineVersion: '0.9.0', paramsHash: 'ph1', kind: 'declared' },
  status: 'closed',
  orderType: 'limit',
  slippage: 2.5,
  fees: 1.2,
})
const baseClose = () => ({
  exitPrice: 61000, exitTime: new Date(1_700_000_600_000), exitReason: 'data:tp',
  pnlAbs: 498.8, pnlPct: 1.66, fees: 2.2,
})

describe('tradeContextRecord (§26.6)', () => {
  test('closed trade -> full row with join ids and honest nulls', () => {
    const doc = tradeContextRecord({ position: basePosition(), close: baseClose(), venue: 'binance:fapi', now: 555 })
    assert.equal(doc._id, 'tc:co_tv_ENTRY_BTCUSDT_1_abc')
    assert.equal(doc.tradeContextId, doc._id)
    assert.equal(doc.accountId, 'paper-main')
    assert.equal(doc.symbol, 'BTCUSDT')
    assert.equal(doc.venue, 'binance:fapi')
    assert.equal(doc.timeframe, '15m')
    assert.equal(doc.direction, 'long')
    assert.equal(doc.method, 'vsa')
    assert.equal(doc.strategyVersionId, null) // honest: no version catalog yet
    assert.equal(doc.entrySnapshotId, snapshotIdFor('tv:ENTRY:BTCUSDT:1'))
    assert.equal(doc.exitSnapshotId, snapshotIdFor('tv:ENTRY:BTCUSDT:1#exit'))
    assert.equal(doc.indicators, null) // producers not built yet — never guessed
    assert.equal(doc.marketRegime, null)
    assert.equal(doc.fundingOi, null)
    assert.equal(doc.newsContext, null)
    assert.equal(doc.execution.entryPrice, 60000)
    assert.equal(doc.execution.exitPrice, 61000)
    assert.equal(doc.execution.exitReason, 'data:tp')
    assert.equal(doc.execution.fees, 2.2)
    assert.equal(doc.execution.holdMs, 600_000)
    assert.equal(doc.outcome.state, 'win')
    assert.equal(doc.outcome.pnlAbs, 498.8)
    assert.equal(doc.recordedAt, 555)
    assert.equal(doc.schemaVersion, TRADE_CONTEXT_SCHEMA_VERSION)
  })

  test('outcome classification + unknown exit price -> null doc', () => {
    const loss = tradeContextRecord({ position: basePosition(), close: { ...baseClose(), pnlAbs: -3 } })
    assert.equal(loss.outcome.state, 'loss')
    const flat = tradeContextRecord({ position: basePosition(), close: { ...baseClose(), pnlAbs: 0 } })
    assert.equal(flat.outcome.state, 'flat')
    const unknown = tradeContextRecord({ position: basePosition(), close: { ...baseClose(), pnlAbs: null } })
    assert.equal(unknown.outcome.state, 'unknown')
    assert.equal(tradeContextRecord({ position: basePosition(), close: { ...baseClose(), exitPrice: undefined } }), null)
    assert.equal(tradeContextRecord({ position: { ...basePosition(), status: 'open' }, close: baseClose() }), null)
  })

  test('no externalId -> _id from position id; no signalKey -> snapshot ids null', () => {
    const manual = { ...basePosition(), externalId: '', signalKey: null, method: null }
    const doc = tradeContextRecord({ position: manual, close: baseClose() })
    assert.equal(doc._id, 'tc:pos:pos123')
    assert.equal(doc.entrySnapshotId, null)
    assert.equal(doc.exitSnapshotId, null)
  })

  test('tradeContextIdFor trims and refuses empty', () => {
    assert.equal(tradeContextIdFor(' abc '), 'tc:abc')
    assert.equal(tradeContextIdFor('  '), null)
    assert.equal(tradeContextIdFor(null), null)
  })

  test('recordTradeContext: $setOnInsert idempotent, fail-soft, null without model', async () => {
    const rows = []
    const model = {
      async updateOne(f, p, opts) {
        const exists = rows.some((r) => r._id === f._id)
        if (!exists)	rows.push({ ...p.$setOnInsert })
        return { upsertedCount: exists ? 0 : 1 }
      },
    }
    const doc = tradeContextRecord({ position: basePosition(), close: baseClose(), now: 1 })
    assert.deepEqual(await recordTradeContext(model, doc), { wrote: true })
    assert.deepEqual(await recordTradeContext(model, doc), { wrote: false }) // replay never rewrites
    assert.equal(rows.length, 1)
    assert.equal(await recordTradeContext(null, doc), null)
    const boom = { async updateOne() { throw new Error('down') } }
    assert.deepEqual(await recordTradeContext(boom, doc), { wrote: false })
    assert.equal(await recordTradeContext(model, null), null)
  })

  test('exit snapshot kind: entry default, exit opt-in, bogus kind falls back', () => {
    const ctx = { alertKey: 'a1', symbol: 'BTCUSDT', venue: 'binance:fapi', clockTime: 123, decision: { ok: true, code: 'X', message: 'm' } }
    assert.equal(snapshotRecord(ctx).kind, SNAPSHOT_KIND.entryDecision)
    assert.equal(snapshotRecord({ ...ctx, kind: SNAPSHOT_KIND.exitDecision }).kind, 'exit-decision')
    assert.equal(snapshotRecord({ ...ctx, kind: 'nonsense' }).kind, 'entry-decision')
  })
})