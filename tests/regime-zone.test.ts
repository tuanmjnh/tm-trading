import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { loadIntelData, toRegime, toZone } from '#server/utils/intel'

// =============================================================================
//  Regime & liquidation zones — server layer (roadmap Phase 9).
//  Logic services (parse/eval/sweep/estimate/cluster) da co
//  services/test.mjs section 6-7 (53 checks); o day test PHIA SERVER
//  doc snapshot regime/zone nhu the nao.
// =============================================================================

describe('loadIntelData (Phase 9 — regime/zones)', () => {
  test('co regime + zones field, mongo up|down, khong bo cai nao thieu', async () => {
    const d = await loadIntelData()
    assert.ok(d.mongo === 'up' || d.mongo === 'down')
    assert.ok(d.regime === null || typeof d.regime === 'object')
    assert.ok(Array.isArray(d.zones))
    // Mongo up sau services:once (services 9 chay that) -> phai doc duoc snapshot.
    if (d.mongo === 'up' && d.regime) {
      assert.ok(['alt', 'btc', 'neutral'].includes(d.regime.season))
      assert.equal(typeof d.regime.ts, 'string')
      assert.ok(d.regime.ts.length > 0)
      assert.ok(Array.isArray(d.regime.flags))
      assert.ok(Array.isArray(d.regime.sweep))
      assert.equal(typeof d.regime.sources, 'object')
    }
    if (d.mongo === 'up' && d.zones.length) {
      const z = d.zones[0]
      assert.equal(typeof z.symbol, 'string')
      assert.ok(z.symbol.length > 0)
      assert.ok(typeof z.markPx === 'number' && z.markPx > 0)
      assert.ok(Array.isArray(z.est))
      assert.ok(Array.isArray(z.actual))
    }
  })
})

describe('toRegime — doc an toan, khong NaN len UI', () => {
  test('day du data -> giu nguyen gia tri', () => {
    const r = toRegime({
      kind: 'regime',
      key: 'regime:current',
      ts: '2026-10-04T10:00:00.000Z',
      data: {
        season: 'alt',
        asi: { d30: 78, d90: 81, d365: 55 },
        fng: { value: 76, classification: 'Greed', avg30: 61 },
        btcDom: 54.2,
        ethDom: 15.1,
        mcapChg24h: 2.5,
        flags: ['greed-extreme', 'unlock-48h'],
        unlocks48h: [{ symbol: 'ARB', date: '2026-10-05T00:00:00.000Z', label: 'Team' }],
        supplyDrift: [{ symbol: 'XYZ', circulating: 1e9, driftPctPerDay: 1.5 }],
        sweep: [{ symbol: 'SOLUSDT', ok: true, reasons: ['altseason'], blockers: [], rate: 0.0001, oiTrendPct: 5.2 }],
        sources: { asi: 'ok', fng: 'fail' },
      },
    })
    assert.equal(r.season, 'alt')
    assert.deepEqual(r.asi, { d30: 78, d90: 81, d365: 55 })
    assert.equal(r.fng?.value, 76)
    assert.equal(r.btcDom, 54.2)
    assert.deepEqual(r.flags, ['greed-extreme', 'unlock-48h'])
    assert.equal(r.unlocks48h[0].symbol, 'ARB')
    assert.equal(r.supplyDrift[0].driftPctPerDay, 1.5)
    assert.equal(r.sweep[0].ok, true)
    assert.equal(r.sweep[0].rate, 0.0001)
    assert.equal(r.sources.fng, 'fail')
    assert.equal(r.ts, '2026-10-04T10:00:00.000Z')
  })

  test('thieu/truong hong -> mac dinh, khong NaN', () => {
    const empty = toRegime({ ts: '2026-10-04T10:00:00.000Z' })
    assert.equal(empty.season, 'neutral')
    assert.equal(empty.asi, null)
    assert.equal(empty.fng, null)
    assert.equal(empty.btcDom, null)
    assert.deepEqual(empty.flags, [])
    assert.deepEqual(empty.sweep, [])

    const junk = toRegime({
      ts: 'khong-phai-date',
      data: {
        season: 'banana',
        asi: { d90: 'abc', d30: 12 },
        fng: { value: 'x' },
        btcDom: 'junk',
        flags: 'khong-phai-mang',
        sweep: [{ symbol: 'X', ok: 'yes', rate: '0.1' }],
      },
    })
    assert.equal(junk.season, 'neutral')
    assert.equal(junk.asi?.d90, null) // khong hop le -> null, khong NaN
    assert.equal(junk.asi?.d30, 12)
    assert.equal(junk.fng?.value, 0)
    assert.equal(junk.btcDom, null)
    assert.deepEqual(junk.flags, [])
    assert.equal(junk.sweep[0].ok, true) // !! 'yes'
    assert.equal(junk.sweep[0].rate, null)
    assert.equal(junk.ts, '') // ts hong -> rong
  })
})

describe('toZone — doc an toan est/actual', () => {
  test('day du -> giu nguyen est + actual', () => {
    const z = toZone({
      kind: 'zone',
      symbol: 'BTCUSDT',
      ts: '2026-10-04T10:00:00.000Z',
      data: {
        markPx: 85141.5,
        oiUsd: 3.2e9,
        lsRatio: 1.05,
        est: [
          { lev: 10, side: 'long', price: 76967.8, pct: -9.6, usd: 6.4e8 },
          { lev: 10, side: 'short', price: 93315.2, pct: 9.6, usd: 6.4e8 },
        ],
        actual: [{ side: 'long', price: 84900, usd: 5.2e6, n: 3 }],
      },
    })
    assert.equal(z.symbol, 'BTCUSDT')
    assert.equal(z.markPx, 85141.5)
    assert.equal(z.oiUsd, 3.2e9)
    assert.equal(z.lsRatio, 1.05)
    assert.equal(z.est.length, 2)
    assert.equal(z.est[0].side, 'long')
    assert.equal(z.actual[0].n, 3)
    assert.equal(z.ts, '2026-10-04T10:00:00.000Z')
  })

  test('thieu/truong hong -> mac dinh, side ep long', () => {
    const empty = toZone({ symbol: 'ETHUSDT', ts: '2026-10-04T10:00:00.000Z' })
    assert.equal(empty.markPx, 0)
    assert.equal(empty.oiUsd, null)
    assert.equal(empty.lsRatio, null)
    assert.deepEqual(empty.est, [])
    assert.deepEqual(empty.actual, [])

    const junk = toZone({
      ts: 'khong-phai-date',
      data: {
        markPx: 'abc',
        est: [{ lev: 'x', side: 'banana', price: 'junk', pct: 'no', usd: 'no' }],
        actual: [{ side: 42, price: 'p', usd: 'u', n: 'n' }],
      },
    })
    assert.equal(junk.markPx, 0)
    assert.equal(junk.est[0].side, 'long') // chi long/short
    assert.equal(junk.est[0].price, 0)
    assert.equal(junk.actual[0].side, 'long')
    assert.equal(junk.actual[0].usd, 0)
    assert.equal(junk.ts, '')
  })
})
