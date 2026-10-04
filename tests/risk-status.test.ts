import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRiskStatus, readDriftStatus, toAccountDay, utcDayNow } from '#server/utils/risk'

describe('utcDayNow', () => {
  test('lay NGAY UTC (khong phai gio dia phuong) — D2', () => {
    assert.equal(utcDayNow(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01')
    assert.equal(utcDayNow(new Date('2025-12-31T23:59:59.999Z')), '2025-12-31')
    // 01:00 ngay 15/6 (+07:00) van la 14/6 UTC -> khong duoc lay ngay local.
    assert.equal(utcDayNow(new Date('2026-06-15T01:00:00+07:00')), '2026-06-14')
  })
})

describe('toAccountDay', () => {
  test('doc duoc day du document', () => {
    const haltedAt = new Date('2026-10-04T03:04:05.000Z')
    const a = toAccountDay({
      account: 'paper-1',
      utcDay: '2026-10-04',
      halted: true,
      haltReason: 'dailyLossCap',
      haltedAt,
      realizedPnlAbs: -120.5,
      realizedPnlPct: -3.2,
      tradesOpened: 5,
      tradesClosed: 4,
      consecutiveLosses: 2
    })
    assert.deepEqual(a, {
      account: 'paper-1',
      utcDay: '2026-10-04',
      halted: true,
      haltReason: 'dailyLossCap',
      haltedAt: '2026-10-04T03:04:05.000Z',
      realizedPnlAbs: -120.5,
      realizedPnlPct: -3.2,
      tradesOpened: 5,
      tradesClosed: 4,
      consecutiveLosses: 2
    })
  })

  test('thieu truong -> mac dinh, khong loi', () => {
    const a = toAccountDay({ account: 'p', utcDay: '2026-10-04' })
    assert.equal(a.halted, false)
    assert.equal(a.haltReason, '')
    assert.equal(a.haltedAt, null)
    assert.equal(a.realizedPnlPct, 0)
    assert.equal(a.tradesOpened, 0)
    assert.equal(a.consecutiveLosses, 0)
  })

  test('gia tri lech kieu -> an toan (khong NaN len UI)', () => {
    const a = toAccountDay({ account: 7, utcDay: null, realizedPnlPct: 'abc', haltedAt: 'khong-phai-date' })
    assert.equal(a.account, '7')
    assert.equal(a.utcDay, '')
    assert.equal(a.realizedPnlPct, 0)
    assert.equal(a.haltedAt, null)
    assert.equal(toAccountDay({}).account, 'default')
  })
})

describe('readDriftStatus — audit D8 (logs/risk.ndjson)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-drift-'))
  const file = join(dir, 'risk.ndjson')

  test('thieu file / file rong / khong co drift_report -> null (fail-soft)', () => {
    assert.equal(readDriftStatus(join(dir, 'khong-ton-tai.ndjson')), null)
    writeFileSync(file, '')
    assert.equal(readDriftStatus(file), null)
    writeFileSync(file, JSON.stringify({ ts: '2026-10-04T00:00:00Z', event: 'halt', reason: 'manual' }) + '\n')
    assert.equal(readDriftStatus(file), null)
  })

  test('lay drift_report GAN NHAT + dem checked/diverged', () => {
    writeFileSync(file, '')
    appendFileSync(file, JSON.stringify({
      ts: '2026-10-04T03:00:00.000Z', event: 'drift_report', windowH: 24, checked: 3, breach: false,
      rows: [
        { symbol: 'BTCUSDT', tf: '15', tv: 2, engine: 2 },
        { symbol: 'ETHUSDT', tf: '15', tv: 1, engine: 1 },
        { symbol: 'XRPUSDT', tf: '15', tv: 1, engine: 1 }
      ], skipped: 1
    }) + '\n')
    appendFileSync(file, JSON.stringify({
      ts: '2026-10-04T04:00:00.000Z', event: 'drift_report', windowH: 24, checked: 2, breach: true,
      rows: [
        { symbol: 'BTCUSDT', tf: '15', tv: 5, engine: 1 },
        { symbol: 'ETHUSDT', tf: '15', tv: 3, engine: 3 }
      ], skipped: 0
    }) + '\n')
    const d = readDriftStatus(file)
    assert.ok(d)
    assert.equal(d.lastCheckAt, '2026-10-04T04:00:00.000Z')
    assert.equal(d.breach, true)
    assert.equal(d.windowH, 24)
    assert.equal(d.checked, 2)
    assert.equal(d.diverged, 1)
  })

  test('dong cuoi bi cat giua (khu doc 64KB) -> bo qua, lay dong truoc do', () => {
    appendFileSync(file, '{"ts":"2026-10-04T05:00:00Z","event":"drift_rep')
    const d = readDriftStatus(file)
    assert.ok(d)
    assert.equal(d.lastCheckAt, '2026-10-04T04:00:00.000Z')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))
})

describe('loadRiskStatus — tich hop', () => {
  test('tra ve shape hop le (mongo up/deu khong 500) + co drift key', async () => {
    const r = await loadRiskStatus(new Date('2026-10-04T12:00:00.000Z'))
    assert.match(r.day, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(r.day, '2026-10-04')
    assert.ok(Array.isArray(r.accounts))
    assert.equal(typeof r.openPositions, 'number')
    assert.ok(r.mongo === 'up' || r.mongo === 'down')
    assert.ok(r.drift === null || typeof r.drift === 'object')
    for (const a of r.accounts) {
      assert.equal(typeof a.halted, 'boolean')
      assert.equal(typeof a.account, 'string')
    }
  })

  test('khong cau hinh Mongo -> fail-soft down (khong bam loi)', async () => {
    if (process.env.MONGODB_URI) {
      // Environment nay co Mongo — bo qua nhan xet 'down' (van da test shape o tren).
      return
    }
    const r = await loadRiskStatus()
    assert.equal(r.mongo, 'down')
    assert.equal(r.accounts.length, 0)
    assert.equal(r.openPositions, 0)
  })
})
