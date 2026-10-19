import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEWS_EXCERPT_MAX,
  NEWS_RETENTION_SECONDS,
  PILOT_SOURCES,
  canonicalizeUrl,
  licenseGate,
  newsItemIdFor,
  pilotSourceFor,
  toNewsItem,
  toPublicNewsItem,
} from '../engine/newsIngest.mjs'
import { NewsItem } from '../engine/models/newsItem.mjs'
import {
  persistNewsItems,
  seedNewsSources,
  updateSourceHealth,
} from '../services/newsStore.mjs'

// =============================================================================
//  News ingestion — V3.5 §60 Slice B (read-only observability store).
//
//  Offline: PURE engine rules (deterministic ids, canonical URLs, fail-closed
//  license gate, allowlist projection) plus SERVICE glue with injected model
//  fakes (no Mongo). Slice acceptance covered here:
//  replayed/duplicated feed items never duplicate records; revoked/unknown
//  licenses block storage; rights-safe projection; provider failure is visible
//  via source health.
// =============================================================================

const T0 = 1_790_000_000_000

const okSource = () => ({ ...pilotSourceFor('coindesk') })

const scored = (over = {}) => ({
  title: 'BlackRock files for spot ETF approval',
  link: 'https://www.coindesk.com/markets/2026/10/16/etf-approval/?utm_source=rss&utm_medium=rss',
  source: 'coindesk',
  excerpt: 'x'.repeat(500),
  ts: T0,
  score: 7,
  level: 'high',
  dir: 'pos',
  tags: ['etf'],
  ...over,
})

/** Minimal in-memory bulkWrite fake: upsert-by-_id counting. */
function fakeItemModel() {
  const store = new Map()
  return {
    store,
    async bulkWrite(ops) {
      let upsertedCount = 0
      for (const op of ops) {
        const id = op.updateOne.filter._id
        if (!store.has(id)) {
          store.set(id, op.updateOne.update.$setOnInsert)
          upsertedCount += 1
        }
      }
      return { upsertedCount }
    },
  }
}

describe('canonicalizeUrl — one story, one identity', () => {
  test('strips tracking params, fragments and host case', () => {
    const a = canonicalizeUrl('https://CoinDesk.COM/a/b?utm_source=rss&fbclid=1#frag')
    const b = canonicalizeUrl('https://coindesk.com/a/b')
    assert.equal(a, b)
  })
  test('query param order does not matter; meaningful params survive', () => {
    const a = canonicalizeUrl('https://x.test/p?b=2&a=1&utm_medium=rss')
    const b = canonicalizeUrl('https://x.test/p?a=1&b=2')
    assert.equal(a, b)
    assert.ok(a.includes('a=1'))
  })
  test('unparseable / non-http input is unusable', () => {
    assert.equal(canonicalizeUrl(''), '')
    assert.equal(canonicalizeUrl('not a url'), '')
    assert.equal(canonicalizeUrl('ftp://x.test/f'), '')
  })
})

describe('newsItemIdFor — deterministic, replay-safe', () => {
  test('same story (utm variants) -> same id; different story -> different id', () => {
    const a = newsItemIdFor('https://www.coindesk.com/a/?utm_source=rss')
    const b = newsItemIdFor('https://www.coindesk.com/a/')
    const c = newsItemIdFor('https://www.coindesk.com/b/')
    assert.ok(a.startsWith('news_'))
    assert.equal(a, b)
    assert.notEqual(a, c)
  })
  test('bad URL -> empty id (caller must drop)', () => {
    assert.equal(newsItemIdFor(''), '')
  })
})

describe('licenseGate — fail-closed', () => {
  test('audited pilot source passes', () => {
    assert.deepEqual(licenseGate(okSource()), { ok: true, reason: 'ok' })
  })
  test('revoked / unverified / missing source blocks storage', () => {
    assert.equal(licenseGate({ ...okSource(), licenseStatus: 'revoked' }).ok, false)
    assert.equal(licenseGate({ ...okSource(), licenseStatus: 'unknown' }).ok, false)
    assert.equal(licenseGate(null).ok, false)
    assert.equal(licenseGate({ ...okSource(), rights: { allowedStoreMetadata: false } }).ok, false)
  })
})

describe('toNewsItem — normalized envelope', () => {
  test('caps excerpt at rights-safe length, keeps original title, stamps times', () => {
    const doc = toNewsItem(scored(), okSource(), T0)
    assert.ok(doc)
    assert.equal(doc.excerpt.length, NEWS_EXCERPT_MAX)
    assert.equal(doc.title, scored().title)
    assert.equal(doc.marketGroup, 'crypto')
    assert.equal(doc.eventType, null)
    assert.equal(doc.firstSeenAt.getTime(), T0)
    assert.equal(doc.ingestedAt.getTime(), T0)
    assert.equal(doc.url, canonicalizeUrl(scored().link))
    assert.equal(doc.originUrl, scored().link)
  })
  test('gated source or bad URL -> null (never stored)', () => {
    assert.equal(toNewsItem(scored(), { ...okSource(), licenseStatus: 'revoked' }, T0), null)
    assert.equal(toNewsItem(scored({ link: 'junk' }), okSource(), T0), null)
  })
})

describe('toPublicNewsItem — allowlist projection', () => {
  test('only safe fields leave the API; internals and full text never leak', () => {
    const pub = toPublicNewsItem({
      _id: 'news_abc',
      sourceId: 'coindesk',
      url: 'https://canon',
      originUrl: 'https://origin?a=1',
      title: 'T',
      excerpt: 'E',
      body: 'FULL TEXT MUST NEVER LEAVE',
      fullText: 'FULL TEXT MUST NEVER LEAVE',
      language: 'en',
      publishedAt: new Date(T0),
      firstSeenAt: new Date(T0),
      marketGroup: 'crypto',
      eventType: null,
      tags: ['etf'],
      level: 'high',
      dir: 'pos',
      score: 7,
      rights: { allowedDisplay: true, allowedSummarize: false },
      hash: 'secret',
      schemaVersion: '1',
    })
    assert.equal(pub.id, 'news_abc')
    assert.equal(pub.url, 'https://origin?a=1')
    assert.ok(!('body' in pub) && !('fullText' in pub) && !('hash' in pub) && !('_id' in pub) && !('rights' in pub))
  })
  test('display-revoked item projects to null', () => {
    assert.equal(toPublicNewsItem({ _id: 'x', rights: { allowedDisplay: false } }), null)
  })
})

describe('NewsItem schema — retention index', () => {
  test('TTL index on ingestedAt matches the license-matrix ceiling', () => {
    assert.equal(NEWS_RETENTION_SECONDS, 7 * 24 * 3600)
    const idx = NewsItem.schema.indexes()
    const ttl = idx.find(([spec, opts]) => spec.ingestedAt === 1 && opts.expireAfterSeconds === NEWS_RETENTION_SECONDS)
    assert.ok(ttl, 'missing TTL index on ingestedAt')
  })
})

describe('seedNewsSources — policy is insert-only', () => {
  test('policy fields use $setOnInsert (operator edits survive reseeding)', async () => {
    const seen = []
    const fake = {
      async bulkWrite(ops) { seen.push(...ops); return {} },
      find() { return { lean: async () => [] } },
    }
    await seedNewsSources({ NewsSourceModel: fake })
    assert.equal(seen.length, PILOT_SOURCES.length)
    for (const op of seen) {
      assert.ok(op.updateOne.upsert)
      assert.ok(op.updateOne.update.$setOnInsert.licenseStatus)
      assert.equal(op.updateOne.update.$setOnInsert.enabled, true)
      assert.ok(!('licenseStatus' in (op.updateOne.update.$set || {})), 'policy must not be $set')
      assert.ok(!('enabled' in (op.updateOne.update.$set || {})), 'operator switch must not be $set')
    }
  })
})

describe('persistNewsItems — idempotent, gated', () => {
  test('re-ingest (replay/retry/overlap) never duplicates; second run counts dupes', async () => {
    const fake = fakeItemModel()
    const sources = { coindesk: okSource() }
    const batch = [scored(), scored({ link: 'https://www.coindesk.com/other/' })]
    const r1 = await persistNewsItems(batch, sources, { NewsItemModel: fake, now: new Date(T0) })
    assert.equal(r1.persisted, 2)
    assert.equal(fake.store.size, 2)
    const first = fake.store.get(newsItemIdFor(batch[0].link))
    const r2 = await persistNewsItems(batch, sources, { NewsItemModel: fake, now: new Date(T0 + 60_000) })
    assert.equal(r2.persisted, 0)
    assert.equal(r2.duplicates, 2)
    assert.equal(fake.store.get(newsItemIdFor(batch[0].link)).firstSeenAt.getTime(), T0)
    assert.equal(first, fake.store.get(newsItemIdFor(batch[0].link)))
  })
  test('utm/fragment variants of the same story collapse to one record', async () => {
    const fake = fakeItemModel()
    const sources = { coindesk: okSource() }
    const batch = [
      scored({ link: 'https://www.coindesk.com/s/?utm_source=rss' }),
      scored({ link: 'https://www.coindesk.com/s/#frag' }),
    ]
    const r = await persistNewsItems(batch, sources, { NewsItemModel: fake, now: new Date(T0) })
    assert.equal(r.persisted, 1)
    assert.equal(r.duplicates, 1)
  })
  test('revoked license stores nothing (counts skipped, never writes)', async () => {
    const fake = fakeItemModel()
    const sources = { coindesk: { ...okSource(), licenseStatus: 'revoked' } }
    const r = await persistNewsItems([scored()], sources, { NewsItemModel: fake, now: new Date(T0) })
    assert.equal(r.persisted, 0)
    assert.equal(r.skipped, 1)
    assert.equal(r.skippedReasons.license_revoked, 1)
    assert.equal(fake.store.size, 0)
  })
})

describe('updateSourceHealth — provider failure is visible', () => {
  test('success records ok + clears errors; failure records down + error + increments', async () => {
    const writes = []
    const fake = { async bulkWrite(ops) { writes.push(...ops); return {} } }
    await updateSourceHealth(
      [
        { sourceId: 'coindesk', ok: true, itemCount: 3, error: null },
        { sourceId: 'decrypt', ok: false, itemCount: 0, error: 'socket hang up' },
      ],
      { NewsSourceModel: fake, now: new Date(T0) },
    )
    assert.equal(writes.length, 2)
    const okWrite = writes[0].updateOne
    assert.equal(okWrite.update.$set['health.state'], 'ok')
    assert.equal(okWrite.update.$set['health.consecutiveErrors'], 0)
    const badWrite = writes[1].updateOne
    assert.equal(badWrite.update.$set['health.state'], 'down')
    assert.equal(badWrite.update.$set['health.lastError'], 'socket hang up')
    assert.equal(badWrite.update.$inc['health.consecutiveErrors'], 1)
  })
  test('empty feed degrades instead of failing silently green', async () => {
    const writes = []
    const fake = { async bulkWrite(ops) { writes.push(...ops); return {} } }
    await updateSourceHealth([{ sourceId: 'coindesk', ok: true, itemCount: 0, error: null }], {
      NewsSourceModel: fake,
      now: new Date(T0),
    })
    assert.equal(writes[0].updateOne.update.$set['health.state'], 'degraded')
  })
})
