import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECONCILE_SCHEMA_VERSION,
  DEFAULT_RECONCILE_OPTS,
  compareBars,
  reconcileCandles,
  buildRepairPatches,
} from '../market/reconcile.mjs'
import { runReconcile, venueBarFromRaw, venueForSource } from '../services/reconcile.mjs'

// =============================================================================
//  §24.2 Candle reconciliation — compare recorded closed bars against venue.
//  Pure, offline, honest: tolerances relative, missing rows flagged 'gap',
//  mismatched numbers flagged 'suspect', repairs preserve exact venue numbers.
// =============================================================================

const bar = (ot, o, h, l, c, v) => ({ openTime: ot, open: o, high: h, low: l, close: c, volume: v })

describe('compareBars (§24.2)', () => {
  test('identical bars pass', () => {
    const b = bar(1000, 100, 105, 95, 102, 50)
    const res = compareBars(b, b)
    assert.equal(res.ok, true)
    assert.deepEqual(res.diffs, {})
  })

  test('differences within tolerance pass', () => {
    const local = bar(1000, 100, 105, 95, 102, 50)
    // 0.02% price diff (under 0.05% default)
    const venue = bar(1000, 100.02, 105, 95, 102, 50.4) // volume 0.8% diff (under 1%)
    const res = compareBars(local, venue)
    assert.equal(res.ok, true)
  })

  test('differences exceeding tolerance are named in diffs', () => {
    const local = bar(1000, 100, 105, 95, 102, 50)
    const venue = bar(1000, 101, 105, 95, 102, 60) // open 1% diff, volume 20% diff
    const res = compareBars(local, venue)
    assert.equal(res.ok, false)
    assert.ok(res.diffs.open)
    assert.ok(res.diffs.volume)
    assert.equal(res.diffs.high, undefined)
  })

  test('missing/null numbers flag in diffs', () => {
    const res = compareBars(bar(1000, null, 105, 95, 102, 50), bar(1000, 100, 105, 95, 102, 50))
    assert.equal(res.ok, false)
    assert.ok(res.diffs.open)
    assert.equal(res.diffs.open.diffPct, null)
  })
})

describe('reconcileCandles (§24.2)', () => {
  test('empty inputs -> unknown verdict', () => {
    assert.equal(reconcileCandles({}).verdict, 'unknown')
  })

  test('all matched -> ok verdict', () => {
    const b1 = bar(1000, 100, 105, 95, 102, 50)
    const b2 = bar(2000, 102, 108, 101, 107, 60)
    const res = reconcileCandles({ localBars: [b1, b2], venueBars: [b1, b2] })
    assert.equal(res.checked, 2)
    assert.equal(res.matched, 2)
    assert.equal(res.mismatches.length, 0)
    assert.equal(res.missingLocal.length, 0)
    assert.equal(res.verdict, 'ok')
    assert.equal(res.schemaVersion, RECONCILE_SCHEMA_VERSION)
  })

  test('missing locally flags gap', () => {
    const b1 = bar(1000, 100, 105, 95, 102, 50)
    const b2 = bar(2000, 102, 108, 101, 107, 60)
    const res = reconcileCandles({ localBars: [b1], venueBars: [b1, b2] })
    assert.equal(res.checked, 2)
    assert.equal(res.matched, 1)
    assert.equal(res.missingLocal.length, 1)
    assert.equal(res.missingLocal[0].openTime, 2000)
    assert.equal(res.verdict, 'gap')
  })

  test('mismatch flags suspect (takes precedence over gap)', () => {
    const b1 = bar(1000, 100, 105, 95, 102, 50)
    const b1Bad = bar(1000, 110, 105, 95, 102, 50) // local has bad open
    const b2 = bar(2000, 102, 108, 101, 107, 60)
    const res = reconcileCandles({ localBars: [b1Bad], venueBars: [b1, b2] })
    assert.equal(res.mismatches.length, 1)
    assert.equal(res.missingLocal.length, 1)
    assert.equal(res.verdict, 'suspect')
  })
})

describe('buildRepairPatches (§24.2)', () => {
  test('generates $set for mismatches and $setOnInsert for missing bars', () => {
    const meta = { symbol: 'BTCUSDT', timeframe: '1m', source: 'binance:fapi' }
    const mismatches = [{ openTime: 1000, venue: bar(1000, 100, 105, 95, 102, 50) }]
    const missingLocal = [bar(2000, 102, 108, 101, 107, 60)]
    const patches = buildRepairPatches({ mismatches, missingLocal }, meta)
    assert.equal(patches.length, 2)

    // patch 1: repair existing mismatched bar
    assert.equal(patches[0].filter._id, 'BTCUSDT:1m:1000')
    assert.equal(patches[0].upsert, false)
    assert.equal(patches[0].update.$set.open, 100)
    assert.ok(patches[0].update.$set.repairedAt instanceof Date)

    // patch 2: insert missing bar from venue
    assert.equal(patches[1].filter._id, 'BTCUSDT:1m:2000')
    assert.equal(patches[1].upsert, true)
    assert.equal(patches[1].update.$setOnInsert.symbol, 'BTCUSDT')
    assert.equal(patches[1].update.$setOnInsert.state, 'closed')
    assert.equal(patches[1].update.$setOnInsert.open, 102)
  })
})

// =============================================================================
//  §24.2 service orchestrator: manifest flagged from the MEASURED verdict,
//  honest skips (unknown interval/source -> never compared), repair only when
//  asked. In-memory fakes, same shapes as the other suites (no Mongo).
// =============================================================================

const OPS = { $lt: (a, b) => a < b, $gt: (a, b) => a > b, $lte: (a, b) => a <= b, $gte: (a, b) => a >= b }
const matcher = (f, doc) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).every(([op, val]) => (OPS[op] ? OPS[op](doc[k], val) : true))
  }
  return doc[k] === v
})
const query = (rows) => ({
  sort: () => query(rows),
  limit: (n) => query(rows.slice(0, n)),
  lean: async () => rows.map((r) => ({ ...r })),
})
const applyPatch = (doc, patch) => {
  if (patch.$set) Object.assign(doc, patch.$set)
  if (patch.$setOnInsert) for (const [k, v] of Object.entries(patch.$setOnInsert)) if (!(k in doc)) doc[k] = v
  if (patch.$inc) for (const [k, v] of Object.entries(patch.$inc)) doc[k] = (Number(doc[k]) || 0) + v
  return doc
}

// raw Binance kline row: [openTime, o, h, l, c, volume, closeTime, ...]
const raw = (ot, o, h, l, c, v) => [ot, String(o), String(h), String(l), String(c), String(v), ot + 59_999, '0', 0, '0']

describe('runReconcile service (§24.2)', () => {
  const setup = (candleRows, datasetRows) => {
    const Candle = {
      rows: candleRows,
      find(f) { return query(this.rows.filter((c) => matcher(f, c))) },
      async updateOne(f, patch, opts) {
        let d = this.rows.find((c) => matcher(f, c))
        if (!d) { if (!opts?.upsert) return { matchedCount: 0 }; d = { ...patch.$setOnInsert }; this.rows.push(d) }
        else applyPatch(d, patch)
        return { matchedCount: 1 }
      },
    }
    const Dataset = {
      rows: datasetRows,
      find(f) { return query(this.rows.filter((d) => matcher(f, d))) },
      async updateOne(f, patch) {
        const d = this.rows.find((r) => matcher(f, r))
        if (d) applyPatch(d, patch)
        return { matchedCount: d ? 1 : 0 }
      },
    }
    return { models: { Candle, Dataset }, Candle, Dataset }
  }
  const manifest = (ds, datasetId) => ds.rows.find((d) => d.datasetId === datasetId)
  const datasetRow = (over = {}) => ({
    datasetId: 'candles:binance:BTCUSDT:1m', kind: 'candles', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', count: 2, ...over,
  })

  test('venue matches local -> verdict ok, manifest stamped, suspect false', async () => {
    const { models, Dataset } = setup(
      [{ _id: 'BTCUSDT:1m:1000', symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 50 }],
      [datasetRow()],
    )
    const s = await runReconcile({ models, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)], now: 10 })
    assert.equal(s.checked, 1)
    assert.equal(s.ok, 1)
    assert.equal(s.suspect, 0)
    assert.equal(s.errors, 0)
    const rc = manifest(Dataset, 'candles:binance:BTCUSDT:1m').lastReconcile
    assert.equal(rc.verdict, 'ok')
    assert.equal(rc.checked, 1)
    assert.equal(rc.matched, 1)
    assert.equal(manifest(Dataset, 'candles:binance:BTCUSDT:1m').suspect, false)
  })

  test('venue disagrees -> suspect flag on manifest (invalidate-by-flag)', async () => {
    const { models, Dataset } = setup(
      [{ _id: 'BTCUSDT:1m:1000', symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 111, high: 105, low: 95, close: 102, volume: 50 }],
      [datasetRow()],
    )
    const s = await runReconcile({ models, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)] })
    assert.equal(s.suspect, 1)
    assert.equal(manifest(Dataset, 'candles:binance:BTCUSDT:1m').suspect, true)
  })

  test('suspect/gap verdict fires the injected notify once per dataset (no notify without injection)', async () => {
    const calls = []
    const notifySpy = async (event) => { calls.push(event); return { delivered: [] } }
    const { models } = setup(
      [{ _id: 'BTCUSDT:1m:1000', symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 111, high: 105, low: 95, close: 102, volume: 50 }],
      [datasetRow()],
    )
    await runReconcile({ models, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)], notifyFn: notifySpy })
    await new Promise((r) => setImmediate(r)) // fire-and-forget settle
    assert.equal(calls.length, 1)
    assert.equal(calls[0].kind, 'market')
    assert.equal(calls[0].name, 'candles.suspect')
    assert.match(calls[0].dedupeKey, /^candles\.suspect:/)

    // ok verdict -> no notify at all
    const ok = { rows: [{ _id: 'x', symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 50 }] }
    const modelsOk = { Candle: ok, Dataset: { find: (f) => query([{ datasetId: 'd', kind: 'candles', source: 'binance', symbol: 'BTCUSDT', timeframe: '1m' }]), async updateOne() { return {} } } }
    const calls2 = []
    await runReconcile({ models: modelsOk, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)], notifyFn: async (e) => { calls2.push(e); return null } })
    await new Promise((r) => setImmediate(r))
    assert.equal(calls2.length, 0)
  })

  test('no repair writes without repair=true; repair=true fixes local from venue', async () => {
    const local = [{ _id: 'BTCUSDT:1m:1000', symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 111, high: 105, low: 95, close: 102, volume: 50 }]
    const { models, Candle } = setup(local, [datasetRow()])
    await runReconcile({ models, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)] })
    assert.equal(Candle.rows[0].open, 111) // untouched without repair

    const { models: m2, Candle: C2 } = setup(local.map((r) => ({ ...r })), [datasetRow()])
    const s2 = await runReconcile({ models: m2, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)], repair: true })
    assert.equal(C2.rows[0].open, 100) // repaired FROM venue (D12 truth source)
    assert.ok(C2.rows[0].repairedAt)
    assert.equal(s2.repaired, 1)
  })

  test('gap: bar present on venue but missing locally -> gap + suspect, no repair', async () => {
    const { models, Dataset } = setup([], [datasetRow()])
    const s = await runReconcile({ models, klineFetcher: async () => [raw(1000, 100, 105, 95, 102, 50)] })
    assert.equal(s.gap, 1)
    assert.equal(manifest(Dataset, 'candles:binance:BTCUSDT:1m').suspect, true)
  })

  test('honest skips: 4m interval and non-binance source are never compared', async () => {
    const { models, Dataset } = setup([], [
      datasetRow({ datasetId: 'candles:binance:BTCUSDT:4m', timeframe: '4m' }),
      datasetRow({ datasetId: 'candles:bybit:BTCUSDT:1m', source: 'bybit', timeframe: '1m' }),
    ])
    let fetched = 0
    const s = await runReconcile({ models, klineFetcher: async () => { fetched++; return [] } })
    assert.equal(s.skipped, 2)
    assert.equal(s.checked, 0)
    assert.equal(fetched, 0)
    assert.equal(Dataset.rows[0].lastReconcileAt, undefined)
    assert.equal(Dataset.rows[1].lastReconcileAt, undefined)
  })

  test('empty venue response -> honest skip (never an "ok" by absence)', async () => {
    const { models } = setup([], [datasetRow()])
    const s = await runReconcile({ models, klineFetcher: async () => [] })
    assert.equal(s.skipped, 1)
    assert.equal(s.ok, 0)
  })

  test('venue fetcher error -> errors++ and sweep continues with the next dataset', async () => {
    const { models } = setup([], [
      datasetRow({ datasetId: 'a', symbol: 'BTCUSDT' }),
      datasetRow({ datasetId: 'b', symbol: 'ETHUSDT' }),
    ])
    let n = 0
    const s = await runReconcile({
      models,
      klineFetcher: async ({ symbol }) => { n++; if (n === 1) throw new Error('HTTP 500'); return [raw(1000, 1, 1, 1, 1, 1)] },
      log: { warn: () => {} },
    })
    assert.equal(s.errors, 1)
    assert.equal(s.checked, 1) // ETH still compared
  })

  test('missing models -> skipped, never throws', async () => {
    assert.deepEqual(await runReconcile({ models: {} }), { datasets: 0, checked: 0, ok: 0, suspect: 0, gap: 0, skipped: 1, errors: 0, repaired: 0 })
  })

  test('venueForSource + venueBarFromRaw honest mapping', () => {
    assert.equal(venueForSource('binance').id, 'binance:fapi')
    assert.equal(venueForSource('binance:fapi').id, 'binance:fapi')
    assert.equal(venueForSource('https://fapi.binance.com').id, 'binance:fapi')
    assert.equal(venueForSource('bybit'), null) // no venue fetcher yet -> skip
    assert.deepEqual(venueBarFromRaw(raw(1000, 100, 105, 95, 102, 50)), { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 50, closeTime: 60_999 })
    assert.equal(venueBarFromRaw(['a', 'b']), null) // short/malformed row -> null
  })
})