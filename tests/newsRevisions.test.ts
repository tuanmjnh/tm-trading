import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEWS_RETENTION_SECONDS,
  newsContentHashFor,
  newsRevisionIdFor,
  pilotSourceFor,
  revisionDocFor,
  toNewsItem,
} from '../engine/newsIngest.mjs'
import { NewsItemRevision } from '../engine/models/newsItemRevision.mjs'
import { persistNewsItems } from '../services/newsStore.mjs'

// =============================================================================
//  §60.11 item revision trail — an item that materially changes keeps "what was
//  previously known". Offline: pure hash/id/doc helpers + injected model fakes.
// =============================================================================

const T0 = 1_790_000_000_000

const okSource = () => ({ ...pilotSourceFor('coindesk') })
const scored = (over: Record<string, unknown> = {}) => ({
  title: 'BlackRock files for spot ETF approval',
  link: 'https://www.coindesk.com/markets/2026/10/16/etf-approval/',
  source: 'coindesk',
  excerpt: 'x'.repeat(500),
  ts: T0,
  score: 7,
  level: 'high',
  dir: 'pos',
  tags: ['etf'],
  ...over,
})

describe('newsContentHashFor — material change detection', () => {
  test('stable for identical content, changes only on material fields', () => {
    const a = toNewsItem(scored(), okSource(), T0)
    const b = toNewsItem(scored(), okSource(), T0 + 999_999) // same content, later ingest
    assert.equal(a.contentHash, b.contentHash, 'timestamps must not affect the fingerprint')

    const rewritten = toNewsItem(scored({ title: 'BlackRock spot ETF approval REVERSED' }), okSource(), T0)
    assert.notEqual(a.contentHash, rewritten.contentHash)

    const rescored = toNewsItem(scored({ level: 'med', dir: 'flat' }), okSource(), T0)
    assert.notEqual(a.contentHash, rescored.contentHash)

    // Score jitter is NOT material (it is volatile, not a correction).
    assert.equal(newsContentHashFor({ ...a, score: 99, contentHash: undefined }), newsContentHashFor({ ...a, score: 0, contentHash: undefined }))
  })
})

describe('revisionDocFor / newsRevisionIdFor — deterministic, rights-safe', () => {
  test('same item + same content = one id; different content = another id', () => {
    const doc = toNewsItem(scored(), okSource(), T0)
    assert.match(doc.contentHash, /^[a-f0-9]{40}$/)
    assert.equal(newsRevisionIdFor(doc._id, doc.contentHash), newsRevisionIdFor(doc._id, doc.contentHash))
    assert.notEqual(newsRevisionIdFor(doc._id, doc.contentHash), newsRevisionIdFor(doc._id, 'deadbeef'))
    assert.equal(newsRevisionIdFor('', doc.contentHash), '')
  })

  test('a "revised" doc captures the PREVIOUS fields and never a body', () => {
    const next = toNewsItem(scored({ title: 'New headline' }), okSource(), T0 + 1000)
    const prev = toNewsItem(scored(), okSource(), T0)
    const rev = revisionDocFor(next, prev, 'revised', T0 + 1000)
    assert.match(rev._id, /^nir_/)
    assert.equal(rev.kind, 'revised')
    assert.equal(rev.itemId, next._id)
    assert.equal(rev.prev.title, prev.title, 'the previous headline is preserved')
    assert.equal(rev.prevContentHash, prev.contentHash)
    assert.ok(!('body' in rev) && !('text' in rev), 'no full text is ever stored on a revision')
  })
})

/** Item model that supports both bulkWrite and find (the real-store path). */
function fakeItemModelWithFind() {
  const store = new Map<string, any>()
  return {
    store,
    async bulkWrite(ops: any[]) {
      let upsertedCount = 0
      for (const op of ops) {
        const id = String(op.updateOne.filter._id)
        if (op.updateOne.upsert && !store.has(id)) {
          store.set(id, { ...op.updateOne.update.$setOnInsert })
          upsertedCount += 1
        } else if (!op.updateOne.upsert && store.has(id)) {
          Object.assign(store.get(id), op.updateOne.update.$set)
        }
      }
      return { upsertedCount }
    },
    find(filter: any) {
      const ids: string[] = filter._id.$in
      const rows = ids.filter((id) => store.has(id)).map((id) => {
        const d = store.get(id)
        return { _id: id, contentHash: d.contentHash, title: d.title, excerpt: d.excerpt, level: d.level, dir: d.dir, tags: d.tags, eventType: d.eventType }
      })
      return { select() { return { lean: async () => rows } } }
    },
  }
}

function fakeRevisionModel() {
  const store = new Map<string, any>()
  return {
    store,
    async bulkWrite(ops: any[]) {
      for (const op of ops) {
        const id = String(op.updateOne.filter._id)
        if (!store.has(id)) store.set(id, { ...op.updateOne.update.$setOnInsert })
      }
      return {}
    },
  }
}

describe('persistNewsItems — writes the revision trail (§60.11)', () => {
  test('first ingest writes one "ingested" revision; identical re-ingest adds none', async () => {
    const items = fakeItemModelWithFind()
    const revs = fakeRevisionModel()
    const sources = { coindesk: okSource() }
    const batch = [scored()]
    const r1 = await persistNewsItems(batch, sources, { NewsItemModel: items, NewsItemRevisionModel: revs, now: new Date(T0) })
    assert.equal(r1.persisted, 1)
    assert.equal(r1.revisions, 1)
    assert.equal(revs.store.size, 1)
    assert.equal([...revs.store.values()][0].kind, 'ingested')

    const r2 = await persistNewsItems(batch, sources, { NewsItemModel: items, NewsItemRevisionModel: revs, now: new Date(T0 + 60_000) })
    assert.equal(r2.persisted, 0)
    assert.equal(r2.duplicates, 1)
    assert.equal(r2.revised, 0)
    assert.equal(revs.store.size, 1, 'identical content must not append a revision')
  })

  test('a materially changed headline updates the envelope AND appends "revised"', async () => {
    const items = fakeItemModelWithFind()
    const revs = fakeRevisionModel()
    const sources = { coindesk: okSource() }
    await persistNewsItems([scored()], sources, { NewsItemModel: items, NewsItemRevisionModel: revs, now: new Date(T0) })
    const id = [...items.store.keys()][0]

    const r = await persistNewsItems([scored({ title: 'Correction: BlackRock ETF filing withdrawn' })], sources, { NewsItemModel: items, NewsItemRevisionModel: revs, now: new Date(T0 + 120_000) })
    assert.equal(r.revised, 1)
    assert.equal(r.revisions, 1)
    assert.equal(revs.store.size, 2, 'ingested + revised')
    // The envelope now shows the new headline; the revision keeps the old one.
    assert.equal(items.store.get(id).title, 'Correction: BlackRock ETF filing withdrawn')
    const revised = [...revs.store.values()].find((x) => x.kind === 'revised')
    assert.equal(revised.prev.title, scored().title)
    assert.equal(revised.itemId, id)
    // ingestedAt must never move (TTL base stays put).
    assert.equal(items.store.get(id).firstSeenAt.getTime(), T0)
  })
})

describe('NewsItemRevision schema — deterministic id, retention', () => {
  test('TTL index mirrors the item envelope ceiling', () => {
    assert.equal(NEWS_RETENTION_SECONDS, 7 * 24 * 3600)
    const idx = NewsItemRevision.schema.indexes()
    const ttl = idx.find(([spec, opts]: any) => spec.at === 1 && opts.expireAfterSeconds === NEWS_RETENTION_SECONDS)
    assert.ok(ttl, 'missing TTL index on news_item_revisions.at')
  })
})
