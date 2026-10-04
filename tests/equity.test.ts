import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { equityFromTrades, loadRunSeries } from '#server/utils/reports'
import { summarizeRuns } from '../engine/store.mjs'

/** Dam/tham cua curve - cung cong thuc voi engine (peak bat dau tu 0). */
function curveDrawdown(points: { v: number }[]): number {
  let eq = 0
  let peak = 0
  let dd = 0
  for (const p of points) {
    eq = p.v
    if (eq > peak) peak = eq
    const d = peak - eq
    if (d > dd) dd = d
  }
  return dd
}

const closeTrade = (pnlPct: number, exitTime: string) => ({
  result: pnlPct >= 0 ? 'TP' : 'SL',
  pnlPct,
  exitTime,
  entryTime: exitTime
})

describe('equityFromTrades', () => {
  test('tich luy theo thu tu va loai lenh OPEN', () => {
    const eq = equityFromTrades([
      closeTrade(1.5, '2026-01-01T00:00:00.000Z'),
      closeTrade(-0.5, '2026-01-02T00:00:00.000Z'),
      { result: 'OPEN', pnlPct: 99, exitTime: undefined, entryTime: '2026-01-03T00:00:00.000Z' },
      closeTrade(2, '2026-01-04T00:00:00.000Z')
    ])
    assert.equal(eq.length, 3, 'OPEN khong tinh')
    assert.deepEqual(eq.map(p => p.v), [1.5, 1, 3])
    assert.equal(eq[0].t, '2026-01-01T00:00:00.000Z')
  })

  test('khong co lenh dong -> mang rong (khong loi)', () => {
    assert.deepEqual(equityFromTrades([]), [])
    assert.deepEqual(
      equityFromTrades([{ result: 'OPEN', pnlPct: 0, exitTime: undefined, entryTime: 'x' }]),
      []
    )
  })

  test('diem cuoi LUON bang netPct va dam curve bang maxDrawdownPct (khoa D1)', () => {
    // Duong cong qua dinh roi xuong - dam dam phai xay ra sau khi dat peak.
    const trades = [
      closeTrade(2, 't1'),
      closeTrade(-0.4, 't2'),
      closeTrade(3.1, 't3'),
      closeTrade(-5, 't4'),
      closeTrade(0.7, 't5')
    ]
    const eq = equityFromTrades(trades)
    const s = summarizeRuns([{ trades }], { label: 'test' })
    assert.ok(Math.abs(eq[eq.length - 1].v - s.netPct) < 1e-12, 'diem cuoi === netPct')
    assert.ok(Math.abs(curveDrawdown(eq) - s.maxDrawdownPct) < 1e-12, 'dam curve === maxDrawdownPct')
  })

  test('dam tu 0: luon lon nhat khi lenh dau tien am', () => {
    const trades = [closeTrade(-4, 't1'), closeTrade(1, 't2')]
    const eq = equityFromTrades(trades)
    const s = summarizeRuns([{ trades }], { label: 'test' })
    // peak bat dau tu 0 -> dam = 4 (truoc khi hoi phuc 3)
    assert.ok(Math.abs(curveDrawdown(eq) - s.maxDrawdownPct) < 1e-12)
    assert.ok(Math.abs(s.maxDrawdownPct - 4) < 1e-12)
  })
})

describe('loadRunSeries - tich hop voi reports/ that (neu co)', () => {
  test('moi series: equity cuoi === netPct va dam === maxDrawdownPct', async (t) => {
    if (!existsSync(join(process.cwd(), 'reports', 'runs.ndjson'))) {
      t.skip('chua co reports/runs.ndjson')
      return
    }
    const { series } = await loadRunSeries()
    assert.ok(series.length > 0, 'reports/ phai co it nhat 1 series')
    for (const s of series) {
      const id = `${s.symbol} ${s.tf}`
      assert.ok(s.equity.length > 0, `${id}: equity khong rong`)
      assert.equal(s.equity.length, s.summary.trades, `${id}: so diem === so lenh dong`)
      const last = s.equity[s.equity.length - 1].v
      assert.ok(Math.abs(last - s.summary.netPct) < 1e-9, `${id}: diem cuoi ${last} !== netPct ${s.summary.netPct}`)
      assert.ok(
        Math.abs(curveDrawdown(s.equity) - s.summary.maxDrawdownPct) < 1e-9,
        `${id}: dam curve !== maxDrawdownPct`
      )
    }
  })
})
