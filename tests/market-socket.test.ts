import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STREAM_TOPICS,
  attachClient,
  buildHello,
  handleClientMessage
} from '../server/utils/market-socket'
import type { MarketBus, MarketEvent, MarketPlane, Unsub } from '../server/utils/market-plane'

// ---------------------------------------------------------------------------
// Minimal fake plane — the protocol layer only touches these members, so the
// suite never imports the JS market modules and never opens a network socket.
// ---------------------------------------------------------------------------
function fakePlane(overrides: Partial<MarketPlane> = {}): MarketPlane & {
  emit(topic: string, event: MarketEvent): number
  subscriptions(): number
} {
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

  const plane = {
    bus,
    clock: { now: () => 1_800_000_000_000, mode: () => 'live' },
    symbols: ['BTCUSDT'],
    timeframes: ['1m', '4m', '10m'],
    quoteStore: { all: () => [{ symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: 1 }], size: () => 1 },
    orderbookStore: { symbols: () => ['BTCUSDT'], get: () => null },
    monitor: { status: () => ({ latency: { samples: 0, p50: null, p95: null, max: null } }) },
    provider: null,
    start() {},
    stop() {},
    stats: () => ({}),
    ...overrides,
    // test helpers
    emit: (topic: string, event: MarketEvent) => bus.emit(topic, event),
    subscriptions: () => [...subs.values()].reduce((s, set) => s + set.size, 0)
  } as unknown as MarketPlane & { emit(topic: string, event: MarketEvent): number; subscriptions(): number }

  return plane
}

const collect = () => {
  const frames: MarketEvent[] = []
  return { frames, send: (data: string) => { frames.push(JSON.parse(data)) } }
}

describe('buildHello — snapshot of the plane on open', () => {
  test('carries protocol, clock, topics, config, quotes, book symbols, monitor', () => {
    const plane = fakePlane()
    const hello = buildHello(plane)
    assert.equal(hello.type, 'hello')
    assert.equal(hello.protocol, 1)
    assert.deepEqual(hello.topics, [...STREAM_TOPICS])
    assert.deepEqual(hello.clock, { mode: 'live', now: 1_800_000_000_000, skew: 0 })
    assert.deepEqual(hello.symbols, ['BTCUSDT'])
    assert.deepEqual(hello.timeframes, ['1m', '4m', '10m'])
    assert.deepEqual(hello.quotes, [{ symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: 1 }])
    assert.deepEqual(hello.bookSymbols, ['BTCUSDT'])
    assert.equal(hello.provider, null)
    assert.equal(typeof (hello.monitor as { latency: unknown }).latency, 'object')
    assert.equal(typeof hello.serverTime, 'number')
  })

  test('missing symbols/timeframes (older plane) degrade to empty lists', () => {
    const plane = fakePlane({ symbols: undefined, timeframes: undefined })
    const hello = buildHello(plane)
    assert.deepEqual(hello.symbols, [])
    assert.deepEqual(hello.timeframes, [])
  })

  test('provider status is attached when a feed exists', () => {
    const plane = fakePlane({ provider: { status: () => ({ state: 'connected', attempt: 0 }) } })
    const hello = buildHello(plane)
    assert.deepEqual(hello.provider, { state: 'connected', attempt: 0 })
  })
})

describe('attachClient — one subscriber per stream topic, isolated sends', () => {
  test('subscribes to exactly STREAM_TOPICS topics', () => {
    const plane = fakePlane()
    const client = attachClient(plane, () => {})
    assert.equal(plane.subscriptions(), STREAM_TOPICS.length)
    client.detach()
    assert.equal(plane.subscriptions(), 0)
  })

  test('forwards every canonical event as a JSON frame', () => {
    const plane = fakePlane()
    const { frames, send } = collect()
    attachClient(plane, send)

    plane.emit('market.trade', { type: 'market.trade', symbol: 'BTCUSDT', price: 100, eventTime: 5 })
    plane.emit('market.candle', { type: 'market.candle', timeframe: '1m', state: 'closed', eventTime: 6 })
    plane.emit('market.status', { type: 'market.status', state: 'connected' })

    assert.equal(frames.length, 3)
    assert.equal(frames[0].type, 'market.trade')
    assert.equal(frames[1].type, 'market.candle')
    assert.equal(frames[2].type, 'market.status')
    assert.equal(frames[0].price, 100)
  })

  test('detach stops delivery and is idempotent', () => {
    const plane = fakePlane()
    const { frames, send } = collect()
    const client = attachClient(plane, send)
    plane.emit('market.quote', { type: 'market.quote', eventTime: 1 })
    client.detach()
    client.detach() // second call must be a no-op, not a throw
    plane.emit('market.quote', { type: 'market.quote', eventTime: 2 })
    assert.equal(frames.length, 1)
    assert.equal(plane.subscriptions(), 0)
  })

  test('a throwing send never breaks the bus or other handlers', () => {
    const plane = fakePlane()
    const { frames, send } = collect()
    attachClient(plane, () => { throw new Error('socket closed') }) // dead peer
    attachClient(plane, send) // healthy peer

    assert.doesNotThrow(() => {
      plane.emit('market.trade', { type: 'market.trade', eventTime: 1 })
    })
    assert.equal(frames.length, 1, 'the healthy peer still received the event')
  })
})

describe('handleClientMessage — tiny request/response protocol', () => {
  test('ping -> pong carrying the plane clock', () => {
    const plane = fakePlane()
    const reply = handleClientMessage(plane, JSON.stringify({ type: 'ping' }))
    assert.deepEqual(JSON.parse(reply!), { type: 'pong', now: 1_800_000_000_000 })
  })

  test('hello -> a fresh snapshot frame', () => {
    const plane = fakePlane()
    const reply = handleClientMessage(plane, '{"type":"hello"}')
    const parsed = JSON.parse(reply!)
    assert.equal(parsed.type, 'hello')
    assert.deepEqual(parsed.topics, [...STREAM_TOPICS])
  })

  test('crossws-like Message object is read through .text()', () => {
    const plane = fakePlane()
    const reply = handleClientMessage(plane, { text: () => '{"type":"ping"}' })
    assert.equal(JSON.parse(reply!).type, 'pong')
  })

  test('invalid JSON -> bad-json error, never a throw', () => {
    const plane = fakePlane()
    const reply = handleClientMessage(plane, 'not-json{')
    assert.deepEqual(JSON.parse(reply!), { type: 'error', error: 'bad-json' })
  })

  test('non-object frame -> bad-frame error', () => {
    const plane = fakePlane()
    assert.equal(JSON.parse(handleClientMessage(plane, '[1,2]')!).error, 'bad-frame')
    assert.equal(JSON.parse(handleClientMessage(plane, '"hi"')!).error, 'bad-frame')
  })

  test('unknown type -> error naming what arrived', () => {
    const plane = fakePlane()
    const parsed = JSON.parse(handleClientMessage(plane, '{"type":"subscribe-everything"}')!)
    assert.equal(parsed.type, 'error')
    assert.equal(parsed.error, 'unknown-type')
    assert.equal(parsed.got, 'subscribe-everything')
  })
})
