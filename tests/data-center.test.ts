import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLineage,
  datasetIdFor,
  datasetQuality,
  listDatasets,
  listDatasetQuality,
  listLineage,
  listRecordings,
  mapCandleGroups,
  mapFeedGroups,
  qualityCounts,
  summarizeQuality,
  tfToMs,
} from '../server/utils/dataCenter'
import { datasetIdFor as recorderDatasetIdFor } from '../market/recorder.mjs'

// =============================================================================
//  Data Center read model (roadmap §58.9 Slice 4, §23.4). Stays offline: every
//  DB reader is injected, so we prove the PURE transforms (quality, grouping,
//  lineage) and the fail-soft wrappers without a Mongo connection.
// =============================================================================

const HOUR = 3_600_000

function mkDataset(over: Record<string, unknown> = {}) {
  return {
    _id: 'candles:binance-fapi:BTCUSDT:60',
    datasetId: 'candles:binance-fapi:BTCUSDT:60',
    kind: 'candles',
    source: 'binance-fapi',
    symbol: 'BTCUSDT',
    timeframe: '60',
    schemaVersion: 'dataset.v1',
    retentionDays: 90,
    compression: 'none',
    checksum: null,
    startTs: 0,
    endTs: 10 * HOUR - 1,
    count: 10,
    suspect: false,
    lastReconcileAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as any
}

describe('data-center: keys + quality (pure, D12)', () => {
  test('tfToMs mirrors the engine timeframe grid', () => {
    assert.equal(tfToMs('60'), HOUR)
    assert.equal(tfToMs('D'), 86_400_000)
    assert.equal(tfToMs('4'), 240_000)
    assert.equal(tfToMs(null), null)
    assert.equal(tfToMs('nope'), null)
  })

  test('datasetIdFor is byte-identical to market/recorder.mjs', () => {
    for (const [k, s, sym, tf] of [
      ['candles', 'binance-fapi', 'BTCUSDT', '60'],
      ['feed:funding', 'binance-fapi', 'ETHUSDT', null],
    ] as const) {
      assert.equal(datasetIdFor(k, s, sym, tf), recorderDatasetIdFor(k, s, sym, tf))
    }
  })

  test('a contiguous run reports full coverage and no gaps', () => {
    const q = datasetQuality(mkDataset(), { now: 10 * HOUR })
    assert.equal(q.expected, 10)
    assert.equal(q.gaps, 0)
    assert.equal(q.coveragePct, 100)
    assert.equal(q.verdict, 'ok')
  })

  test('missing bars surface as a gap verdict', () => {
    const q = datasetQuality(mkDataset({ count: 8 }), { now: 10 * HOUR })
    assert.equal(q.expected, 10)
    assert.equal(q.gaps, 2)
    assert.equal(q.coveragePct, 80)
    assert.equal(q.verdict, 'gap')
  })

  test('empty / suspect / stale win over the gap verdict in order', () => {
    assert.equal(datasetQuality(mkDataset({ count: 0 }), { now: 10 * HOUR }).verdict, 'empty')
    assert.equal(datasetQuality(mkDataset({ suspect: true }), { now: 10 * HOUR }).verdict, 'suspect')
    const stale = datasetQuality(mkDataset({ endTs: HOUR - 1 }), { now: 10 * 86_400_000 })
    assert.equal(stale.stale, true)
    assert.equal(stale.verdict, 'stale')
  })

  test('a feed row (no timeframe) has no expected/coverage but still ages', () => {
    const q = datasetQuality(
      mkDataset({ kind: 'feed:funding', timeframe: null, count: 500, endTs: HOUR - 1 }),
      { now: 10 * HOUR },
    )
    assert.equal(q.expected, null)
    assert.equal(q.coveragePct, null)
    assert.equal(q.gaps, null)
    assert.equal(q.verdict, 'ok')
  })

  test('summarizeQuality ranks warnings first and qualityCounts counts them', () => {
    const list = summarizeQuality(
      [mkDataset(), mkDataset({ datasetId: 'x', count: 3 }), mkDataset({ datasetId: 'y', suspect: true })],
      { now: 10 * HOUR },
    )
    assert.equal(list[list.length - 1]!.verdict, 'ok', 'clean dataset sinks to the bottom')
    assert.deepEqual(qualityCounts(list), { ok: 1, warn: 2 })
  })
})

describe('data-center: recordings grouping (pure)', () => {
  test('candle aggregation rows map to a stable datasetId', () => {
    const groups = mapCandleGroups([
      { _id: { symbol: 'BTCUSDT', timeframe: '60', source: 'binance-fapi' }, count: 42, startTs: 0, endTs: HOUR },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.plane, 'candles')
    assert.equal(groups[0]!.count, 42)
    assert.equal(groups[0]!.datasetId, 'candles:binance-fapi:BTCUSDT:60')
  })

  test('feed ledger rows map to the feed plane', () => {
    const groups = mapFeedGroups([
      { _id: { kind: 'funding', symbol: 'ETHUSDT' }, count: 7, startTs: 0, endTs: HOUR },
    ])
    assert.equal(groups[0]!.plane, 'feed')
    assert.equal(groups[0]!.kind, 'funding')
    assert.equal(groups[0]!.timeframe, null)
  })
})

describe('data-center: lineage (pure, D1 traceability)', () => {
  const series = (over: Record<string, unknown> = {}) => ({
    id: '0.4.0~BTCUSDT~60~deadbeef',
    engineVersion: '0.4.0',
    paramsHash: 'deadbeef',
    symbol: 'BTCUSDT',
    tf: '60',
    market: 'fapi',
    method: 'vsa',
    preset: null,
    dataHashCount: 2,
    dataHashes: ['a', 'b'],
    gitRev: 'abc',
    lastRunAt: 5,
    summary: { runs: 3 },
    ...over,
  }) as any

  test('links a series to its candle dataset and preserves the data hashes', () => {
    const out = buildLineage([series()], [mkDataset()])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.datasetIds.length, 1)
    assert.equal(out[0]!.datasetIds[0], 'candles:binance-fapi:BTCUSDT:60')
    assert.deepEqual(out[0]!.dataHashes, ['a', 'b'])
    assert.equal(out[0]!.runs, 3)
    assert.equal(out[0]!.datasets[0]!.matchedBy, 'symbol+timeframe')
  })

  test('prefers the dataset whose source matches the run market', () => {
    const out = buildLineage(
      [series()],
      [
        mkDataset({ datasetId: 'candles:binance-spot:BTCUSDT:60', source: 'binance-spot' }),
        mkDataset({ datasetId: 'candles:binance-fapi:BTCUSDT:60', source: 'binance-fapi' }),
      ],
    )
    assert.deepEqual(out[0]!.datasetIds, ['candles:binance-fapi:BTCUSDT:60'])
  })

  test('a series with no matching dataset still reports its identity', () => {
    const out = buildLineage([series({ symbol: 'XRPUSDT' })], [mkDataset()])
    assert.equal(out[0]!.datasetIds.length, 0)
    assert.equal(out[0]!.symbol, 'XRPUSDT')
  })
})

describe('data-center: DB readers are fail-soft', () => {
  test('listDatasets returns the injected rows + mongo status', async () => {
    const res = await listDatasets({}, { loadDatasetRows: async () => ({ rows: [mkDataset()], mongo: 'up' }) })
    assert.equal(res.mongo, 'up')
    assert.equal(res.data.length, 1)
  })

  test('listDatasetQuality derives verdicts from injected rows', async () => {
    const res = await listDatasetQuality({}, { loadDatasetRows: async () => ({ rows: [mkDataset({ count: 0 })], mongo: 'up' }) }, { now: HOUR })
    assert.equal(res.data[0]!.verdict, 'empty')
  })

  test('listRecordings reports mongo down only when BOTH planes are unavailable', async () => {
    const down = await listRecordings({
      aggregateCandleGroups: async () => null,
      aggregateFeedGroups: async () => null,
    })
    assert.equal(down.mongo, 'down')
    assert.deepEqual(down.data, [])

    const partial = await listRecordings({
      aggregateCandleGroups: async () => [],
      aggregateFeedGroups: async () => null,
    })
    assert.equal(partial.mongo, 'up')
  })

  test('listLineage joins injected series with injected datasets', async () => {
    const res = await listLineage({
      loadDatasetRows: async () => ({ rows: [mkDataset()], mongo: 'up' }),
      loadSeries: async () => ({
        series: [{ id: 's1', engineVersion: '0.4.0', paramsHash: 'p', symbol: 'BTCUSDT', tf: '60', market: 'fapi', method: 'vsa', preset: null, dataHashCount: 1, dataHashes: ['a'], gitRev: null, lastRunAt: 9, summary: { runs: 1 } } as any],
        filesMissing: false,
      }),
    })
    assert.equal(res.filesMissing, false)
    assert.equal(res.data[0]!.datasetIds[0], 'candles:binance-fapi:BTCUSDT:60')
  })
})
