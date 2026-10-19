import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedTools, checkTool, READ_TOOLS } from '../engine/agentPolicy.mjs'
import { executeTool } from '../ai/agent.mjs'
import { assertNewsPaperAllowed, buildEvidencePacket } from '../engine/newsPacket.mjs'
import { evidenceRefSurvival, freezeNewsEvidence, newsEvidenceSetIdFor } from '../engine/newsEvidenceSet.mjs'
import { buildScorecard, returnSign, scoreOutlookSnapshot } from '../engine/newsScorecard.mjs'
import { citeNewsEvidenceSet, freezeNewsEvidenceSet, getNewsEvidenceSet, runNewsScorecard } from '../server/utils/newsEvidence'

// =============================================================================
//  Research evaluation + agent integration — V3.5 §60 Slice E.
//
//  Offline: bounded packet ranking (deterministic, PIT-cut, degraded honest),
//  A2 news gate, frozen evidence sets (future never leaks), scorecard math
//  with persistence baseline, and the newsEvidence agent tool with injected
//  model fakes (A0 read-only surface grows by policy decision).
// =============================================================================

const T0 = 1_790_000_000_000
const iso = (t) => new Date(t).toISOString()

const evt = (over = {}) => ({
  id: 'evt_1', title: 'Bitcoin ETF approval drives inflows', status: 'active',
  dirs: ['pos'], corroboration: 'multi_source', sourceIds: ['coindesk', 'decrypt'],
  entities: [{ symbol: 'BTC', confidence: 0.95, uncertain: false }],
  firstSeenAt: iso(T0), ...over,
})
const itm = (over = {}) => ({
  id: 'news_1', title: 'Bitcoin surges on ETF inflows', url: 'https://x.test/1',
  dir: 'pos', level: 'high', tags: ['etf'], sourceId: 'coindesk',
  firstSeenAt: iso(T0), publishedAt: iso(T0), ...over,
})

describe('buildEvidencePacket — bounded, deterministic, PIT-cut', () => {
  const q = { group: 'crypto', symbols: ['BTC'], horizon: 'short_term', lookbackHours: 72, budget: 12 }

  test('required primary events rank first; entity matches beat context', () => {
    const p = buildEvidencePacket({
      events: [evt({ id: 'e-ctx' }), evt({ id: 'e-req' })],
      items: [itm({ id: 'i-1', title: 'Unrelated market structure note' })],
      query: q, requiredEventIds: ['e-req'], asOfMs: T0 + 1000,
    })
    assert.equal(p.rows[0].id, 'e-req')
    assert.equal(p.rows[0].relevance, 'required-primary')
    assert.ok(!p.degraded)
  })
  test('future rows are excluded AND counted (PIT honesty)', () => {
    const p = buildEvidencePacket({
      events: [evt({ firstSeenAt: iso(T0 + 99_000_000) })],
      items: [itm()],
      query: q, asOfMs: T0 + 1000,
    })
    assert.equal(p.excluded.future, 1)
    assert.ok(p.rows.every((r) => r.id !== 'evt_1' || r.kind === 'item'))
    assert.ok(p.rows.some((r) => r.kind === 'item'))
  })
  test('retracted events never enter; budget caps with counts', () => {
    const items = Array.from({ length: 20 }, (_, i) => itm({ id: `news_${i}` }))
    const p = buildEvidencePacket({
      events: [evt({ id: 'e-ret', status: 'retracted' })],
      items, query: { ...q, budget: 5 }, asOfMs: T0 + 1000,
    })
    assert.ok(p.rows.every((r) => r.id !== 'e-ret'))
    assert.equal(p.rows.length, 5)
    assert.equal(p.excluded.retracted, 1)
    assert.ok(p.excluded.budget > 0)
  })
  test('source outage degrades the packet (never invents data)', () => {
    const p = buildEvidencePacket({
      events: [evt()], items: [itm()], query: q, asOfMs: T0 + 1000,
      health: { states: { coindesk: 'down', decrypt: 'ok' }, missingProviders: [] },
    })
    assert.equal(p.degraded, true)
    assert.ok(p.degradedReasons.some((r) => r.includes('coindesk')))
  })
  test('same inputs + clock -> same packet id, hash and order', () => {
    const args = { events: [evt()], items: [itm()], query: q, asOfMs: T0 + 1000 }
    const a = buildEvidencePacket(args)
    const b = buildEvidencePacket(args)
    assert.equal(a.packetId, b.packetId)
    assert.equal(a.packetHash, b.packetHash)
    assert.deepEqual(a.rows.map((r) => r.id), b.rows.map((r) => r.id))
  })
})

describe('assertNewsPaperAllowed — A2 news gate', () => {
  const clean = () => buildEvidencePacket({ events: [evt()], items: [itm(), itm({ id: 'news_2' }), itm({ id: 'news_3' })],
    query: { group: 'crypto', symbols: [], horizon: 'short_term', lookbackHours: 72, budget: 12 }, asOfMs: T0 + 1000 })
  test('clean packet passes', () => {
    const g = assertNewsPaperAllowed(clean())
    assert.equal(g.ok, true)
  })
  test('degraded / contradicted / empty packets block with codes', () => {
    assert.equal(assertNewsPaperAllowed({ degraded: true, degradedReasons: ['source x down'], rows: [1], contradictions: 0 }).code, 'PACKET_DEGRADED')
    const contra = buildEvidencePacket({ events: [evt({ corroboration: 'contradicted', dirs: ['pos', 'neg'] })],
      items: [itm(), itm({ id: 'i2' }), itm({ id: 'i3' })],
      query: { group: 'crypto', symbols: [], horizon: 'short_term', lookbackHours: 72, budget: 12 }, asOfMs: T0 + 1000 })
    assert.equal(assertNewsPaperAllowed(contra).code, 'PACKET_CONTRADICTED')
    assert.equal(assertNewsPaperAllowed({ degraded: false, rows: [], contradictions: 0 }).code, 'PACKET_EMPTY')
    assert.equal(assertNewsPaperAllowed(null).code, 'NO_PACKET')
  })
})

describe('freezeNewsEvidence — future never leaks into the past', () => {
  test('deterministic id; future + retracted excluded with counts', () => {
    const args = {
      items: [{ _id: 'news_a', firstSeenAt: iso(T0) }, { _id: 'news_b', firstSeenAt: iso(T0 + 50_000) }],
      events: [{ _id: 'evt_a', status: 'active', firstSeenAt: iso(T0) }, { _id: 'evt_r', status: 'retracted', firstSeenAt: iso(T0) }],
      observations: [],
      group: 'crypto', symbols: ['BTC'], purpose: 'evaluation', asOfMs: T0 + 1000,
    }
    const s = freezeNewsEvidence(args)
    assert.deepEqual(s.itemIds, ['news_a'])
    assert.deepEqual(s.eventIds, ['evt_a'])
    assert.equal(s.pitFlags.futureItemsExcluded, 1)
    assert.equal(s.frozen, true)
    assert.equal(s._id, newsEvidenceSetIdFor({ itemIds: ['news_a'], eventIds: ['evt_a'], observationIds: [], asOf: T0 + 1000, purpose: 'evaluation' }))
    assert.equal(freezeNewsEvidence(args)._id, s._id)
  })
  test('macro vintages pin to asOf (later revisions excluded)', () => {
    const s = freezeNewsEvidence({
      items: [], events: [],
      observations: [
        { _id: 'US_CPI|2026-09|v1', vintageAt: iso(T0) },
        { _id: 'US_CPI|2026-09|v2', vintageAt: iso(T0 + 50_000) },
      ],
      purpose: 'evaluation', asOfMs: T0 + 1000,
    })
    assert.deepEqual(s.observationIds, ['US_CPI|2026-09|v1'])
  })
})

describe('frozen evidence refs — the NewsItem TTL cannot break a set (§60.11)', () => {
  const item = (over = {}) => ({
    _id: 'news_a', title: 'Bitcoin ETF approval drives inflows', sourceId: 'coindesk',
    originUrl: 'https://x.test/a', publishedAt: iso(T0), firstSeenAt: iso(T0),
    marketGroup: 'crypto', level: 'high', hash: 'h_a', status: 'active',
    excerpt: 'FULL TEXT SHOULD NEVER BE COPIED', ...over,
  })
  const freeze = (items) => freezeNewsEvidence({
    items, events: [{ _id: 'evt_a', title: 'ETF approved', status: 'active', firstSeenAt: iso(T0), corroboration: { status: 'multi_source', sourceIds: ['coindesk'] }, itemIds: ['news_a'] }],
    observations: [{ _id: 'US_CPI|2026-09|v1', seriesId: 'US_CPI', refPeriod: '2026-09', value: 3.1, unit: 'pct', vintageAt: iso(T0), status: 'actual' }],
    group: 'crypto', symbols: ['BTCUSDT'], purpose: 'evaluation', asOfMs: T0 + 1000,
  })

  test('every cited id gets a frozen reference (deterministic, sorted)', () => {
    const s = freeze([item(), item({ _id: 'news_b', originUrl: 'https://x.test/b', title: 'Second' })])
    assert.deepEqual(s.itemRefs.map((r) => r.itemId), ['news_a', 'news_b'])
    assert.equal(s.eventRefs[0].eventId, 'evt_a')
    assert.equal(s.observationRefs[0].observationId, 'US_CPI|2026-09|v1')
    assert.equal(s.refPolicy.version, 'refs-v1')
    assert.equal(s.refPolicy.capturedAtFreeze, true)
    assert.equal(s.refPolicy.sourceTtlSeconds, 7 * 24 * 3600)
    assert.equal(s.refPolicy.missing, 0)
    // Deterministic: refreezing the same query yields the identical set.
    assert.deepEqual(freeze([item()]).itemRefs, s.itemRefs.slice(0, 1))
  })

  test('refs are rights-safe: metadata + url + hash, never the excerpt/text', () => {
    const ref = freeze([item()]).itemRefs[0]
    assert.equal(ref.url, 'https://x.test/a')
    assert.equal(ref.contentHash, 'h_a')
    assert.equal(ref.sourceTier, null)
    assert.deepEqual(Object.keys(ref).sort(), [
      'contentHash', 'firstSeenAt', 'itemId', 'marketGroup', 'publishedAt',
      'sourceId', 'sourceTier', 'status', 'title', 'url',
    ])
    assert.ok(!JSON.stringify(freeze([item()])).includes('FULL TEXT'), 'no body text may be copied into a frozen set')
  })

  test('a retracted event never enters, and untitled ids are counted not invented', () => {
    const s = freezeNewsEvidence({
      items: [{ firstSeenAt: iso(T0) }],
      events: [{ status: 'retracted', firstSeenAt: iso(T0) }],
      observations: [], purpose: 'evaluation', asOfMs: T0 + 1000,
    })
    assert.deepEqual(s.itemRefs, [])
    assert.equal(s.refPolicy.missing, 1)
  })

  test('survival: all rows expired -> still reproducible, decay counted', () => {
    const s = freeze([item(), item({ _id: 'news_b' })])
    // Mongo TTL pruned both rows: nothing live.
    const gone = evidenceRefSurvival(s, [])
    assert.equal(gone.cited, 2)
    assert.equal(gone.live, 0)
    assert.equal(gone.expired, 2)
    assert.equal(gone.refsCovered, 2)
    assert.equal(gone.reproducible, true)
    // Partial decay is reported as partial.
    const partial = evidenceRefSurvival(s, ['news_a'])
    assert.deepEqual([partial.live, partial.expired, partial.expiredItemIds], [1, 1, ['news_b']])
    // A pre-policy set (ids, no refs) is honestly NOT reproducible.
    assert.equal(evidenceRefSurvival({ itemIds: ['news_a'] }, []).reproducible, false)
  })
})

describe('scorecard — direction vs subsequent return, baseline honesty', () => {
  test('returnSign handles edges', () => {
    assert.equal(returnSign(100, 110), 'pos')
    assert.equal(returnSign(100, 90), 'neg')
    assert.equal(returnSign(100, 100), 'flat')
    assert.equal(returnSign(0, 10), 'flat')
  })
  test('hit / miss / baseline / excluded states', () => {
    const snap = { _id: 'outlook_crypto_short_term_2026-10-01' }
    assert.deepEqual(scoreOutlookSnapshot({ ...snap, state: 'bullish' }, 'BTCUSDT', { atStart: 100, atEnd: 110, atPrior: 95 }),
      { scored: true, snapshotId: snap._id, symbol: 'BTCUSDT', state: 'bullish', actual: 'pos', hit: true, baseline: true, beatBaseline: false })
    assert.equal(scoreOutlookSnapshot({ ...snap, state: 'bullish' }, 'BTCUSDT', { atStart: 100, atEnd: 90, atPrior: 110 }).hit, false)
    assert.equal(scoreOutlookSnapshot({ ...snap, state: 'neutral' }, 'BTCUSDT', { atStart: 100, atEnd: 110 }).scored, false)
    assert.equal(scoreOutlookSnapshot({ ...snap, state: 'insufficient_evidence' }, 'BTCUSDT', { atStart: 100, atEnd: 110 }).scored, false)
  })
  test('buildScorecard aggregates vs baseline, deterministic id', () => {
    const rows = [
      { scored: true, snapshotId: 's1', symbol: 'BTCUSDT', state: 'bullish', actual: 'pos', hit: true, baseline: true, beatBaseline: false },
      { scored: true, snapshotId: 's2', symbol: 'ETHUSDT', state: 'bearish', actual: 'pos', hit: false, baseline: false, beatBaseline: false },
      { scored: false, reason: 'neutral', snapshotId: 's3', symbol: 'BTCUSDT' },
    ]
    const c = buildScorecard({ group: 'crypto', horizon: 'short_term', symbols: ['BTCUSDT', 'ETHUSDT'], rows, asOfMs: T0 })
    assert.equal(c.snapshots, 2)
    assert.equal(c.excluded, 1)
    assert.equal(c.hitRate, 0.5)
    assert.equal(c.baselineHitRate, 0.5)
    assert.equal(buildScorecard({ group: 'crypto', horizon: 'short_term', symbols: ['ETHUSDT', 'BTCUSDT'], rows, asOfMs: T0 })._id, c._id)
  })
})

describe('newsEvidence agent tool — A0 read-only by policy', () => {  test('policy admits it at A0 only as read (no order capability)', () => {
    assert.ok(READ_TOOLS.includes('newsEvidence'))
    assert.ok(allowedTools('A0').includes('newsEvidence'))
    assert.equal(checkTool('A0', 'newsEvidence').ok, true)
    assert.equal(checkTool('A1', 'placeOrder').ok, false)
  })

  const chain = (rows) => ({ sort() { return { limit() { return { lean: async () => rows } } } } })
  // Agent tool reads live clock: fixtures must be fresh (fixed T0 would be stale-excluded).
  const fresh = Date.now() - 3_600_000
  const deps = (over = {}) => ({
    mongo: true,
    NewsItem: { find: () => chain([{
      _id: 'news_1', title: 'Bitcoin ETF approval drives inflows', originUrl: 'https://x.test/1',
      dir: 'pos', level: 'high', tags: ['etf'], sourceId: 'coindesk', firstSeenAt: new Date(fresh), publishedAt: new Date(fresh),
    }]) },
    MarketEvent: { find: () => chain([{
      _id: 'evt_1', title: 'Bitcoin ETF approval drives inflows', status: 'active',
      corroboration: { status: 'multi_source', dirs: ['pos'], sourceIds: ['coindesk', 'decrypt'] },
      entities: [{ symbol: 'BTC', confidence: 0.95, uncertain: false }], firstSeenAt: new Date(fresh), lastSeenAt: new Date(fresh),
    }]) },
    NewsSource: { find: () => ({ lean: async () => [{ sourceId: 'coindesk', health: { state: 'ok' } }] }) },
    ...over,
  })

  test('returns a bounded packet with evidence IDs (no Mongo needed)', async () => {
    const r = await executeTool('newsEvidence', { group: 'crypto', symbols: 'BTC', horizon: 'short_term' }, deps())
    assert.equal(r.ok, true)
    assert.ok(r.data.packet.packetId.startsWith('pkt_'))
    assert.ok(r.data.packet.rows.length > 0)
    assert.ok(r.data.packet.rows.every((row) => row.id && row.title))
  })

  test('mongo down -> fail-soft packet null (never throws)', async () => {
    const r = await executeTool('newsEvidence', {}, deps({ mongo: null }))
    // executeTool catches handler throws; handler returns mongo:down row
    assert.equal(r.ok, true)
    assert.equal(r.data.mongo, 'down')
  })
})

describe('server glue — freeze / cite / scorecard with injected fakes', () => {
  const qchain = (rows) => ({
    sort() { return { limit() { return { lean: async () => rows } } } },
    limit() { return { lean: async () => rows } },
    lean: async () => rows,
  })
  const memStore = () => {
    const docs = new Map()
    const writes = []
    return {
      docs,
      writes,
      async updateOne(filter, update) {
        writes.push({ filter, update })
        const id = filter._id
        if (update.$setOnInsert && !docs.has(id)) docs.set(id, update.$setOnInsert)
        if (update.$addToSet) {
          const d = docs.get(id) || { usedByExperimentIds: [] }
          for (const [k, v] of Object.entries(update.$addToSet)) {
            d[k] = [...new Set([...(d[k] || []), v])]
          }
          docs.set(id, d)
        }
        return {}
      },
      findOne(filter) {
        return { lean: async () => docs.get(filter._id) || null }
      },
    }
  }

  test('freeze persists a PIT-cut set; refreeze is a no-op (same id)', async () => {
    const store = memStore()
    const deps = {
      NewsItemModel: { find: () => qchain([{ _id: 'news_a', firstSeenAt: new Date(T0) }]) },
      NewsEventModel: { find: () => qchain([]) },
      MacroObservationModel: { find: () => ({ sort() { return { limit() { return { lean: async () => [] } } } } }) },
      NewsEvidenceSetModel: store,
    }
    const s1 = await freezeNewsEvidenceSet({ group: 'crypto', asOfMs: T0 + 1000, deps })
    assert.ok(s1._id.startsWith('nev_'))
    assert.deepEqual(s1.itemIds, ['news_a'])
    const s2 = await freezeNewsEvidenceSet({ group: 'crypto', asOfMs: T0 + 1000, deps })
    assert.equal(s2._id, s1._id)
    assert.equal(store.docs.size, 1)
  })

  test('read a frozen set: refs survive the source rows, unknown id -> 404', async () => {
    const store = memStore()
    // A set frozen 30 days ago whose source rows are long TTL-deleted.
    store.docs.set('nev_old', {
      _id: 'nev_old', itemIds: ['news_a', 'news_b'], frozen: true,
      itemRefs: [{ itemId: 'news_a', title: 'A' }, { itemId: 'news_b', title: 'B' }],
    })
    const deps = {
      NewsEvidenceSetModel: store,
      NewsItemModel: { find: () => ({ select() { return { lean: async () => [] } } }) },
    }
    const r = await getNewsEvidenceSet('nev_old', deps)
    assert.equal(r.set._id, 'nev_old')
    assert.equal(r.refs.items.length, 2)
    assert.deepEqual(r.survival, {
      cited: 2, live: 0, expired: 2, expiredItemIds: ['news_a', 'news_b'],
      refsCovered: 2, reproducible: true,
    })
    await assert.rejects(() => getNewsEvidenceSet('nev_nope', deps), (e) => e.statusCode === 404)
  })

  test('cite appends the experiment back-ref; unknown set -> 404', async () => {
    const store = memStore()
    store.docs.set('nev_x', { _id: 'nev_x', usedByExperimentIds: [] })
    const deps = { NewsEvidenceSetModel: store, getExperiment: async () => ({ experiment: { _id: 'exp_1' } }) }
    const r = await citeNewsEvidenceSet('nev_x', 'exp_1', deps)
    assert.deepEqual(r, { setId: 'nev_x', experimentId: 'exp_1' })
    assert.deepEqual(store.docs.get('nev_x').usedByExperimentIds, ['exp_1'])
    await assert.rejects(() => citeNewsEvidenceSet('nev_nope', 'exp_1', deps), (e) => e.statusCode === 404)
  })

  test('scorecard scores expired snapshots with fake klines; persists one doc', async () => {
    const outlooks = memStore()
    const evals = memStore()
    const gen = T0 - 30 * 86400 * 1000
    outlooks.docs.set('o1', { _id: 'o1' })
    const MarketOutlookModel = {
      find: () => ({ sort() { return { limit() { return { lean: async () => [{
        _id: 'o1', marketGroup: 'crypto', horizon: 'short_term', horizonDays: 7,
        generatedAt: new Date(gen), state: 'bullish',
      }] } } } } }),
    }
    const day = 86400 * 1000
    const klinesImpl = async ({ symbol }) => [
      { time: gen - 7 * day, close: 90 },
      { time: gen, close: 100 },
      { time: gen + 7 * day, close: 110 },
    ]
    const card = await runNewsScorecard({
      group: 'crypto', horizon: 'short_term', symbols: ['BTCUSDT'], asOfMs: T0,
      klinesImpl, deps: { MarketOutlookModel, NewsEvaluationModel: evals },
    })
    assert.equal(card.snapshots, 1)
    assert.equal(card.hits, 1)
    assert.equal(card.hitRate, 1)
    assert.equal(evals.docs.size, 1)
  })
})
