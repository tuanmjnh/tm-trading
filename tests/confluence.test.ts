import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { loadIntelData, toConfluence } from '#server/utils/intel'

// =============================================================================
//  Confluence — server layer (roadmap Phase 10).
//  Logic tinh diem (combineScore/scoreRegime/scoreFunding/scoreZone) da co
//  services/test.mjs section 8 (38 checks); o day test PHIA SERVER doc
//  snapshot confluence nhu the nao + mapper fail-soft.
// =============================================================================

describe('toConfluence — doc an toan diem gop', () => {
  test('day du data -> giu nguyen score/parts/rank', () => {
    const c = toConfluence({
      kind: 'confluence',
      key: 'confluence:ETHUSDT',
      symbol: 'ETHUSDT',
      score: 0.313,
      ts: '2026-10-04T10:00:00.000Z',
      data: {
        score: 0.3125,
        parts: { method: 0.5, regime: 0.2, funding: -0.33, zone: -0.15 },
        rank: 2,
        tf: '60',
        bars: 150,
        src: 'mover',
      },
    })
    assert.equal(c.symbol, 'ETHUSDT')
    assert.equal(c.score, 0.3125)
    assert.deepEqual(c.parts, { method: 0.5, regime: 0.2, funding: -0.33, zone: -0.15 })
    assert.equal(c.rank, 2)
    assert.equal(c.tf, '60')
    assert.equal(c.bars, 150)
    assert.equal(c.src, 'mover')
    assert.equal(c.ts, '2026-10-04T10:00:00.000Z')
  })

  test('thieu/truong hong -> mac dinh, khong NaN len UI', () => {
    const empty = toConfluence({ symbol: 'BTCUSDT', ts: '2026-10-04T10:00:00.000Z' })
    assert.equal(empty.score, 0)
    assert.deepEqual(empty.parts, { method: 0, regime: 0, funding: 0, zone: 0 })
    assert.equal(empty.rank, 0)
    assert.equal(empty.tf, '60')
    assert.equal(empty.bars, 0)
    assert.equal(empty.src, '')
    assert.equal(empty.ts, '2026-10-04T10:00:00.000Z')

    const junk = toConfluence({
      ts: 'khong-phai-date',
      data: {
        score: 'abc',
        parts: { method: 'x', regime: null, funding: NaN, zone: [1] },
        rank: 'r2',
        tf: null,
        bars: '150',
        src: null,
      },
    })
    assert.equal(junk.score, 0)
    assert.deepEqual(junk.parts, { method: 0, regime: 0, funding: 0, zone: 0 })
    assert.equal(junk.rank, 0)
    assert.equal(junk.tf, '60')
    assert.equal(junk.bars, 0)
    assert.equal(junk.src, '')
    assert.equal(junk.ts, '') // ts hong -> rong
  })
})

describe('loadIntelData (Phase 10 — confluence)', () => {
  test('field confluence luon la mang; moi row hop le, score trong [-1,1]', async () => {
    const d = await loadIntelData()
    assert.ok(Array.isArray(d.confluence))
    assert.ok(d.mongo === 'up' || d.mongo === 'down')
    for (const c of d.confluence) {
      assert.equal(typeof c.symbol, 'string')
      assert.ok(c.symbol.length > 0)
      assert.equal(typeof c.score, 'number')
      assert.ok(Number.isFinite(c.score))
      assert.ok(Math.abs(c.score) <= 1 + 1e-9)
      assert.equal(typeof c.parts.method, 'number')
      assert.equal(typeof c.parts.regime, 'number')
      assert.equal(typeof c.parts.funding, 'number')
      assert.equal(typeof c.parts.zone, 'number')
      assert.ok(Number.isFinite(c.rank) && c.rank >= 1)
      assert.equal(typeof c.ts, 'string')
      assert.ok(c.ts.length > 0)
    }
    // Mongo up sau services:once + confluence da chay -> doc duoc snapshot.
    if (d.mongo === 'up' && d.confluence.length) {
      // Da sort score desc trong loadIntelData.
      for (let i = 1; i < d.confluence.length; i++) {
        assert.ok(d.confluence[i - 1].score >= d.confluence[i].score)
      }
    }
  })
})
