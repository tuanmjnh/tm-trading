import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { routeEvent } from '../notify/router.mjs'
import {
  DEFAULT_OUTBOX_CONFIG,
  OUTBOX_STATES,
  backoffMs,
  createOutbox,
  dueEntries,
  outboxDoc,
  outboxKeyFor,
  planAttempt,
} from '../notify/outbox.mjs'
import {
  OUTBOX_DRIVER_VERSION,
  drainOutbox,
  enqueueNotification,
  formatTelegramMessage,
} from '../notify/outboxDriver.mjs'

// =============================================================================
//  §7.3 delivery correctness. The state machine must never claim more than the
//  evidence allows, must retry what is retryable, and must surface a message
//  that will never arrive as a dead letter instead of a lost log line.
// =============================================================================

/** Minimal in-memory Mongo look-alike for the four calls the outbox makes. */
function fakeModel(seed = []) {
  const rows = new Map(seed.map((r) => [r._id, { ...r }]))
  const matches = (row, filter = {}) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$lte' in value) return Number(row[key]) <= Number(value.$lte)
    return row[key] === value
  })
  return {
    rows,
    async updateOne(filter, update) {
      const row = rows.get(filter._id)
      if (update.$setOnInsert) {
        if (row) return { upsertedCount: 0, matchedCount: 1 }
        rows.set(filter._id, { ...update.$setOnInsert })
        return { upsertedCount: 1, upsertedId: filter._id, matchedCount: 0 }
      }
      if (row && update.$set) {
        for (const [path, value] of Object.entries(update.$set)) {
          if (path.includes('.')) {
            const [head, tail] = path.split('.')
            row[head] = { ...(row[head] || {}), [tail]: value }
          } else {
            row[path] = value
          }
        }
      }
      if (row && update.$addToSet) {
        for (const [key, value] of Object.entries(update.$addToSet)) {
          const list = Array.isArray(row[key]) ? row[key] : []
          if (!list.includes(value)) row[key] = [...list, value]
        }
      }
      return { matchedCount: row ? 1 : 0 }
    },
    find(filter = {}) {
      let result = [...rows.values()].filter((r) => matches(r, filter))
      const query = {
        sort(spec) {
          const [key, dir] = Object.entries(spec)[0]
          result = [...result].sort((a, b) => (Number(a[key] ?? 0) - Number(b[key] ?? 0)) * (dir < 0 ? -1 : 1))
          return query
        },
        limit(n) { result = result.slice(0, n); return query },
        async lean() { return result.map((r) => ({ ...r })) },
      }
      return query
    },
    async countDocuments(filter = {}) {
      return [...rows.values()].filter((r) => matches(r, filter)).length
    },
  }
}

const ROUTE = routeEvent({ kind: 'risk', priority: 'critical', name: 'risk.halted', title: 'halt', body: 'kill switch' })

describe('outbox — backoff and state machine are pure', () => {
  test('backoff grows exponentially, is capped, and stays inside the jitter band', () => {
    const cfg = { baseMs: 1000, factor: 2, maxMs: 8000, jitter: 0 }
    assert.equal(backoffMs(1, cfg, () => 0.5), 1000)
    assert.equal(backoffMs(2, cfg, () => 0.5), 2000)
    assert.equal(backoffMs(3, cfg, () => 0.5), 4000)
    assert.equal(backoffMs(10, cfg, () => 0.5), 8000, 'capped at maxMs')
    // Jitter ±20%: with rand()=1 the first attempt is base * 1.2; with rand()=0 it is base * 0.8.
    assert.equal(backoffMs(1, { ...cfg, jitter: 0.2 }, () => 1), 1200)
    assert.equal(backoffMs(1, { ...cfg, jitter: 0.2 }, () => 0), 800)
  })

  test('the four §7.3 states are the only ones', () => {
    assert.deepEqual([...OUTBOX_STATES], ['queued', 'sent', 'accepted', 'failed'])
    assert.equal(DEFAULT_OUTBOX_CONFIG.maxAttempts, 6)
  })

  test('success without a message id is only `sent`; with one it is `accepted`', () => {
    const sent = planAttempt({ entry: { attempts: 0 }, outcome: { ok: true }, now: 0 })
    assert.equal(sent.state, 'sent')
    assert.equal(sent.dead, false)
    const accepted = planAttempt({ entry: { attempts: 0 }, outcome: { ok: true, accepted: true, messageId: '42' }, now: 0 })
    assert.equal(accepted.state, 'accepted')
    assert.equal(accepted.messageId, '42')
    // Claiming accepted without an id is not allowed.
    const lying = planAttempt({ entry: { attempts: 0 }, outcome: { ok: true, accepted: true }, now: 0 })
    assert.equal(lying.state, 'sent')
  })

  test('a retryable failure re-queues with backoff; exhaustion dead-letters', () => {
    const first = planAttempt({ entry: { attempts: 0 }, outcome: { ok: false, retryable: true, error: 'HTTP 503' }, now: 10_000, config: { baseMs: 1000, jitter: 0 }, rand: () => 0.5 })
    assert.equal(first.state, 'queued')
    assert.equal(first.attempts, 1)
    assert.equal(first.nextAttemptAt, 11_000)
    assert.equal(first.dead, false)
    assert.equal(first.lastError, 'HTTP 503')

    const last = planAttempt({ entry: { attempts: 5 }, outcome: { ok: false, retryable: true, error: 'HTTP 503' }, now: 0 })
    assert.equal(last.state, 'failed')
    assert.equal(last.dead, true)
    assert.equal(last.nextAttemptAt, null)
  })

  test('a non-retryable failure is terminal immediately', () => {
    const dead = planAttempt({ entry: { attempts: 0 }, outcome: { ok: false, retryable: false, error: 'chat not found' }, now: 0 })
    assert.equal(dead.state, 'failed')
    assert.equal(dead.dead, true)
    assert.match(dead.lastError, /chat not found/)
  })

  test('dueEntries only returns queued rows whose time has come', () => {
    const rows = [
      { _id: 'a', state: 'queued', nextAttemptAt: 100 },
      { _id: 'b', state: 'queued', nextAttemptAt: 300 },
      { _id: 'c', state: 'accepted', nextAttemptAt: null },
      { _id: 'd', state: 'queued', nextAttemptAt: 200 },
    ]
    assert.deepEqual(dueEntries(rows, 250).map((r) => r._id), ['a', 'd'])
  })

  test('one queue row per event per channel: a replay cannot duplicate', () => {
    const a = outboxDoc({ event: { at: 5 }, route: ROUTE, channel: 'telegram', now: 5 })
    const b = outboxDoc({ event: { at: 5 }, route: ROUTE, channel: 'telegram', now: 9999 })
    assert.equal(a._id, b._id)
    assert.equal(a.createdAt, 5)
    assert.equal(a.state, 'queued')
    assert.notEqual(outboxDoc({ event: { at: 5 }, route: ROUTE, channel: 'webPush', now: 5 })._id, a._id)
    assert.match(outboxKeyFor(ROUTE.notifyId, 'telegram'), /^outbox:[0-9a-f]{8}$/)
  })
})

describe('outbox — durable store over an injected model', () => {
  test('enqueue is idempotent, drain retries then dead-letters', async () => {
    const model = fakeModel()
    let clock = 0
    const outbox = createOutbox({ model, now: () => clock, log: { warn: () => {} }, config: { baseMs: 100, factor: 1, jitter: 0, maxAttempts: 2 } })

    const first = await outbox.enqueue({ event: { at: 0 }, route: ROUTE, channels: ['telegram'] })
    assert.deepEqual(first, { inserted: 1, existing: 0 })
    const again = await outbox.enqueue({ event: { at: 0 }, route: ROUTE, channels: ['telegram'] })
    assert.deepEqual(again, { inserted: 0, existing: 1 })

    const failing = async () => ({ ok: false, retryable: true, error: 'HTTP 503' })
    const pass1 = await outbox.drain({ sinks: { telegram: failing }, at: 0 })
    assert.equal(pass1.attempted, 1)
    assert.equal(pass1.dead, 0)
    const row = model.rows.get(`${ROUTE.notifyId}:telegram`)
    assert.equal(row.state, 'queued')
    assert.equal(row.nextAttemptAt, 100, 'backoff scheduled')

    // Not due yet.
    assert.equal((await outbox.drain({ sinks: { telegram: failing }, at: 50 })).attempted, 0)
    const pass2 = await outbox.drain({ sinks: { telegram: failing }, at: 100 })
    assert.equal(pass2.attempted, 1)
    assert.equal(pass2.dead, 1, 'second failure exhausts maxAttempts=2')

    const stats = await outbox.stats()
    assert.equal(stats.failed, 1)
    assert.equal(stats.dead, 1)
    const dead = await outbox.deadLetters()
    assert.equal(dead.length, 1)
    assert.equal(dead[0].lastError, 'HTTP 503')

    // Operator replay puts it back in the queue.
    await outbox.replay(`${ROUTE.notifyId}:telegram`, { at: 200 })
    const replayed = model.rows.get(`${ROUTE.notifyId}:telegram`)
    assert.equal(replayed.state, 'queued')
    assert.equal(replayed.dead, false)
    assert.equal(replayed.attempts, 0)
  })

  test('a missing sink is a non-retryable failure (config fault, not a blip)', async () => {
    const model = fakeModel()
    const outbox = createOutbox({ model, now: () => 0, log: { warn: () => {} } })
    await outbox.enqueue({ event: { at: 0 }, route: ROUTE, channels: ['electron'] })
    const res = await outbox.drain({ sinks: {}, at: 0 })
    assert.equal(res.dead, 1)
    assert.match(model.rows.get(`${ROUTE.notifyId}:electron`).lastError, /sink not configured/)
  })

  test('no model -> every method is a safe no-op', async () => {
    const outbox = createOutbox({ model: null })
    assert.deepEqual(await outbox.enqueue({ event: {}, route: ROUTE, channels: ['telegram'] }), { inserted: 0, existing: 0 })
    assert.deepEqual(await outbox.due(), [])
    assert.deepEqual(await outbox.deadLetters(), [])
    assert.equal((await outbox.stats()).queued, 0)
  })
})

describe('outbox driver — enqueue, evidence, drain', () => {
  const event = { kind: 'risk', priority: 'critical', name: 'risk.halted', title: 'Risk halted', body: 'kill switch on BTCUSDT', symbol: 'BTCUSDT', at: 1000 }

  test('formatTelegramMessage renders only provided fields', () => {
    const msg = formatTelegramMessage({ symbol: 'BTCUSDT', name: 'funding.extreme', title: 'Funding extreme', body: '3.2σ', priority: 'critical', at: Date.UTC(2026, 10, 1, 12, 0, 0) })
    assert.equal(msg, 'BTCUSDT · funding.extreme\nFunding extreme\n3.2σ\nCRITICAL · 2026-11-01 12:00 UTC')
    assert.equal(formatTelegramMessage({ title: 'only a title' }), 'only a title')
    assert.equal(formatTelegramMessage({}), '')
  })

  test('a delivered event is queued and immediately attempted with evidence', async () => {
    const model = fakeModel()
    const logModel = fakeModel()
    const calls = []
    const sinks = { telegram: async (entry) => { calls.push(entry.channel); return { ok: true, accepted: true, messageId: '77' } } }
    const res = await enqueueNotification(event, {
      sinks,
      getModels: async () => ({ outboxModel: model, logModel }),
      now: () => 5000,
      log: { warn: () => {} },
    })
    // A critical event routes to all three channels; only telegram has a sink.
    assert.equal(res.queued, 3)
    assert.deepEqual(res.delivered, ['telegram'])
    assert.equal(calls.length, 1)
    const row = model.rows.get(`${res.notifyId}:telegram`)
    assert.equal(row.state, 'accepted')
    assert.equal(row.messageId, '77')
    assert.equal(row.category, 'signal', 'the §7.1 category is stamped on the queue row')
    // The ledger keeps the immutable first-attempt audit plus a derived projection.
    const ledger = logModel.rows.get(`${res.notifyId}:1000`)
    assert.equal(ledger.delivered.includes('telegram'), true)
    assert.equal(ledger.delivery.telegram.state, 'accepted')
  })

  test('the drain tick retries a due failure and can dead-letter it', async () => {
    const model = fakeModel()
    const sinks = { telegram: async () => ({ ok: false, retryable: false, error: 'chat not found' }) }
    await enqueueNotification(event, { sinks, getModels: async () => ({ outboxModel: model, logModel: null }), now: () => 5000, log: { warn: () => {} } })
    // The immediate attempt already dead-lettered telegram (non-retryable), and
    // the two unconfigured channels with it.
    const stats = await createOutbox({ model }).stats()
    assert.equal(stats.dead, 3)
    assert.equal(model.rows.get(`${routeEvent(event).notifyId}:telegram`).state, 'failed')
    const drained = await drainOutbox({ sinks, getModels: async () => ({ outboxModel: model, logModel: null }), log: { warn: () => {} } })
    assert.equal(drained.attempted, 0, 'a dead letter is not retried implicitly')
  })

  test('policy suppression is recorded as a decision, not a delivery failure', async () => {
    const model = fakeModel()
    const res = await enqueueNotification(event, {
      settings: { categories: { signal: { enabled: false } } },
      getModels: async () => ({ outboxModel: model, logModel: null }),
      log: { warn: () => {} },
    })
    assert.equal(res.suppressed, true)
    assert.equal(res.queued, 0)
    assert.equal(res.decision.reason, 'category-disabled')
    assert.equal(model.rows.size, 0, 'nothing is queued for a suppressed event')
  })

  test('an invalid event is refused by the router, never queued', async () => {
    const res = await enqueueNotification({ kind: 'astrology', priority: 'critical' }, { getModels: async () => ({ outboxModel: fakeModel(), logModel: null }), log: { warn: () => {} } })
    assert.equal(res, null)
  })

  test('models unavailable -> fail-soft, nothing queued, no throw', async () => {
    const res = await enqueueNotification(event, { getModels: async () => { throw new Error('mongo down') }, log: { warn: () => {} } })
    assert.equal(res.queued, 0)
    assert.equal(res.enqueued, false)
    assert.equal(OUTBOX_DRIVER_VERSION, 'notify-outbox-driver.v1')
    const drained = await drainOutbox({ getModels: async () => { throw new Error('mongo down') }, log: { warn: () => {} } })
    assert.deepEqual(drained, { attempted: 0, accepted: 0, sent: 0, dead: 0 })
  })
})
