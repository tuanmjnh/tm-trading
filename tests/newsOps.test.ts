import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// Offline suite: blank the URI (tsx auto-loads the repo .env) so collectReview
// deterministically exercises the fail-soft path; the live up-path is verified
// by running `npm run news:review` against a real store.
process.env.MONGODB_URI = ''
import { matchRule, ruleEventDedupeKey } from '../engine/alertRules.mjs'
import { buildReport, collectReview, coverageGate } from '../services/newsReview.mjs'
import { clusterRecentEvents } from '../services/newsEvents.mjs'

// =============================================================================
//  Operations hardening — V3.5 §60 Slice F.
//
//  Offline where possible: high-impact news fires news-kind alert rules (the
//  existing §58.5 infra — verified, not rebuilt); dedupe keys survive replay;
//  restart re-clustering never forks events; the coverage gate blocks unknown/
//  unproven sources; the review report carries per-source rights + quality.
// =============================================================================

const T0 = 1_790_000_000_000

describe('news alerting rides the existing alert-rules infra', () => {
  const highNews = { kind: 'news', level: 'high', dir: 'neg', source: 'coindesk', tags: ['security'], score: 8, key: 'news_x', title: 'Bridge exploit drains funds' }
  const rule = { ruleKey: 'r1', kind: 'news', minLevel: 'high', tags: ['security'] }

  test('high-impact news matches; medium does not pass a high floor', () => {
    assert.equal(matchRule(rule, highNews), true)
    assert.equal(matchRule(rule, { ...highNews, level: 'med' }), false)
    assert.equal(matchRule(rule, { ...highNews, kind: 'alert' }), false)
  })
  test('dedupe key is stable across replay/restart (same rule + event)', () => {
    const a = ruleEventDedupeKey(rule, highNews)
    const b = ruleEventDedupeKey({ ...rule }, { ...highNews })
    assert.equal(a, b)
    assert.ok(a.length > 0)
  })
})

describe('restart recovery — re-clustering is a fixed point', () => {
  function fakes(itemsList) {
    const events = new Map()
    const Item = { find() { return { sort() { return { limit() { return { lean: async () => itemsList } } } } } } }
    const Event = {
      async bulkWrite(ops) {
        let upserted = 0
        for (const op of ops) {
          if (!events.has(op.updateOne.filter._id)) {
            events.set(op.updateOne.filter._id, { status: 'active', revisions: [] })
            upserted += 1
          }
        }
        return { getUpsertedIds: () => Object.fromEntries(Array.from({ length: upserted }, (_, i) => [i, 1])) }
      },
      async updateOne() { return {} },
      findOne(filter) {
        return { select() { return { lean: async () => events.get(filter._id) || { status: 'active', revisions: [] } } } }
      },
    }
    return { Item, Event, events }
  }
  const itemsList = [
    { _id: 'news_a', sourceId: 'coindesk', title: 'Bitcoin ETF approval drives record inflows', excerpt: '', marketGroup: 'crypto', tags: ['etf'], level: 'high', dir: 'pos', publishedAt: new Date(T0), firstSeenAt: new Date(T0) },
    { _id: 'news_b', sourceId: 'decrypt', title: 'Bitcoin ETF approval drives record inflows', excerpt: '', marketGroup: 'crypto', tags: ['etf'], level: 'high', dir: 'pos', publishedAt: new Date(T0), firstSeenAt: new Date(T0) },
  ]

  test('crash-restart reruns converge: same event, zero new, zero corrections', async () => {
    const { Item, Event, events } = fakes(itemsList)
    const r1 = await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0) })
    assert.equal(r1.events, 1)
    // Simulated restart: fresh call, same store — must converge, not fork.
    const r2 = await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0 + 600_000) })
    assert.equal(r2.events, 1)
    assert.equal(r2.newEvents, 0)
    assert.equal(r2.corrections, 0)
    assert.equal(events.size, 1)
  })
})

describe('coverageGate — no expansion without proof', () => {
  const proven = {
    sourceId: 'coindesk', licenseStatus: 'ok',
    rights: { allowedDisplay: true }, health: { state: 'ok' },
  }
  test('proven pilot source passes', () => {
    const g = coverageGate(proven, { total: 120, multiSourceEvents: 30 })
    assert.equal(g.allowed, true)
    assert.deepEqual(g.reasons, [])
  })
  test('unknown license / down health / no items / no corroboration each block', () => {
    assert.equal(coverageGate({ ...proven, licenseStatus: 'unknown' }, { total: 5, multiSourceEvents: 1 }).allowed, false)
    assert.equal(coverageGate({ ...proven, licenseStatus: 'revoked' }, { total: 5, multiSourceEvents: 1 }).allowed, false)
    assert.equal(coverageGate({ ...proven, health: { state: 'down' } }, { total: 5, multiSourceEvents: 1 }).allowed, false)
    assert.equal(coverageGate(proven, { total: 0, multiSourceEvents: 0 }).allowed, false)
    assert.equal(coverageGate(proven, { total: 5, multiSourceEvents: 0 }).allowed, false)
    const g = coverageGate({ ...proven, licenseStatus: 'unknown' }, { total: 0, multiSourceEvents: 0 })
    assert.ok(g.reasons.length >= 3)
  })
})

describe('buildReport — operator review artifact', () => {
  test('per-source rows carry rights, health, gate; retention states TTL', () => {
    const r = buildReport({
      sources: [{
        sourceId: 'coindesk', trustTier: 'T2_SECONDARY', transport: 'rss',
        licenseStatus: 'ok', rights: { allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
        health: { state: 'ok', lastOkAt: new Date(T0).toISOString(), consecutiveErrors: 0 },
        retentionDays: 7,
      }],
      itemCountBySource: { coindesk: 120 },
      eventStats: { total: 40, multiSource: 30, contradicted: 1, corrected: 0, retracted: 0 },
      assessmentStats: { total: 120, humanReview: 2 },
      outlookStats: { total: 3, directional: 2, insufficient: 1 },
      evalStats: { total: 1, snapshots: 4, hitRate: 0.5, baselineHitRate: 0.5 },
      ttlEnforced: true,
    }, T0)
    assert.equal(r.sources.length, 1)
    assert.equal(r.sources[0].coverage.allowed, true)
    assert.equal(r.retention.ttlEnforced, true)
    assert.equal(r.events.contradicted, 1)
    assert.deepEqual(r.pilotGroups, ['crypto'])
  })
  test('unverified TTL is flagged, not assumed', () => {
    const r = buildReport({ sources: [] }, T0)
    assert.equal(r.retention.ttlEnforced, false)
    assert.ok(r.retention.note.includes('confirm'))
  })
})

describe('collectReview — fail-soft without Mongo', () => {
  test('never throws; down-shape carries no report', async () => {
    const res = await collectReview()
    assert.equal(res.mongo, 'down')
    assert.equal(res.report, null)
  })
})
