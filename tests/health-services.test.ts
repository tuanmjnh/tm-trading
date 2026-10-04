import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadServicesStatus, loadIntelData, toMover, toFlow, toAccum, toFunding, toNews } from '#server/utils/intel'

// =============================================================================
//  Market intel + heartbeat D9 (roadmap Phase 8) — server layer.
//  Logic services (parse/score/detect/heartbeat tinh toan) da co
//  services/test.mjs (52 checks); o day test PHIA SERVER doc nhu the nao.
// =============================================================================

describe('loadServicesStatus (D9)', () => {
  test('luon tra ve mang + shape hop le (file co hoac khong -> fail-soft)', async () => {
    const rows = await loadServicesStatus()
    assert.ok(Array.isArray(rows))
    for (const r of rows) {
      assert.equal(typeof r.name, 'string')
      assert.ok(r.intervalSec > 0)
      assert.equal(typeof r.overdue, 'boolean')
      assert.equal(typeof r.overdueSec, 'number')
      assert.ok(r.lastRunAt === null || typeof r.lastRunAt === 'string')
      assert.ok(r.lastOkAt === null || typeof r.lastOkAt === 'string')
      assert.ok(r.lastErrorAt === null || typeof r.lastErrorAt === 'string')
      assert.equal(typeof r.count, 'number')
    }
  })

  test('dung CUNG services/heartbeat.mjs nhu orchestrator (mot nguon - D1)', async () => {
    const href = pathToFileURL(join(process.cwd(), 'services', 'heartbeat.mjs')).href
    const hb = await import(/* @vite-ignore */ href) as typeof import('../../services/heartbeat.mjs')

    const dir = mkdtempSync(join(tmpdir(), 'tm-hb-'))
    const file = join(dir, 'services.json')
    const now = Date.now()
    hb.beat('fresh-svc', { lastOkAt: new Date(now - 1000).toISOString(), intervalSec: 900 }, file)
    hb.beat('dead-svc', { lastOkAt: new Date(now - 4000_000).toISOString(), intervalSec: 900 }, file)

    // evaluate truc tiep module -> phai khop logic (2 x chu ky).
    const rows = hb.evaluateHeartbeat(hb.readHeartbeat(file), now)
    assert.equal(rows.find((r) => r.name === 'fresh-svc')?.overdue, false)
    assert.equal(rows.find((r) => r.name === 'dead-svc')?.overdue, true)

    // loadServicesStatus doc file MAC DINH (logs/services.json) — chi dam bao
    // khong nem (file ton tai tu lan services:once chay that).
    const viaServer = await loadServicesStatus(now)
    assert.ok(Array.isArray(viaServer))

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('loadIntelData (fail-soft)', () => {
  test('tra ve day du field, mongo up|down, khong bo cai nao thieu', async () => {
    const d = await loadIntelData()
    assert.ok(d.mongo === 'up' || d.mongo === 'down')
    assert.ok(d.generatedAt === null || typeof d.generatedAt === 'string')
    assert.ok(Array.isArray(d.movers))
    assert.ok(Array.isArray(d.flows))
    assert.ok(Array.isArray(d.accums))
    assert.ok(Array.isArray(d.funding))
    assert.ok(Array.isArray(d.news))
    assert.ok(Array.isArray(d.services))
    // Local Mongo dang chay -> phai doc duoc snapshot services vua ghi.
    if (d.mongo === 'up' && d.movers.length) {
      const m = d.movers[0]
      assert.equal(typeof m.symbol, 'string')
      assert.equal(typeof m.pct24h, 'number')
      assert.equal(typeof m.breakout, 'boolean')
    }
  })
})

describe('mapper — doc an toan, khong NaN len UI', () => {
  test('toMover: day du + thieu truong -> mac dinh', () => {
    const full = toMover({ symbol: 'BTCUSDT', data: { pct24h: 5.5, chg4h: 1.2, quoteVolume: 1e9, lastPrice: 60000, breakout: true, atrPct: 2.1 } })
    assert.deepEqual(full, { symbol: 'BTCUSDT', pct24h: 5.5, chg4h: 1.2, quoteVolume: 1e9, lastPrice: 60000, breakout: true, atrPct: 2.1 })
    const empty = toMover({ symbol: 'X' })
    assert.equal(empty.pct24h, 0)
    assert.equal(empty.breakout, false)
    const junk = toMover({ symbol: 7, data: { pct24h: 'abc', breakout: 'yes' } })
    assert.equal(junk.symbol, '7')
    assert.equal(junk.pct24h, 0)
    assert.equal(junk.breakout, true) // bat ky gia tri nao ngoai false/null/0 -> true cua !! (van doc duoc)
  })

  test('toFlow: dir hop le, gia tri la -> vol', () => {
    const f = toFlow({ symbol: 'ETHUSDT', data: { dir: 'buy', reasons: ['volSpike'], volRatio: 2.5, takerRatio: 0.62, cmf: 0.25, pct24h: 3, score: 4.1 } })
    assert.equal(f.dir, 'buy')
    assert.deepEqual(f.reasons, ['volSpike'])
    assert.equal(f.score, 4.1)
    const bad = toFlow({ symbol: 'A', data: { dir: 'banana', reasons: 'khong-phai-mang' } })
    assert.equal(bad.dir, 'vol')
    assert.deepEqual(bad.reasons, [])
  })

  test('toAccum: reasons cast sang string array', () => {
    const a = toAccum({ symbol: 'SOLUSDT', data: { reasons: ['range', 42], rangePct: 3.3, priceChg48: -0.4, obvNorm: 5, volRatio: 0.7, pct24h: 1 } })
    assert.deepEqual(a.reasons, ['range', '42'])
    assert.equal(a.rangePct, 3.3)
    assert.equal(toAccum({ symbol: 'B' }).rangePct, 0)
  })

  test('toFunding: OI null khi thieu/khong hop le', () => {
    const f = toFunding({ symbol: 'BTCUSDT', data: { rate: 0.0008, pct: 0.08, nextFundingTime: 1791129600000, price: 60000, oiNotionalUsd: 123456789 } })
    assert.equal(f.oiNotionalUsd, 123456789)
    assert.equal(f.oiContracts, null)
    const junk = toFunding({ symbol: 'C', data: { oiNotionalUsd: 'abc' } })
    assert.equal(junk.oiNotionalUsd, null)
  })

  test('toNews: level/dir ep ve enum, ts hong -> rong', () => {
    const n = toNews({
      title: 'Hack exploit',
      score: 10,
      ts: '2026-10-04T10:00:00.000Z',
      data: { level: 'high', dir: 'neg', tags: ['security'], source: 'coindesk', link: 'https://x/a', excerpt: 'pwned' },
    })
    assert.equal(n.level, 'high')
    assert.equal(n.dir, 'neg')
    assert.equal(n.ts, '2026-10-04T10:00:00.000Z')
    assert.equal(n.excerpt, 'pwned')
    const bad = toNews({ title: 'x', ts: 'khong-phai-date', data: { level: 'low', dir: 'sideways' } })
    assert.equal(bad.level, 'med') // chi med/high vao collection — nhung mapper khong bao gio thieu
    assert.equal(bad.dir, 'flat')
    assert.equal(bad.ts, '')
  })
})

after(() => {
  // khong gi can cleanup — cac test doc file rieng/tam thoi.
})
