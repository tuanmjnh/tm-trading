import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// Offline suite: blank the URI (tsx auto-loads the repo .env) so the fail-soft
// paths (getNewsSource -> null) run deterministically without a live Mongo.
process.env.MONGODB_URI = ''
import {
  backoffDelay,
  BREAKER_STATES,
  classifyStatus,
  createBreaker,
  deadLetterRecord,
  fetchWithRetry,
  isRetryable,
  looksLikeFeed,
  NEWS_FETCH_DEFAULTS,
} from '../engine/newsFetch.mjs'
import { NEWS_RETENTION_SECONDS } from '../engine/newsIngest.mjs'
import { countDeadLetters, persistDeadLetters, requestNewsRetry, updateSourceHealth } from '../services/newsStore.mjs'
import { fetchFeed, runNews } from '../services/news.mjs'

// =============================================================================
//  Connector resilience — V3.5 §60.5 / §60.16 Slice F.
//
//  Locks the four things that were missing from the connector path: retry
//  classification (never retry the permanent), bounded exponential backoff,
//  a per-source circuit breaker, and a rights-safe dead-letter queue for
//  payloads that are not feeds. Offline: injected clocks, sleeps and fetches.
// =============================================================================

const T0 = 1_790_000_000_000
const rssBody = (link = 'https://x.test/a') => `<rss><channel><item><title>Bitcoin ETF approval drives inflows</title><link>${link}</link><pubDate>Wed, 15 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`
const res = (status: number, body = rssBody(), extra: Record<string, unknown> = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
  ...extra,
})

describe('connector policy — classify what may be retried (§60.5)', () => {
  test('2xx ok; 408/425/429 and 5xx retryable; the rest permanent', () => {
    assert.equal(classifyStatus(200), 'ok')
    assert.equal(classifyStatus(204), 'ok')
    assert.equal(classifyStatus(429), 'retry')
    assert.equal(classifyStatus(408), 'retry')
    assert.equal(classifyStatus(503), 'retry')
    assert.equal(classifyStatus(500), 'retry')
    // Permission/credential/licence problems must NOT be retried forever.
    assert.equal(classifyStatus(401), 'permanent')
    assert.equal(classifyStatus(403), 'permanent')
    assert.equal(classifyStatus(404), 'permanent')
    assert.equal(classifyStatus(451), 'permanent')
    assert.equal(classifyStatus(undefined), 'network')
    assert.equal(classifyStatus(0), 'network')
    assert.equal(isRetryable('ok'), false)
    assert.equal(isRetryable('permanent'), false)
    assert.equal(isRetryable('retry'), true)
  })

  test('backoff is exponential, capped, and jitter stays inside the band', () => {
    const base = { baseMs: 100, maxMs: 1000, jitterRatio: 0.5 }
    assert.equal(backoffDelay(1, { ...base, jitter: 0.5 }), 100) // no jitter offset at the midpoint draw
    assert.equal(backoffDelay(2, { ...base, jitter: 0.5 }), 200)
    assert.equal(backoffDelay(3, { ...base, jitter: 0.5 }), 400)
    assert.equal(backoffDelay(9, { ...base, jitter: 0.5 }), 1000) // capped
    assert.equal(backoffDelay(1, { ...base, jitter: 0 }), 50) // -50%
    assert.equal(backoffDelay(1, { ...base, jitter: 1 }), 150) // +50%
    // Out-of-range draws cannot escape the band.
    assert.equal(backoffDelay(1, { ...base, jitter: -3 }), 50)
    assert.equal(backoffDelay(1, { ...base, jitter: 9 }), 150)
  })
})

describe('per-source circuit breaker (§60.5)', () => {
  const cfg = { breakerThreshold: 3, breakerCooldownMs: 60_000 }

  test('opens after N consecutive failures and blocks attempts while open', () => {
    const b = createBreaker(cfg)
    assert.equal(b.state('s', T0), 'closed')
    assert.equal(b.allow('s', T0), true)
    b.record('s', { ok: false, at: T0 + 1, error: 'HTTP 429' })
    b.record('s', { ok: false, at: T0 + 2, error: 'HTTP 429' })
    assert.equal(b.state('s', T0 + 2), 'closed', 'two failures is not yet an outage')
    b.record('s', { ok: false, at: T0 + 3, error: 'HTTP 429' })
    assert.equal(b.state('s', T0 + 3), 'open')
    assert.equal(b.allow('s', T0 + 30_000), false, 'an open breaker must not be attempted')
    assert.equal(b.snapshot().s.lastError, 'HTTP 429')
  })

  test('after the cooldown it half-opens, and one success closes it', () => {
    const b = createBreaker(cfg)
    for (let i = 0; i < 3; i++) b.record('s', { ok: false, at: T0 })
    assert.equal(b.state('s', T0 + 60_000), 'half_open')
    assert.equal(b.allow('s', T0 + 60_000), true)
    b.record('s', { ok: true, at: T0 + 61_000 })
    assert.equal(b.state('s', T0 + 61_000), 'closed')
    assert.equal(b.snapshot().s.fails, 0)
  })

  test('a failed trial RESTARTS the cooldown (it cannot be retried every cycle)', () => {
    const b = createBreaker(cfg)
    for (let i = 0; i < 3; i++) b.record('s', { ok: false, at: T0 })
    const trialAt = T0 + 60_000
    b.record('s', { ok: false, at: trialAt, error: 'still down' })
    assert.equal(b.state('s', trialAt + 1_000), 'open', 'the cooldown must restart after a failed trial')
    assert.equal(b.state('s', trialAt + 60_000), 'half_open')
    assert.deepEqual(BREAKER_STATES, ['closed', 'open', 'half_open'])
  })

  test('breakers are per source (one broken feed does not close the others)', () => {
    const b = createBreaker(cfg)
    for (let i = 0; i < 3; i++) b.record('bad', { ok: false, at: T0 })
    assert.equal(b.allow('bad', T0 + 1), false)
    assert.equal(b.allow('good', T0 + 1), true)
  })
})

describe('fetchWithRetry — bounded attempts, honest outcomes', () => {
  const fast = { policy: { baseMs: 1, maxMs: 4, maxAttempts: 3, jitterRatio: 0 }, sleep: async () => {}, jitter: 0.5 }

  test('429 then 200: retries once and succeeds, recording the delay', async () => {
    const delays: number[] = []
    const seq = [res(429), res(200)]
    let n = 0
    const r = await fetchWithRetry('https://x.test/feed', {
      ...fast,
      fetchImpl: async () => seq[n++],
      sleep: async (ms: number) => { delays.push(ms) },
    } as never)
    assert.equal(r.ok, true)
    assert.equal(r.attempts, 2)
    assert.equal(n, 2)
    assert.deepEqual(delays, [1], 'one backoff between the two attempts')
  })

  test('a permanent 403 is attempted ONCE (no retry, no outage alarm)', async () => {
    let n = 0
    const r = await fetchWithRetry('https://x.test/feed', {
      ...fast,
      fetchImpl: async () => { n++; return res(403) },
    } as never)
    assert.equal(r.ok, false)
    assert.equal(r.attempts, 1)
    assert.equal(n, 1)
    assert.equal(r.kind, 'permanent')
    assert.equal(r.reason, 'permanent_error')
  })

  test('exhausting attempts on 5xx reports the schedule it actually waited', async () => {
    const delays: number[] = []
    const r = await fetchWithRetry('https://x.test/feed', {
      policy: { maxAttempts: 3, baseMs: 100, maxMs: 800, jitterRatio: 0 },
      jitter: 0.5,
      fetchImpl: async () => res(503),
      sleep: async (ms: number) => { delays.push(ms) },
    } as never)
    assert.equal(r.ok, false)
    assert.equal(r.attempts, 3)
    assert.equal(r.reason, 'exhausted')
    assert.deepEqual(delays, [100, 200], 'exponential with no jitter offset')
  })

  test('a transport error is retryable (nothing in the response said stop)', async () => {
    let n = 0
    const r = await fetchWithRetry('https://x.test/feed', {
      ...fast,
      fetchImpl: async () => { n++; throw new Error('ECONNRESET') },
    } as never)
    assert.equal(r.ok, false)
    assert.equal(n, 3)
    assert.equal(r.kind, 'network')
    assert.match(String(r.error), /ECONNRESET/)
  })

  test('an open breaker short-circuits BEFORE the network call', async () => {
    const breaker = createBreaker({ breakerThreshold: 1, breakerCooldownMs: 60_000 })
    let calls = 0
    const fetchImpl = async () => { calls++; return res(503) }
    const first = await fetchWithRetry('https://x.test/feed', { ...fast, policy: { maxAttempts: 1 }, fetchImpl, breaker } as never)
    assert.equal(first.ok, false)
    assert.equal(calls, 1)
    assert.equal(breaker.state('https://x.test/feed'), 'open')
    const second = await fetchWithRetry('https://x.test/feed', { ...fast, fetchImpl, breaker } as never)
    assert.equal(second.ok, false)
    assert.equal(second.reason, 'breaker_open')
    assert.equal(second.attempts, 0)
    assert.equal(calls, 1, 'a blocked source must not be fetched at all')
  })

  test('a shim with only `ok` is honoured (no invented retry storm)', async () => {
    let n = 0
    const r = await fetchWithRetry('https://x.test/feed', {
      ...fast,
      fetchImpl: async () => { n++; return { ok: true, text: async () => rssBody() } },
    } as never)
    assert.equal(r.ok, true)
    assert.equal(n, 1)
    assert.equal(r.status, 200)
  })

  test('defaults are bounded (§60.5: bounded retries, request timeout)', () => {
    assert.equal(NEWS_FETCH_DEFAULTS.maxAttempts, 3)
    assert.ok(NEWS_FETCH_DEFAULTS.timeoutMs > 0)
    assert.ok(NEWS_FETCH_DEFAULTS.maxMs >= NEWS_FETCH_DEFAULTS.baseMs)
  })
})

/** In-memory `news_dead_letters` model: upsert by deterministic id, `fails` increments. */
function newsDeadLetterModel() {
  const docs = new Map<string, Record<string, any>>()
  return {
    docs,
    async updateOne(filter: Record<string, any>, update: Record<string, any>) {
      const id = String(filter._id)
      const cur = docs.get(id)
      if (cur) {
        cur.fails += update.$inc?.fails || 0
        Object.assign(cur, update.$set || {})
        return { acknowledged: true }
      }
      docs.set(id, {
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
        fails: update.$inc?.fails || 0,
      })
      return { acknowledged: true, upsertedCount: 1, upsertedId: id }
    },
    async countDocuments() { return docs.size },
  }
}

describe('dead-letter queue — malformed is reviewable, and rights-safe', () => {
  test('looksLikeFeed separates "not a feed" from "empty feed"', () => {
    assert.equal(looksLikeFeed(rssBody()), true)
    assert.equal(looksLikeFeed('<?xml version="1.0"?><rdf:RDF></rdf:RDF>'), true)
    assert.equal(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true)
    assert.equal(looksLikeFeed('<html><body>403 Forbidden</body></html>'), false)
    assert.equal(looksLikeFeed(''), false)
    assert.equal(looksLikeFeed(undefined), false)
  })

  test('the record proves WHAT failed without keeping the body', () => {
    const big = `<html>${'x'.repeat(5000)}</html>`
    const r = deadLetterRecord({ sourceId: 'coindesk', url: 'https://x.test/feed', at: T0, reason: 'malformed_payload', status: 200, attempts: 1, text: big })
    assert.match(r._id, /^ndl_/)
    assert.equal(r.bytes, big.length)
    assert.ok(r.payloadHash)
    assert.equal(Object.keys(r).includes('text'), false, 'the payload body must never be stored')
    assert.equal(JSON.stringify(r).includes('xxxx'), false, 'no excerpt of the body may leak')
    // Deterministic id: the same failure is ONE row, not one per cycle.
    assert.equal(r._id, deadLetterRecord({ sourceId: 'coindesk', url: 'https://x.test/feed', at: T0 + 99, reason: 'malformed_payload' })._id)
    assert.notEqual(r._id, deadLetterRecord({ sourceId: 'coindesk', url: 'https://x.test/feed', at: T0, reason: 'empty_feed' })._id)
  })

  const fakeModel = () => newsDeadLetterModel()

  test('a repeat failure updates ONE row and increments fails', async () => {
    const Model = newsDeadLetterModel()
    const rec = { sourceId: 'coindesk', url: 'https://x.test/feed', reason: 'malformed_payload', status: 200, attempts: 1, text: '<html>nope</html>' }
    const first = await persistDeadLetters([rec], { NewsDeadLetterModel: Model, now: new Date(T0) })
    assert.deepEqual(first, { queued: 1, updated: 0, skipped: 0 })
    assert.equal(Model.docs.size, 1)
    assert.equal([...Model.docs.values()][0].fails, 1, 'the insert must count as the first failure, not a conflict')

    const second = await persistDeadLetters([rec], { NewsDeadLetterModel: Model, now: new Date(T0 + 600_000) })
    assert.deepEqual(second, { queued: 0, updated: 1, skipped: 0 })
    assert.equal(Model.docs.size, 1)
    const row = [...Model.docs.values()][0]
    assert.equal(row.fails, 2)
    assert.equal(new Date(row.lastFailedAt).getTime(), T0 + 600_000)
  })

  test('counting is fail-soft and never reports a false zero (D12)', async () => {
    assert.equal(await countDeadLetters({ NewsDeadLetterModel: fakeModel() }), 0)
    // A failing count must come back UNKNOWN (null), never as "no problems".
    const broken = { countDocuments: async () => { throw new Error('mongo down') } }
    assert.equal(await countDeadLetters({ NewsDeadLetterModel: broken }), null)
  })

  test('the queue is TTL-bounded like the items it is about', () => {
    const src = readFileSync(new URL('../engine/models/newsDeadLetter.mjs', import.meta.url), 'utf8')
    assert.match(src, /expireAfterSeconds: NEWS_RETENTION_SECONDS/)
    assert.equal(NEWS_RETENTION_SECONDS, 7 * 24 * 3600)
  })
})

describe('the news service actually uses the resilient path', () => {
  const src = readFileSync(new URL('../services/news.mjs', import.meta.url), 'utf8')

  test('source guards: retry path, breaker, dead letters are wired', () => {
    assert.match(src, /import \{ createBreaker, fetchWithRetry, looksLikeFeed \}/)
    assert.match(src, /const res = await fetchWithRetry\(feed\.url, \{/)
    assert.match(src, /const deadLetterRes = await persistDeadLetters\(deadLetters, \{ now, NewsDeadLetterModel: deadLetterModel \}\)/)
    assert.match(src, /reason: feedShaped \? 'empty_feed' : 'malformed_payload'/)
  })

  // A valid feed with no usable items (low-signal headline) keeps the assertion
  // about SOURCE STATE, not about scoring/telemetry side effects.
  const lowSignal = () => `<rss><channel><item><title>Weekly market recap</title><link>https://x.test/recap</link></item></channel></rss>`
  const seedOne = async (enabled: string[]) => Object.fromEntries(
    ['coindesk', 'cointelegraph', 'decrypt', 'cryptopanic', 'federalreserve', 'sec_edgar', 'ecb', 'bls_cpi', 'bls_empsit', 'bls_ppi', 'bls_jolts', 'eia', 'vnexpress'].map((id) => [
      id,
      { sourceId: id, enabled: enabled.includes(id), licenseStatus: 'ok', rights: { allowedDisplay: true }, marketGroups: ['crypto'], languages: ['en'] },
    ]),
  )

  const feed = { name: 'coindesk', url: 'https://x.test/feed' }

  test('fetchFeed: a non-feed 200 is DOWN, a shaped empty feed is merely degraded', async () => {
    const bad = await fetchFeed(feed, (async () => res(200, '<html><body>maintenance</body></html>')) as never, { breaker: null } as never)
    assert.equal(bad.ok, false, 'HTML is not a feed — this must not look like a quiet empty cycle')
    assert.equal(bad.reason, 'malformed_payload')
    assert.equal(bad.items.length, 0)
    assert.equal(bad.deadLetter?.reason, 'malformed_payload')

    const empty = await fetchFeed(feed, (async () => res(200, '<rss><channel></channel></rss>')) as never, { breaker: null } as never)
    assert.equal(empty.ok, true, 'a well-formed feed with nothing in it is degraded, not down')
    assert.equal(empty.reason, 'empty_feed')
    assert.equal(empty.deadLetter?.reason, 'empty_feed', 'still reviewable: "nobody published" vs "our parser broke"')

    const good = await fetchFeed(feed, (async () => res(200, rssBody())) as never, { breaker: null } as never)
    assert.equal(good.ok, true)
    assert.equal(good.items.length, 1)
    assert.equal(good.deadLetter, null, 'a healthy payload must not pollute the review queue')
  })

  test('a real BLS program feed between releases is ok + empty_feed, never down', async () => {
    const bls = { name: 'bls_empsit', url: 'https://www.bls.gov/feed/empsit.rss' }
    const between = await fetchFeed(
      bls,
      (async () => res(200, '<rss version="2.0"><channel><title>Employment Situation</title></channel></rss>', { 'content-type': 'application/rss+xml' })) as never,
      { breaker: null } as never,
    )
    assert.equal(between.ok, true, 'a program feed is empty until release day — that is not an outage')
    assert.equal(between.reason, 'empty_feed')
    assert.equal(between.items.length, 0)
  })

  test('runNews: the only source answering with HTML fails the cycle AND queues a review row', async () => {
    const Model = newsDeadLetterModel()
    const r = runNews({
      fetchImpl: (async () => res(200, '<html>blocked</html>')) as never,
      now: new Date(T0),
      seedImpl: (async () => seedOne(['coindesk'])) as never,
      deadLetterModel: Model,
    } as never)
    await assert.rejects(r, /tat ca feed chet/, 'a connector returning HTML must not look like a quiet market')
    assert.equal(Model.docs.size, 1)
    const row = [...Model.docs.values()][0]
    assert.equal(row.sourceId, 'coindesk')
    assert.equal(row.reason, 'malformed_payload')
    assert.match(String(row.payloadHash), /^[a-f0-9]{40}$/)
  })
})

/** In-memory `news_sources` model for the manual-retry path (§60.12). */
function sourceModel(rows: Array<Record<string, any>>) {
  const docs = new Map(rows.map((r) => [String(r._id), { ...r }]))
  return {
    docs,
    find(filter: any) {
      const out = filter?._id?.$in
        ? [...docs.values()].filter((d) => filter._id.$in.includes(d._id))
        : [...docs.values()].filter((d) => d.enabled !== false)
      return { select() { return { lean: async () => out } } }
    },
    async updateMany(filter: any, update: any) {
      for (const d of docs.values()) if (filter._id.$in.includes(d._id)) Object.assign(d, update.$set)
      return { modifiedCount: filter._id.$in.length }
    },
    async bulkWrite(ops: any[]) {
      for (const op of ops) {
        const d = docs.get(String(op.updateOne.filter._id))
        if (d) Object.assign(d, op.updateOne.update.$set || {})
      }
      return { ok: 1 }
    },
  }
}

describe('manual reprocessing — a retry request bypasses cadence (§60.12)', () => {
  test('requestNewsRetry stamps the named sources and reports unknown ids', async () => {
    const Model = sourceModel([{ _id: 'coindesk', enabled: true }, { _id: 'ecb', enabled: true }])
    const r = await requestNewsRetry(['coindesk', 'nope'], { NewsSourceModel: Model, now: new Date(T0) })
    assert.deepEqual(r.requested, ['coindesk'])
    assert.deepEqual(r.missing, ['nope'])
    assert.equal(Model.docs.get('coindesk').retryRequestedAt.getTime(), T0)
    assert.equal(Model.docs.get('ecb').retryRequestedAt, undefined, 'an unrequested source is untouched')
  })

  test('an empty request retries every enabled source', async () => {
    const Model = sourceModel([{ _id: 'a', enabled: true }, { _id: 'b', enabled: false }])
    const r = await requestNewsRetry([], { NewsSourceModel: Model, now: new Date(T0) })
    assert.deepEqual(r.requested, ['a'], 'a disabled source is never force-polled')
  })

  test('Mongo down is reported, never a false success', async () => {
    const r = await requestNewsRetry(['a'], { NewsSourceModel: null })
    assert.deepEqual(r, { requested: [], missing: [], mongo: 'down' })
  })

  test('a stamped source is polled even though its cadence has not elapsed', async () => {
    const ALL = ['coindesk', 'cointelegraph', 'decrypt', 'cryptopanic', 'federalreserve', 'sec_edgar', 'ecb', 'bls_cpi', 'bls_empsit', 'bls_ppi', 'bls_jolts', 'eia', 'vnexpress']
    const seed = (retryRequestedAt?: Date) => Object.fromEntries(ALL.map((id) => [
      id,
      id === 'coindesk'
        ? { sourceId: id, enabled: true, licenseStatus: 'ok', rights: { allowedDisplay: true }, marketGroups: ['crypto'], languages: ['en'], pollIntervalSec: 3600, health: { lastOkAt: new Date(T0 - 60_000) }, retryRequestedAt }
        : { sourceId: id, enabled: false, licenseStatus: 'ok', rights: { allowedDisplay: true }, marketGroups: ['crypto'], languages: ['en'] },
    ]))
    const Model = newsDeadLetterModel()
    // No retry: last success 60s ago, interval 3600s -> NOT due -> nothing to poll.
    const quiet = await runNews({
      fetchImpl: (async () => res(200, rssBody())) as never,
      now: new Date(T0),
      seedImpl: (async () => seed()) as never,
      deadLetterModel: Model,
    } as never)
    assert.equal(quiet.feeds, 0)
    assert.deepEqual(quiet.skippedByCadence, ['coindesk'])
    // A retry stamped after the last success forces the poll.
    const forced = await runNews({
      fetchImpl: (async () => res(200, rssBody())) as never,
      now: new Date(T0),
      seedImpl: (async () => seed(new Date(T0 - 30_000))) as never,
      deadLetterModel: Model,
    } as never)
    assert.equal(forced.feeds, 1, 'the retried source must be fetched')
    assert.equal((forced.skippedByCadence as string[]).includes('coindesk'), false)
  })

  test('a successful fetch clears the retry stamp (it is honoured once)', async () => {
    const Model = sourceModel([{ _id: 'coindesk', enabled: true, retryRequestedAt: new Date(T0) }])
    await updateSourceHealth(
      [{ sourceId: 'coindesk', ok: true, itemCount: 1, error: null }],
      { NewsSourceModel: Model, now: new Date(T0 + 1_000) },
    )
    assert.equal(Model.docs.get('coindesk').retryRequestedAt, null)
  })

  test('a failed fetch KEEPS the retry stamp (it must be retried again)', async () => {
    const Model = sourceModel([{ _id: 'coindesk', enabled: true, retryRequestedAt: new Date(T0) }])
    await updateSourceHealth(
      [{ sourceId: 'coindesk', ok: false, itemCount: 0, error: 'HTTP 503' }],
      { NewsSourceModel: Model, now: new Date(T0 + 1_000) },
    )
    assert.equal(Model.docs.get('coindesk').retryRequestedAt.getTime(), T0, 'a still-failing retry stays queued')
  })
})
