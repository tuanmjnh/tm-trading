import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOverlay, metricRows, paramsDiff, paramsValue } from '../shared/utils/compare'
import type { EquityPoint, RunSeriesDetail, RunSummary } from '../types/runs'

const baseSummary: RunSummary = {
  runs: 1,
  trades: 0,
  open: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  profitFactor: null,
  netPct: 0,
  maxDrawdownPct: 0,
  avgRr: 0,
  expectancy: 0,
  medianRr: 0,
  degenerateRisk: 0
}

function detail(
  summary: Partial<RunSummary>,
  params: Record<string, unknown> = {},
  equity: EquityPoint[] = []
): RunSeriesDetail {
  return {
    id: 'id',
    engineVersion: '0.5.0',
    paramsHash: 'hash',
    symbol: 'BTCUSDT.P',
    tf: '15',
    market: 'perp',
    method: 'vsa',
    preset: null,
    firstRunAt: '2026-01-01T00:00:00.000Z',
    lastRunAt: '2026-01-02T00:00:00.000Z',
    dataHashCount: 1,
    gitRev: null,
    rawTrades: 0,
    duplicateTrades: 0,
    warnings: [],
    summary: { ...baseSummary, ...summary },
    params,
    dataHashes: [],
    gitRevs: [],
    trades: [],
    equity
  }
}

describe('metricRows', () => {
  const a = detail({ trades: 10, winRate: 0.6, profitFactor: 1.8, netPct: -10, maxDrawdownPct: 3, medianRr: 0.5, expectancy: 0.1 })
  const b = detail({ trades: 4, winRate: 0.4, profitFactor: 0.9, netPct: 5, maxDrawdownPct: 7, medianRr: -0.2, expectancy: -0.3 })

  test('best: net/WR/PF cao hon, maxDD THAP hon', () => {
    const rows = metricRows([a, b])
    const row = (k: string) => rows.find(r => r.key === k)!
    assert.equal(row('net').best, 1, 'net 5 > -10 -> cot 1')
    assert.equal(row('winRate').best, 0, 'WR 0.6 > 0.4 -> cot 0')
    assert.equal(row('profitFactor').best, 0, 'PF 1.8 > 0.9 -> cot 0')
    assert.equal(row('maxDD').best, 0, 'DD 3 < 7 -> cot 0 (thap hon tot hon)')
    assert.equal(row('expectancy').best, 0)
  })

  test('bang nhau -> khong ai nhat; chi so thong tin khong xep hang', () => {
    const rows = metricRows([detail({ netPct: 2, profitFactor: 1.5 }), detail({ netPct: 2, profitFactor: 1.5 })])
    const row = (k: string) => rows.find(r => r.key === k)!
    assert.equal(row('net').best, null, 'net bang nhau -> khong highlight')
    assert.equal(row('trades').best, null, 'trades = thong tin, khong xep hang')
    assert.equal(row('profitFactor').best, null)
  })

  test('PF = null (∞) -> khong xep hang (khong phai 0)', () => {
    const rows = metricRows([detail({ profitFactor: null }), detail({ profitFactor: 2 })])
    const row = rows.find(r => r.key === 'profitFactor')!
    assert.deepEqual(row.values, [null, 2])
    assert.equal(row.best, null)
  })

  test('values giu thu tu series da chon', () => {
    const rows = metricRows([a, b])
    const row = rows.find(r => r.key === 'net')!
    assert.deepEqual(row.values, [-10, 5])
  })
})

describe('paramsDiff', () => {
  test('phat hiet key khac gia tri + dem key giong', () => {
    const d = paramsDiff([{ atr: 1.5, risk: 1 }, { atr: 2, risk: 1 }])
    assert.deepEqual(d.keys, ['atr', 'risk'])
    assert.deepEqual(d.diffKeys, ['atr'])
    assert.equal(d.sameCount, 1)
  })

  test('thieu key = mot gia tri rieng (khac voi co gia tri)', () => {
    const d = paramsDiff([{ a: 1 }, { a: 1, b: 2 }])
    assert.deepEqual(d.keys, ['a', 'b'])
    assert.deepEqual(d.diffKeys, ['b'])
    assert.equal(d.sameCount, 1)
  })

  test('object lech thu tu key van la GIONG', () => {
    const d = paramsDiff([
      { cfg: { x: 1, y: 2 } },
      { cfg: { y: 2, x: 1 } }
    ])
    assert.deepEqual(d.diffKeys, [])
    const d2 = paramsDiff([
      { cfg: { x: 1, y: 2 } },
      { cfg: { x: 9, y: 2 } }
    ])
    assert.deepEqual(d2.diffKeys, ['cfg'])
  })

  test('mang rong / params rong', () => {
    assert.deepEqual(paramsDiff([]), { keys: [], diffKeys: [], sameCount: 0 })
    assert.deepEqual(paramsDiff([{}, {}]), { keys: [], diffKeys: [], sameCount: 0 })
  })
})

describe('paramsValue', () => {
  test('format an toan moi kieu gia tri', () => {
    assert.equal(paramsValue(undefined), '—')
    assert.equal(paramsValue(null), 'null')
    assert.equal(paramsValue(3), '3')
    assert.equal(paramsValue(true), 'true')
    assert.equal(paramsValue('vsa'), 'vsa')
    assert.equal(paramsValue({ b: 1, a: 2 }), '{"a":2,"b":1}')
    assert.equal(paramsValue([1, 2]), '[1,2]')
  })
})

describe('buildOverlay', () => {
  const eqA: EquityPoint[] = [
    { t: '2026-01-01T00:00:00.000Z', v: 2 },
    { t: '2026-01-03T00:00:00.000Z', v: -1 }
  ]
  const eqB: EquityPoint[] = [
    { t: '2026-01-02T00:00:00.000Z', v: 5 }
  ]

  test('khong co du lieu -> null (khong loi)', () => {
    assert.equal(buildOverlay([]), null)
    assert.equal(buildOverlay([{ id: 'a', equity: [] }, { id: 'b', equity: [] }]), null)
    assert.equal(buildOverlay([{ id: 'a', equity: [{ t: 'khong-phai-date', v: 1 }] }]), null)
  })

  test('truc chung: union time + value, gom moc 0', () => {
    const chart = buildOverlay([
      { id: 'a', equity: eqA },
      { id: 'b', equity: eqB }
    ])!
    assert.equal(chart.minT, Date.parse('2026-01-01T00:00:00.000Z'))
    assert.equal(chart.maxT, Date.parse('2026-01-03T00:00:00.000Z'))
    // values: {0 (xuat phat), 2, -1, 5} -> min -1, max 5
    assert.equal(chart.minV, -1)
    assert.equal(chart.maxV, 5)
    // y(0) = 100 - (0-(-1))/6*100 = 83.333...
    assert.ok(Math.abs(chart.zeroY - 83.3333) < 0.001, `zeroY=${chart.zeroY}`)
    assert.equal(chart.lines.length, 2)
  })

  test('duong bat dau tu moc 0 va ket thuc dung gia tri cuoi', () => {
    const chart = buildOverlay([
      { id: 'a', equity: eqA },
      { id: 'b', equity: eqB }
    ])!
    const lineA = chart.lines[0]
    assert.ok(lineA.d.startsWith('M0.00,83.33'), `bat dau: ${lineA.d.slice(0, 20)}`)
    // diem cuoi A: v=-1 = minV -> y = 100; x = maxT -> 1000
    assert.ok(lineA.d.endsWith('L1000.00,100.00'), `cuoi: ${lineA.d.slice(-20)}`)
    // diem cuoi B: v=5 = maxV -> y = 0; x = giua (01-02) -> 500
    const lineB = chart.lines[1]
    assert.ok(lineB.d.endsWith('L500.00,0.00'), `cuoi B: ${lineB.d.slice(-20)}`)
  })

  test('equity khong sap xep van ve dung (sort ben trong)', () => {
    const shuffled: EquityPoint[] = [eqA[1], eqA[0]]
    const chart = buildOverlay([
      { id: 'a', equity: eqA },
      { id: 'b', equity: shuffled }
    ])!
    assert.ok(chart.lines[1].d.endsWith('L1000.00,100.00'), 'sort truoc khi ve')
  })

  test('series rong bi bo qua, series con lai van ve', () => {
    const chart = buildOverlay([
      { id: 'empty', equity: [] },
      { id: 'b', equity: eqB }
    ])!
    assert.equal(chart.lines.length, 1)
    assert.equal(chart.lines[0].id, 'b')
  })

  test('toan bo bang nhau -> khong chia cho 0 (range mo rong -1..1)', () => {
    const chart = buildOverlay([
      { id: 'a', equity: [{ t: '2026-01-01T00:00:00.000Z', v: 0 }, { t: '2026-01-02T00:00:00.000Z', v: 0 }] }
    ])!
    assert.equal(chart.minV, -1)
    assert.equal(chart.maxV, 1)
    assert.ok(Math.abs(chart.zeroY - 50) < 1e-9)
    assert.ok(!chart.lines[0].d.includes('NaN'))
  })
})
