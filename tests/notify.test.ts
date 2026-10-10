import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTER_VERSION,
  NOTIFICATION_KINDS,
  PRIORITIES,
  DEFAULT_ROUTING,
  CRITICAL_PRESETS,
  notifyHash,
  notifyDedupeKey,
  routeEvent,
} from '../notify/router.mjs'
import { dispatch, notificationLogDoc } from '../notify/send.mjs'

// =============================================================================
//  §25 Notification Router — pure routing decisions + audited dispatch.
//  Every failure path (missing sink, throwing sink, dead Mongo) must still
//  produce an honest record — never a silent success.
// =============================================================================

describe('routeEvent (§25 priorities + channels)', () => {
  test('ladders are explicit; presets carry the §25 critical defaults', () => {
    assert.deepEqual([...PRIORITIES], ['critical', 'important', 'normal', 'info'])
    assert.ok(NOTIFICATION_KINDS.includes('risk'))
    assert.equal(CRITICAL_PRESETS['service.overdue'].priority, 'critical')
    assert.equal(CRITICAL_PRESETS['risk.halted'].kind, 'risk')
  })

  test('critical reaches every configured channel; info only desktop', () => {
    assert.deepEqual(routeEvent({ preset: 'risk.halted' }).channels, ['telegram', 'webPush', 'electron'])
    const info = routeEvent({ kind: 'signal', priority: 'info', title: 'daily recap' })
    assert.deepEqual(info.channels, ['electron'])
    assert.equal(info.skipped.find((s) => s.channel === 'telegram').reason.includes('below floor'), true)
  })

  test('floor is inclusive (normal == webPush floor -> webPush in)', () => {
    const r = routeEvent({ kind: 'service', priority: 'normal', name: 'brief.done' })
    assert.ok(r.channels.includes('webPush'))
    assert.ok(!r.channels.includes('telegram'))
  })

  test('unknown priority/kind/preset -> null (never downgraded silently)', () => {
    assert.equal(routeEvent({ kind: 'risk', priority: 'urgent' }), null)
    assert.equal(routeEvent({ kind: 'astrology', priority: 'critical' }), null)
    assert.equal(routeEvent({ preset: 'not.a.preset' }), null)
  })

  test('identity: same event -> same notifyId; body change -> different key', () => {
    const a = routeEvent({ kind: 'order', name: 'fill', symbol: 'BTCUSDT', title: 'filled', body: '0.5 BTC @ 60000' })
    const b = routeEvent({ kind: 'order', name: 'fill', symbol: 'BTCUSDT', title: 'filled', body: '0.5 BTC @ 60000' })
    const c = routeEvent({ kind: 'order', name: 'fill', symbol: 'BTCUSDT', title: 'filled', body: '0.5 BTC @ 61000' })
    assert.equal(a.notifyId, b.notifyId)
    assert.notEqual(a.notifyId, c.notifyId)
    assert.match(a.notifyId, /^nl:[0-9a-f]{8}$/)
  })

  test('routing floors are overridable per call', () => {
    const r = routeEvent({ kind: 'position', priority: 'normal', name: 'tp1' }, { routing: { ...DEFAULT_ROUTING, telegram: 'critical' } })
    assert.ok(!r.channels.includes('telegram'))
  })

  test('notifyHash is deterministic; dedupeKey normalizes whitespace', () => {
    assert.equal(notifyHash('abc'), notifyHash('abc'))
    assert.equal(notifyDedupeKey({ name: 'x', title: ' A ', body: 'B' }), notifyDedupeKey({ name: 'x', title: 'A', body: 'B' }))
  })
})

describe('dispatch (§25 audited delivery)', () => {
  const okSink = async () => true
  const okLog = () => {
    const rows = []
    return {
      rows,
      model: {
        async updateOne(f, p) {
          const existing = rows.find((r) => r._id === f._id)
          if (!existing) rows.push({ ...p.$setOnInsert })
          return { upsertedCount: existing ? 0 : 1 }
        },
        // Mongoose findOne() returns a THENABLE query (sync), not a Promise —
        // dispatch() calls findOne(...).lean() directly.
        findOne() { return query(null) },
      },
    }
  }
  const query = (v) => ({ lean: async () => v })

  test('happy path: delivered channels recorded + audit row written', async () => {
    const { rows, model } = okLog()
    const res = await dispatch(
      { kind: 'risk', priority: 'critical', title: 'Risk halted', body: 'kill switch', symbol: 'BTCUSDT', at: 1000 },
      { sinks: { telegram: okSink, webPush: okSink, electron: okSink }, logModel: model, now: 2000 },
    )
    assert.deepEqual(res.delivered, ['telegram', 'webPush', 'electron'])
    assert.equal(res.logged, true)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]._id, `${res.notifyId}:1000`) // D4 idempotent key
    assert.equal(rows[0].at, 1000)
    assert.equal(rows[0].sentAt, 2000)
    assert.equal(rows[0].routerVersion, ROUTER_VERSION)
    assert.equal(rows[0].delivered.length, 3)
  })

  test('replay with same event time -> one audit row (D4 first-wins)', async () => {
    const { rows, model } = okLog()
    const sinks = { telegram: okSink }
    await dispatch({ kind: 'risk', priority: 'critical', title: 'halted', body: 'x', at: 1000 }, { sinks, logModel: model, now: 2000 })
    await dispatch({ kind: 'risk', priority: 'critical', title: 'halted', body: 'x', at: 1000 }, { sinks, logModel: model, now: 3000 })
    assert.equal(rows.length, 1)
  })

  test('missing sink -> attempt recorded as failed, never faked ok', async () => {
    const res = await dispatch(
      { preset: 'paper.stale', title: 'paper stale', body: 'no tick 10m' },
      { sinks: {}, logModel: null },
    )
    assert.deepEqual(res.delivered, [])
    assert.ok(res.attempts.every((a) => a.ok === false && a.error === 'sink not configured'))
  })

  test('throwing sink -> other channels still delivered (fail-soft per channel)', async () => {
    const res = await dispatch(
      { kind: 'position', priority: 'critical', title: 'SL hit', body: 'BTCUSDT' },
      { sinks: { telegram: async () => { throw new Error('network down') }, webPush: okSink }, logModel: null },
    )
    assert.deepEqual(res.delivered, ['webPush', 'electron'].filter((c) => res.attempts.find((a) => a.channel === c)?.ok))
    assert.equal(res.attempts.find((a) => a.channel === 'telegram').error, 'network down')
    assert.ok(res.attempts.some((a) => a.channel === 'electron' && a.error === 'sink not configured'))
  })

  test('invalid event -> null + warn (never silent)', async () => {
    const warns = []
    const res = await dispatch({ kind: 'risk', priority: 'ASAP' }, { log: { warn: (m) => warns.push(m) } })
    assert.equal(res, null)
    assert.equal(warns.length, 1)
    assert.match(warns[0], /rejected/)
  })

  test('dead Mongo (logModel null) -> still delivered, logged=false', async () => {
    const res = await dispatch({ kind: 'service', priority: 'important', title: 'x', body: 'y' }, { sinks: { telegram: okSink }, logModel: null })
    assert.deepEqual(res.delivered, ['telegram'])
    assert.equal(res.logged, false)
  })

  test('dedupe window: identical event inside the window -> deduped row, no re-ping', async () => {
    const seen = { prev: null }
    const logModel = {
      async updateOne(f, p, opts) {
        if (!seen.prev) seen.prev = { ...p.$setOnInsert }
        return { upsertedCount: 1 }
      },
      findOne(f) { return query(f.notifyId ? seen.prev : null) },
    }
    const first = await dispatch({ kind: 'service', priority: 'important', name: 'err', title: 't', body: 'b' }, { sinks: { telegram: okSink }, logModel, dedupeWindowMs: 3_600_000, now: 100 })
    assert.equal(first.deduped, false)
    const second = await dispatch({ kind: 'service', priority: 'important', name: 'err', title: 't', body: 'b' }, { sinks: { telegram: okSink }, logModel, dedupeWindowMs: 3_600_000, now: 200 })
    assert.equal(second.deduped, true)
    assert.equal(second.delivered.length, 0) // no re-ping
  })

  test('notificationLogDoc clamps long bodies (bounded audit rows)', () => {
    const route = routeEvent({ kind: 'order', name: 'fill', title: 't', body: 'x'.repeat(5000) })
    const doc = notificationLogDoc({ event: { kind: 'order', name: 'fill', title: 't', body: 'x'.repeat(5000) }, route, attempts: [], delivered: [], now: 5 })
    assert.equal(doc.body.length, 2000)
  })
})