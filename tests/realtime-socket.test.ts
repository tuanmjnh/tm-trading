import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import type { MarketBus, MarketEvent, MarketPlane, Unsub } from '../server/utils/market-plane'
import { createRealtimeHub, loadRealtimeCore } from '../server/utils/realtime-hub'
import type { RealtimeHub, RealtimeCore } from '../server/utils/realtime-hub'

// ---------------------------------------------------------------------------
// The realtime core is dependency-free (realtime/*.mjs) — load it through the
// hub's own pathToFileURL loader so the test exercises the SAME code the server
// does, without the test importing .mjs directly (keeps vue-tsc happy).
// ---------------------------------------------------------------------------
let core!: RealtimeCore
before(async () => { core = await loadRealtimeCore() })

function fakePlane(): MarketPlane & { emit(topic: string, event: MarketEvent): number; subscriptions(): number } {
  const subs = new Map<string, Set<(event: MarketEvent) => void>>()
  const bus: MarketBus = {
    on(topic, handler) {
      let set = subs.get(topic)
      if (!set) { set = new Set(); subs.set(topic, set) }
      set.add(handler)
      return (() => { set.delete(handler) }) as Unsub
    },
    emit(topic, event) {
      const set = subs.get(topic)
      if (!set) return 0
      let n = 0
      for (const fn of [...set]) { fn(event); n++ }
      return n
    },
    subscriberCount(topic) { return subs.get(topic)?.size ?? 0 }
  }
  return {
    bus,
    clock: { now: () => 1_800_000_000_000, mode: () => 'live' },
    symbols: ['BTCUSDT'],
    timeframes: ['1m', '4m', '10m'],
    quoteStore: { all: () => [{ symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: 1 }], size: () => 1 },
    orderbookStore: { symbols: () => ['BTCUSDT'], get: () => ({ symbol: 'BTCUSDT', bids: [[100, 1]], asks: [[101, 1]] }) },
    monitor: { status: () => ({ latency: {} }) },
    provider: null,
    start() {},
    stop() {},
    stats: () => ({}),
    emit: (topic: string, event: MarketEvent) => bus.emit(topic, event),
    subscriptions: () => [...subs.values()].reduce((s, set) => s + set.size, 0)
  } as unknown as MarketPlane & { emit(topic: string, event: MarketEvent): number; subscriptions(): number }
}

const collect = () => {
  const frames: Array<Record<string, unknown>> = []
  return { frames, send: (data: string) => { frames.push(JSON.parse(data)) } }
}

const candle = (over: Record<string, unknown> = {}): MarketEvent => ({
  type: 'market.candle', source: 'binance', symbol: 'BTCUSDT', timeframe: '15m', state: 'closed',
  open: 100, high: 110, low: 90, close: 105, volume: 5, openTime: 1_000, closeTime: 2_000,
  eventTime: 2_000, ingestTime: 2_500, ...over
})
const quote = (over: Record<string, unknown> = {}): MarketEvent => ({
  type: 'market.quote', source: 'binance', symbol: 'BTCUSDT', bid: 100, ask: 101,
  eventTime: 2_000, ingestTime: 2_500, ...over
})

const CANDLE_CH = { topic: 'candle', instrumentId: 'BTCUSDT', venue: 'binance', timeframe: '15m' }
const QUOTE_CH = { topic: 'quote', instrumentId: 'BTCUSDT', venue: 'binance' }
const CANDLE_KEY = 'market.candle|binance|BTCUSDT|15m'

const hubWith = (plane: MarketPlane): RealtimeHub => createRealtimeHub({ plane, core })

describe('realtime hub — subscribe + sequenced fan-out (§31.1/§31.2)', () => {
  test('ping -> pong carrying the plane clock', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const client = hub.open({ send: () => {} })
    assert.deepEqual(JSON.parse(client.message('{"type":"ping"}')!), { type: 'pong', now: 1_800_000_000_000 })
  })

  test('subscribe acks with normalized channels + stable keys', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    const ack = JSON.parse(client.message(JSON.stringify({ type: 'subscribe', requestId: 'r1', channels: [CANDLE_CH, QUOTE_CH] }))!)
    assert.equal(ack.type, 'subscribed')
    assert.equal(ack.requestId, 'r1')
    assert.equal(ack.channels.length, 2)
    assert.equal(ack.channels[0].key, CANDLE_KEY)
    assert.equal(ack.channels[0].eventType, 'market.candle')
    assert.equal(ack.channels[0].timeframe, '15m')
    assert.equal(ack.channels[1].timeframe, null)
  })

  test('only matching events are delivered, as sequence envelopes', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const { frames, send } = collect()
    const client = hub.open({ send })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r1', channels: [CANDLE_CH] }))

    plane.emit('market.candle', candle())
    plane.emit('market.candle', candle({ closeTime: 3_000, openTime: 2_000, eventTime: 3_000, close: 106 }))
    plane.emit('market.quote', quote()) // not subscribed -> dropped
    plane.emit('market.candle', candle({ symbol: 'ETHUSDT', eventTime: 4_000, closeTime: 4_001, openTime: 3_000 })) // other instrument

    assert.equal(frames.length, 2)
    assert.equal(frames[0].type, 'market.candle')
    assert.equal(frames[0].sequence, 1)
    assert.equal(frames[1].sequence, 2)
    assert.equal(frames[0].source, 'binance')
    assert.equal(frames[0].eventTime, 2_000)
    assert.equal((frames[0].payload as { close: number }).close, 105)
    assert.equal((frames[0].payload as Record<string, unknown>).eventTime, undefined, 'metadata is hoisted, not duplicated in payload')
  })

  test('two peers on the same channel see the SAME sequence numbers', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const a = collect(); const b = collect()
    const ca = hub.open({ send: a.send })
    const cb = hub.open({ send: b.send })
    ca.message(JSON.stringify({ type: 'subscribe', requestId: 'a', channels: [CANDLE_CH] }))
    cb.message(JSON.stringify({ type: 'subscribe', requestId: 'b', channels: [CANDLE_CH] }))

    plane.emit('market.candle', candle())
    plane.emit('market.candle', candle({ closeTime: 3_000, openTime: 2_000, eventTime: 3_000 }))

    assert.deepEqual(a.frames.map((f) => f.sequence), [1, 2])
    assert.deepEqual(b.frames.map((f) => f.sequence), [1, 2])
  })

  test('sequences are independent per channel', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const a = collect(); const b = collect()
    const ca = hub.open({ send: a.send })
    const cb = hub.open({ send: b.send })
    ca.message(JSON.stringify({ type: 'subscribe', requestId: 'a', channels: [CANDLE_CH] }))
    cb.message(JSON.stringify({ type: 'subscribe', requestId: 'b', channels: [QUOTE_CH] }))

    plane.emit('market.candle', candle())
    plane.emit('market.quote', quote())
    plane.emit('market.candle', candle({ closeTime: 3_000, openTime: 2_000, eventTime: 3_000 }))

    assert.deepEqual(a.frames.map((f) => f.sequence), [1, 2])
    assert.deepEqual(b.frames.map((f) => f.sequence), [1])
  })

  test('an empty subscribe is allowed and receives nothing', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const { frames, send } = collect()
    const client = hub.open({ send })
    const ack = JSON.parse(client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [] }))!)
    assert.equal(ack.type, 'subscribed')
    assert.deepEqual(ack.channels, [])
    plane.emit('market.candle', candle())
    assert.equal(frames.length, 0)
  })
})

describe('realtime hub — snapshots carry the channel watermark (§31.3)', () => {
  test('snapshot replies with the current sequence and the store payload', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const client = hub.open({ send: () => {} })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [QUOTE_CH] }))
    plane.emit('market.quote', quote())
    plane.emit('market.quote', quote({ eventTime: 3_000 }))

    const snap = JSON.parse(client.message(JSON.stringify({ type: 'snapshot', requestId: 's1', key: 'market.quote|binance|BTCUSDT|' }))!)
    assert.equal(snap.type, 'snapshot')
    assert.equal(snap.requestId, 's1')
    assert.equal(snap.sequence, 2)
    assert.deepEqual(snap.payload.quotes, [{ symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: 1 }])
  })

  test('book snapshot returns the ladder', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [{ topic: 'orderbook', instrumentId: 'BTCUSDT', venue: 'binance' }] }))
    const snap = JSON.parse(client.message(JSON.stringify({ type: 'snapshot', requestId: 's', key: 'market.book|binance|BTCUSDT|' }))!)
    assert.deepEqual(snap.payload.book, { symbol: 'BTCUSDT', bids: [[100, 1]], asks: [[101, 1]] })
    assert.equal(snap.sequence, 0)
  })

  test('candle snapshot has a null payload but still a watermark', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [CANDLE_CH] }))
    const snap = JSON.parse(client.message(JSON.stringify({ type: 'snapshot', requestId: 's', key: CANDLE_KEY }))!)
    assert.equal(snap.payload, null)
    assert.equal(snap.sequence, 0)
  })

  test('snapshot of an unsubscribed key -> not-subscribed', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    const err = JSON.parse(client.message(JSON.stringify({ type: 'snapshot', requestId: 's', key: 'market.quote|binance|XYZ|' }))!)
    assert.equal(err.type, 'error')
    assert.equal(err.code, 'not-subscribed')
  })

  test('snapshot without a key -> missing_key', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    const err = JSON.parse(client.message(JSON.stringify({ type: 'snapshot', requestId: 's' }))!)
    assert.equal(err.code, 'missing_key')
  })
})

describe('realtime hub — error frames + isolation', () => {
  test('unknown topic -> subscribe error with the core code', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    const err = JSON.parse(client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [{ topic: 'nope', instrumentId: 'x', venue: 'v' }] }))!)
    assert.equal(err.type, 'error')
    assert.equal(err.error, 'subscribe')
    assert.equal(err.code, 'unknown_topic')
  })

  test('bad JSON -> bad-json, non-object -> bad-frame, unknown type -> unknown-type', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    assert.equal(JSON.parse(client.message('not-json{')!).error, 'bad-json')
    assert.equal(JSON.parse(client.message('[1,2]')!).error, 'bad-frame')
    const u = JSON.parse(client.message('{"type":"launch-missiles"}')!)
    assert.equal(u.error, 'unknown-type')
    assert.equal(u.got, 'launch-missiles')
  })

  test('crossws-like Message objects are read through .text()', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    assert.equal(JSON.parse(client.message({ text: () => '{"type":"ping"}' })!).type, 'pong')
  })

  test('a throwing send never breaks a healthy peer', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const { frames, send } = collect()
    const dead = hub.open({ send: () => { throw new Error('socket closed') } })
    const live = hub.open({ send })
    dead.message(JSON.stringify({ type: 'subscribe', requestId: 'd', channels: [CANDLE_CH] }))
    live.message(JSON.stringify({ type: 'subscribe', requestId: 'l', channels: [CANDLE_CH] }))
    assert.doesNotThrow(() => plane.emit('market.candle', candle()))
    assert.equal(frames.length, 1)
  })
})

describe('realtime hub — lifecycle', () => {
  test('the bus is subscribed with the first peer and released with the last', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    assert.equal(plane.subscriptions(), 0)
    const a = hub.open({ send: () => {} })
    assert.ok(plane.subscriptions() > 0)
    const b = hub.open({ send: () => {} })
    a.close()
    assert.ok(plane.subscriptions() > 0, 'still one peer connected')
    b.close()
    assert.equal(plane.subscriptions(), 0)
    assert.equal(hub.peers(), 0)
  })

  test('close is idempotent and stops delivery', () => {
    const plane = fakePlane()
    const hub = hubWith(plane)
    const { frames, send } = collect()
    const client = hub.open({ send })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [CANDLE_CH] }))
    plane.emit('market.candle', candle())
    client.close()
    client.close()
    plane.emit('market.candle', candle({ eventTime: 3_000, closeTime: 3_001, openTime: 2_000 }))
    assert.equal(frames.length, 1)
  })

  test('stats reports peers/streams/subscriptions', () => {
    const hub = hubWith(fakePlane())
    const client = hub.open({ send: () => {} })
    client.message(JSON.stringify({ type: 'subscribe', requestId: 'r', channels: [CANDLE_CH, QUOTE_CH] }))
    const s = hub.stats()
    assert.equal(s.peers, 1)
    assert.equal(s.subscribed, 2)
    assert.ok(Array.isArray(s.topics) && (s.topics as string[]).length > 0)
  })
})
