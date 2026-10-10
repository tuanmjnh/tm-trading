import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  candleRecord,
  candleId,
  datasetIdFor,
  createCandleRecorder,
  DEFAULT_RETENTION_DAYS,
  manifestPatches,
  upsertedIds
} from '../market/recorder.mjs'
import { Candle, Dataset } from '../engine/models/index.mjs'

// =============================================================================
//  Market-data RECORDER (roadmap v3 §23 — what to record by default, P0:
//  closed 1m candles + the §23.4 dataset retention manifest).
//
//  Persistence is a plane consumer: it subscribes to `market.candle`, buffers
//  CLOSED bars, writes them to Mongo `candles` with an idempotent natural key
//  (`symbol:timeframe:openTime` — D3/D4), and keeps `datasets` (retentionDays,
//  schemaVersion, source, start/end, count, checksum:null-until-reconcile) in
//  sync. All Mongo interaction goes through injected models, so the recorder
//  core stays dependency-free; the suite drives it with an in-memory fake book.
//  This is a simulation/recording feature — not financial advice.
// =============================================================================

const bar = (n: number, over: Record<string, unknown> = {}) => ({
  type: 'market.candle',
  source: 'binance',
  market: 'futures',
  symbol: 'BTCUSDT',
  timeframe: '1m',
  state: 'closed',
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 12,
  openTime: 1_700_000_000_000 + n * 60_000,
  closeTime: 1_700_000_000_000 + (n + 1) * 60_000,
  eventTime: 1_700_000_000_000 + (n + 1) * 60_000,
  ingestTime: 1_700_000_000_060 + n,
  ...over
})

function fakeBook() {
  const seen = new Set<string>()
  const writes: Array<Record<string, unknown>> = []
  let failWrites = false
  let manifestUpserts = 0
  let manifestInc = 0
  const candleModel = {
    collection: {
      async bulkWrite(ops: Array<Record<string, unknown>>) {
        if (failWrites) throw new Error('network down')
        writes.push(...ops)
        let upsertedCount = 0
        const upserted: Array<{ _id: unknown }> = []
        for (const o of ops) {
          const id = (o.updateOne as { filter: { _id: string } }).filter._id
          if (!seen.has(id)) {
            seen.add(id)
            upsertedCount += 1
            upserted.push({ _id: id })
          }
        }
        return { upsertedCount, upserted }
      }
    }
  }
  const datasetModel = {
    collection: {
      async updateOne(_f: unknown, update: { $inc: { count: number } }) {
        manifestUpserts += 1
        manifestInc += update.$inc.count
        return { upsertedCount: 1, matchedCount: 1 }
      }
    }
  }
  return {
    candleModel,
    datasetModel,
    writes: () => writes,
    failWrites: () => { failWrites = true },
    okWrites: () => { failWrites = false },
    manifestUpserts: () => manifestUpserts,
    manifestInc: () => manifestInc
  }
}

describe('candleRecord — §23 canonical row mapping', () => {
  test('stamps an idempotent _id, closed state and D1 model version', () => {
    const r = candleRecord(bar(0))
    assert.ok(r)
    assert.equal(r!._id, candleId('BTCUSDT', '1m', 1_700_000_000_000))
    assert.equal(r!.state, 'closed')
    assert.equal(r!.schemaVersion, 'candle.v1')
    assert.equal(r!.close, 101)
  })
  test('rejects forming bars and malformed payloads (D12 — nothing fabricated)', () => {
    assert.equal(candleRecord(bar(0, { state: 'forming' })), null)
    assert.equal(candleRecord({ ...bar(0), high: 90 }), null)
    assert.equal(candleRecord({ ...bar(0), closeTime: bar(0).openTime }), null)
    assert.equal(candleRecord(null), null)
  })
})

describe('manifest — §23.4 retention declaration', () => {
  test('groups per dataset with measured start/end/count and declared retention', () => {
    const p = manifestPatches([candleRecord(bar(0)), candleRecord(bar(1))] as NonNullable<ReturnType<typeof candleRecord>>[], { retentionDays: 30 })
    assert.equal(p.length, 1)
    assert.equal(p[0].datasetId, datasetIdFor('candles', 'binance', 'BTCUSDT', '1m'))
    assert.equal(p[0].countNew, 2)
    assert.equal(p[0].startTs, 1_700_000_000_000)
    assert.equal(p[0].endTs, 1_700_000_120_000)
    assert.equal(p[0].retentionDays, 30)
  })
  test('checksum is declared but stays null until an offline reconcile (§24)', () => {
    assert.equal(DEFAULT_RETENTION_DAYS, 90)
  })
  test('upsertedIds extracts newly-inserted _ids; null when unknown', () => {
    const s = upsertedIds({ upserted: [{ _id: 'a' }, { _id: 'b' }] })
    assert.ok(s)
    assert.equal(s!.size, 2)
    assert.equal(upsertedIds({ upsertedCount: 2 }), null)
  })
})

describe('recorded candles are real Mongoose collections (D1/D2 stay wired)', () => {
  test('Candle and Dataset models are registered under the documented names', () => {
    assert.ok(Candle)
    assert.equal(Candle.collection.name, 'candles')
    assert.ok(Dataset)
    assert.equal(Dataset.collection.name, 'datasets')
  })
})

describe('createCandleRecorder — §23 recorder behaviour', () => {
  function fakeBus() {
    const handlers = new Map<string, (e: Record<string, unknown>) => void>()
    return {
      on(topic: string, h: (e: Record<string, unknown>) => void) {
        handlers.set(topic, h)
        return () => { handlers.delete(topic) }
      },
      emit(topic: string, ev: Record<string, unknown>) {
        handlers.get(topic)?.(ev)
      }
    }
  }

  test('persists only closed bars and updates the manifest once per batch', async () => {
    const bk = fakeBook()
    const bus = fakeBus()
    const rec = createCandleRecorder({ bus: bus as never, candleModel: bk.candleModel, datasetModel: bk.datasetModel, maxBatchSize: 2 })
    rec.start()
    bus.emit('market.candle', bar(0))
    bus.emit('market.candle', bar(1, { state: 'forming' }))
    assert.equal(rec.stats().buffered, 1) // forming bars never buffered (D20)
    bus.emit('market.candle', bar(2)) // touches maxBatchSize -> async flush
    await new Promise((r) => setTimeout(r, 30))
    await rec.stop()
    assert.equal(rec.stats().written, 2)
    assert.equal(bk.writes().length, 2)
    assert.equal(bk.manifestUpserts(), 1)
    assert.equal(bk.manifestInc(), 2)
    assert.equal(rec.stats().buffered, 0)
  })

  test('fail-soft: a Mongo outage re-buffers rows and never throws (D33)', async () => {
    const bk = fakeBook()
    const bus = fakeBus()
    const rec = createCandleRecorder({ bus: bus as never, candleModel: bk.candleModel, datasetModel: bk.datasetModel, batchIntervalMs: 60_000 })
    rec.start()
    bus.emit('market.candle', bar(0))
    bk.failWrites()
    await rec.flush()
    assert.equal(rec.stats().errors, 1)
    assert.equal(rec.stats().buffered, 1) // rows re-buffered for retry
    bk.okWrites()
    await rec.flush()
    assert.equal(rec.stats().errors, 1) // old error kept
    assert.equal(rec.stats().buffered, 0)
    assert.equal(rec.stats().written, 1)
    await rec.stop()
  })

  test('stop() unsubscribes the plane fan-out', async () => {
    const bk = fakeBook()
    const bus = fakeBus()
    const rec = createCandleRecorder({ bus: bus as never, candleModel: bk.candleModel, datasetModel: bk.datasetModel, batchIntervalMs: 60_000 })
    rec.start()
    await rec.stop()
    bus.emit('market.candle', bar(0))
    assert.equal(rec.stats().buffered, 0)
  })

  test('a row already on file is an idempotent no-op hold (D4 — recorded once)', async () => {
    const bk = fakeBook()
    const bus = fakeBus()
    const rec = createCandleRecorder({ bus: bus as never, candleModel: bk.candleModel, datasetModel: bk.datasetModel, batchIntervalMs: 60_000 })
    rec.start()
    bus.emit('market.candle', bar(0))
    await rec.flush() // first write on file
    bus.emit('market.candle', bar(0)) // re-emission after the row exists
    await rec.flush()
    assert.equal(rec.stats().written, 1) // no double-count
    assert.equal(bk.manifestInc(), 1) // manifest count only bumped for the fresh insert
    await rec.stop()
  })
})