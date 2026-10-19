import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSESS_EXTRACTOR_VERSION,
  ASSESS_SCHEMA_VERSION,
  assessNewsItem,
  assessmentIdFor,
} from '../engine/newsAssess.mjs'
import {
  OUTLOOK_MIN_EVIDENCE,
  buildOutlook,
} from '../engine/outlook.mjs'
import { baseAssetOf, eventToMarker, mergeNewsMarkers } from '../app/utils/newsMarkers'

// =============================================================================
//  Evidence-backed extraction + outlook + terminal markers — V3.5 §60 Slice D.
//
//  Offline: rule-v1 assessments carry evidence IDs + verification from
//  corroboration (never prose confidence); outlook returns insufficient
//  evidence instead of generic predictions; retracted/uncertain events never
//  mark the terminal chart.
// =============================================================================

const T0 = 1_790_000_000_000
const item = (over = {}) => ({
  _id: 'news_abc',
  sourceId: 'coindesk',
  originUrl: 'https://www.coindesk.com/a',
  url: 'https://www.coindesk.com/a',
  title: 'Bitcoin ETF approval drives record inflows',
  marketGroup: 'crypto',
  tags: ['etf'],
  level: 'high',
  dir: 'pos',
  ...over,
})
const evt = (over = {}) => ({
  _id: 'evt_1',
  title: 'Bitcoin ETF approval drives record inflows',
  marketGroup: 'crypto',
  eventType: 'fund_flow',
  status: 'active',
  corroboration: { independentSources: 2, sourceIds: ['coindesk', 'decrypt'], dirs: ['pos'], status: 'multi_source' },
  entities: [{ symbol: 'BTC', confidence: 0.95, uncertain: false }],
  ...over,
})

describe('assessNewsItem — evidence IDs, verification, unknowns', () => {
  test('schema versions pinned; claim links item id + source URL', () => {
    const a = assessNewsItem(item(), evt(), T0)
    assert.equal(a._id, 'news_abc|rule-v1')
    assert.equal(a.extractorModelVersion, ASSESS_EXTRACTOR_VERSION)
    assert.equal(a.schemaVersion, ASSESS_SCHEMA_VERSION)
    assert.equal(a.sourceItemId, 'news_abc')
    assert.equal(a.eventId, 'evt_1')
    assert.equal(a.claims[0].sourceUrl, 'https://www.coindesk.com/a')
    assert.equal(a.claims[0].verification, 'multi_source')
    assert.equal(a.humanReviewRequired, false)
  })
  test('contradicted event forces review + low confidence (never hidden)', () => {
    const a = assessNewsItem(item(), evt({ corroboration: { independentSources: 2, sourceIds: ['a', 'b'], dirs: ['pos', 'neg'], status: 'contradicted' } }), T0)
    assert.equal(a.claims[0].verification, 'contradicted')
    assert.equal(a.humanReviewRequired, true)
    assert.ok(a.impactConfidence < 0.5)
  })
  test('unclustered item assesses with single_source + null event', () => {
    const a = assessNewsItem(item(), null, T0)
    assert.equal(a.eventId, null)
    assert.equal(a.eventType, null)
    assert.equal(a.claims[0].verification, 'single_source')
  })
  test('assessmentIdFor is the deterministic upsert key', () => {
    assert.equal(assessmentIdFor('news_abc'), 'news_abc|rule-v1')
  })
})

describe('buildOutlook — states, evidence, honesty', () => {
  const pub = (over = {}) => ({
    id: 'news_1', title: 'T', url: 'https://x.test/1', dir: 'pos', level: 'high', corroboration: 'single_source', ...over,
  })
  const pev = (over = {}) => ({
    id: 'evt_1', title: 'E', dirs: ['pos'], corroboration: 'multi_source', status: 'active', ...over,
  })

  test('thin evidence -> insufficient_evidence (never a generic prediction)', () => {
    const o = buildOutlook({ group: 'crypto', horizon: 'short_term', events: [], items: [pub()], nowMs: T0 })
    assert.equal(o.state, 'insufficient_evidence')
    assert.deepEqual(o.supporting, [])
  })
  test('unsupported group -> insufficient_evidence with pilot limitation', () => {
    const many = Array.from({ length: OUTLOOK_MIN_EVIDENCE }, (_, i) => pub({ id: `news_${i}` }))
    const o = buildOutlook({ group: 'macro_cb', horizon: 'swing', events: [], items: many, nowMs: T0 })
    assert.equal(o.state, 'insufficient_evidence')
    assert.ok(o.limitations.some((l) => l.includes('macro_cb')))
  })
  test('corroborated agreement -> directional; contradiction -> mixed', () => {
    const items = [pub({ id: 'a' }), pub({ id: 'b' }), pub({ id: 'c' })]
    const bull = buildOutlook({ group: 'crypto', horizon: 'short_term', events: [pev()], items, nowMs: T0 })
    assert.equal(bull.state, 'bullish')
    assert.ok(bull.supporting.length > 0)
    assert.ok(bull.evidenceHash.length >= 8)
    const mixed = buildOutlook({
      group: 'crypto', horizon: 'short_term',
      events: [pev({ corroboration: 'contradicted', dirs: ['pos', 'neg'] })], items, nowMs: T0,
    })
    assert.equal(mixed.state, 'mixed')
    assert.equal(mixed.contradictionCount, 1)
    assert.ok(mixed.counterEvidence.length > 0)
  })
  test('opposing items surface as counter-evidence; expiry per horizon', () => {
    const items = [pub({ id: 'a' }), pub({ id: 'b' }), pub({ id: 'c', dir: 'neg' })]
    const o = buildOutlook({ group: 'crypto', horizon: 'swing', events: [pev()], items, nowMs: T0 })
    assert.ok(o.counterEvidence.some((c) => c.id === 'c'))
    assert.equal(new Date(o.expiresAt).getTime(), T0 + 28 * 86400 * 1000)
    assert.equal(o._id, `outlook_crypto_swing_${new Date(T0).toISOString().slice(0, 10)}`)
  })
  test('same evidence in -> same hash out (reproducible)', () => {
    const args = { group: 'crypto', horizon: 'short_term', events: [pev()], items: [pub({ id: 'a' }), pub({ id: 'b' }), pub({ id: 'c' })], nowMs: T0 }
    assert.equal(buildOutlook(args).evidenceHash, buildOutlook(args).evidenceHash)
  })
  test('unknown horizon -> null', () => {
    assert.equal(buildOutlook({ group: 'crypto', horizon: 'nope', events: [], items: [], nowMs: T0 }), null)
  })
})

describe('newsMarkers — terminal chart safety', () => {
  test('baseAssetOf strips quote + perp suffix', () => {
    assert.equal(baseAssetOf('BTCUSDT.P'), 'BTC')
    assert.equal(baseAssetOf('ETHUSDT'), 'ETH')
    assert.equal(baseAssetOf('SOL-USDC'), 'SOL')
    assert.equal(baseAssetOf(''), '')
  })
  test('retracted events never mark; uncertain links never mark', () => {
    const base = evt({ status: 'retracted' })
    assert.equal(eventToMarker(base, 'BTC'), null)
    const unc = evt({ entities: [{ symbol: 'BTC', confidence: 0.85, uncertain: true }] })
    assert.equal(eventToMarker(unc, 'BTC'), null)
    const wrong = evt()
    assert.equal(eventToMarker(wrong, 'ETH'), null)
  })
  test('certain link marks med with majority dir', () => {
    const m = eventToMarker(evt(), 'BTC')
    assert.ok(m)
    assert.equal(m.level, 'med')
    assert.equal(m.dir, 'pos')
  })
  test('merge dedupes by link, intel wins', () => {
    const intel = [{ link: 'a', title: 'A' }]
    const merged = mergeNewsMarkers(intel, [{ link: 'a', title: 'A2' }, { link: 'event:x', title: 'E' }])
    assert.equal(merged.length, 2)
    assert.equal(merged[0].title, 'A')
  })
})
