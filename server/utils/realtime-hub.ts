// =============================================================================
//  TM TRADING — realtime hub for the §31 WebSocket V3 channel.
//
//  Bridges the in-process market bus (market/eventBus.mjs) to per-peer channel
//  subscriptions using the pure realtime core (realtime/*.mjs):
//    * ONE shared sequencer per stream — every client of a channel sees the
//      SAME sequence number, because a gap is a property of the stream, not
//      of one socket (this is what makes §31.3 recovery meaningful)
//    * each event is sealed ONCE, then fanned out to the peers whose channels
//      match it (§31.1) — a client never receives a stream it did not ask for
//    * subscribe / snapshot / ping protocol; snapshots carry the channel
//      watermark (the last sequence) so a client can reconcile (§31.3)
//
//  The core is injected (not imported statically) so the server build never
//  has to resolve the out-of-tree `realtime/` modules and the whole protocol
//  is unit-testable with a fake plane + the real core — no live feed, no IO.
// =============================================================================

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MarketEvent, MarketPlane, Unsub } from './market-plane'
import { getMarketPlane } from './market-plane'
import { STREAM_TOPICS } from './market-socket'

export interface RealtimeChannel {
  topic: string
  eventType: string
  instrumentId: string
  venue: string
  timeframe: string | null
  symbol: string
  source: string
  key: string
}

export interface RealtimeEnvelope {
  type: string
  sequence: number
  eventTime: number
  ingestTime: number
  source: string
  payload: Record<string, unknown>
}

export interface RealtimeSequencer {
  next(channelKey: string): number
  peek(channelKey: string): number
  reset(channelKey: string): void
  clear(): void
  stats(): { channels: number; total: number }
}

export interface Resolver {
  (instrumentId: string, venue: string): { symbol: string; source: string }
}

export interface SubscribeResult {
  requestId: string
  channels: RealtimeChannel[]
}

/** The slice of `realtime/index.mjs` the hub uses. */
export interface RealtimeCore {
  createSequencer(): RealtimeSequencer
  seal(sequencer: RealtimeSequencer, event: MarketEvent): RealtimeEnvelope
  parseSubscribe(msg: unknown, opts?: { resolve?: Resolver; allowEmpty?: boolean }): SubscribeResult
  matchChannels(event: MarketEvent, channels: RealtimeChannel[]): RealtimeChannel[]
  channelKeyOf(parts: Record<string, unknown>): string
}

/** A transport-agnostic sink — the route wires a crossws peer's `send`. */
export interface HubPeer {
  send(data: string): unknown
}

export interface HubClient {
  /** Handle one client frame; returns the reply frame (or null for none). */
  message(raw: unknown): string | null
  /** Remove the peer; the last close unsubscribes the bus. */
  close(): void
}

export interface HubDeps {
  plane: MarketPlane
  core: RealtimeCore
  /** instrumentId/venue -> symbol/source (defaults to the core's identity map). */
  resolve?: Resolver
  /** Best-effort channel snapshot; return null when the plane has nothing. */
  snapshot?: (channel: RealtimeChannel, plane: MarketPlane) => Record<string, unknown> | null
}

export interface RealtimeHub {
  open(peer: HubPeer): HubClient
  peers(): number
  stats(): Record<string, unknown>
  /** Test hook / shutdown: drop every peer and unsubscribe the bus. */
  stop(): void
}

const frame = (data: Record<string, unknown>): string => JSON.stringify(data)
const errorFrame = (error: string, extra: Record<string, unknown> = {}): string => frame({ type: 'error', error, ...extra })

/** Read a crossws-like Message (or a raw string) as text. */
const readText = (raw: unknown): string =>
  typeof raw === 'string'
    ? raw
    : raw && typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'function'
      ? String((raw as { text: () => string }).text())
      : String(raw ?? '')

/** Default snapshot: what the plane can answer synchronously, else null. */
function defaultSnapshot(channel: RealtimeChannel, plane: MarketPlane): Record<string, unknown> | null {
  if (channel.eventType === 'market.quote') {
    const all = plane.quoteStore.all()
    return { quotes: all.filter((q) => q.symbol === channel.symbol) }
  }
  if (channel.eventType === 'market.book') {
    return { book: plane.orderbookStore.get(channel.symbol) ?? null }
  }
  // candles are not held in the plane's memory; the client full-syncs them over
  // REST (/api/v1/markets/:instrument/candles) and only needs the watermark.
  return null
}

/**
 * Build a hub over a plane + core. Sync: the bus is subscribed on the first
 * peer and released with the last one (the plane itself is owned elsewhere).
 */
export function createRealtimeHub({ plane, core, resolve, snapshot }: HubDeps): RealtimeHub {
  const sequencer = core.createSequencer()
  const clients = new Map<HubPeer, { channels: RealtimeChannel[] }>()
  let unsubs: Unsub[] = []

  const safeSend = (peer: HubPeer, data: string): void => {
    try { peer.send(data) } catch { /* a dead peer must not break the bus */ }
  }

  const onEvent = (event: MarketEvent): void => {
    let envelope: RealtimeEnvelope
    try {
      envelope = core.seal(sequencer, event)
    } catch {
      return // an event without the D16 stamps cannot be sequenced — skip it
    }
    const payload = JSON.stringify(envelope)
    for (const [peer, state] of clients) {
      if (state.channels.length && core.matchChannels(event, state.channels).length) safeSend(peer, payload)
    }
  }

  const start = (): void => {
    if (unsubs.length) return
    unsubs = STREAM_TOPICS.map((topic) => plane.bus.on(topic, (event) => onEvent(event)))
  }

  const stop = (): void => {
    for (const off of unsubs) { try { off() } catch { /* already gone */ } }
    unsubs = []
  }

  const snapshotFor = (channel: RealtimeChannel): string => {
    const sequence = sequencer.peek(channel.key)
    const payload = (snapshot ?? defaultSnapshot)(channel, plane)
    return frame({
      type: 'snapshot',
      key: channel.key,
      sequence,
      topic: channel.topic,
      instrumentId: channel.instrumentId,
      venue: channel.venue,
      timeframe: channel.timeframe,
      payload
    })
  }

  return {
    open(peer: HubPeer): HubClient {
      if (typeof peer?.send !== 'function') throw new Error('realtime: peer.send required')
      clients.set(peer, { channels: [] })
      start()
      let closed = false

      return {
        message(raw: unknown): string | null {
          if (closed) return null
          let parsed: unknown
          try {
            parsed = JSON.parse(readText(raw))
          } catch {
            return errorFrame('bad-json')
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorFrame('bad-frame')
          const msg = parsed as Record<string, unknown>
          const type = String(msg.type ?? '')

          if (type === 'ping') return frame({ type: 'pong', now: plane.clock.now() })

          if (type === 'subscribe') {
            let sub: SubscribeResult
            try {
              sub = core.parseSubscribe(msg, { resolve, allowEmpty: true })
            } catch (err) {
              const e = err as { code?: string; message?: string }
              return errorFrame('subscribe', { code: e?.code ?? 'invalid', message: e?.message ?? String(err) })
            }
            const state = clients.get(peer)
            if (!state) return null // peer closed mid-flight
            state.channels = sub.channels
            return frame({
              type: 'subscribed',
              requestId: sub.requestId,
              channels: sub.channels.map((c) => ({
                key: c.key,
                topic: c.topic,
                eventType: c.eventType,
                instrumentId: c.instrumentId,
                venue: c.venue,
                timeframe: c.timeframe
              }))
            })
          }

          if (type === 'snapshot') {
            const requestId = String(msg.requestId ?? '')
            const key = String(msg.key ?? '')
            if (!key) return errorFrame('snapshot', { code: 'missing_key' })
            const state = clients.get(peer)
            const channel = state?.channels.find((c) => c.key === key)
            if (!channel) return errorFrame('snapshot', { code: 'not-subscribed', key })
            const reply = JSON.parse(snapshotFor(channel)) as Record<string, unknown>
            return frame({ requestId, ...reply })
          }

          return errorFrame('unknown-type', { got: type })
        },

        close(): void {
          if (closed) return
          closed = true
          clients.delete(peer)
          if (clients.size === 0) stop()
        }
      }
    },

    peers: () => clients.size,

    stats: () => ({
      peers: clients.size,
      streams: sequencer.stats().channels,
      sequenced: sequencer.stats().total,
      subscribed: [...clients.values()].reduce((n, c) => n + c.channels.length, 0),
      topics: [...STREAM_TOPICS]
    }),

    stop(): void {
      clients.clear()
      stop()
    }
  }
}

// -----------------------------------------------------------------------------
//  Process singleton (lazy) — one hub over the shared market plane.
// -----------------------------------------------------------------------------

let hubPromise: Promise<RealtimeHub> | null = null

export function getRealtimeHub(): Promise<RealtimeHub> {
  if (!hubPromise) {
    hubPromise = (async () => {
      const [plane, core] = await Promise.all([getMarketPlane(), loadRealtimeCore()])
      return createRealtimeHub({ plane, core })
    })().catch((err: unknown) => {
      hubPromise = null // a failed construction may be retried on the next client
      throw err
    })
  }
  return hubPromise
}

let corePromise: Promise<RealtimeCore> | null = null

/**
 * Load `realtime/index.mjs` once via pathToFileURL — the same pattern as
 * market-plane.ts, so the Nitro build never bundles the out-of-tree modules.
 */
export function loadRealtimeCore(): Promise<RealtimeCore> {
  if (!corePromise) {
    const href = pathToFileURL(join(process.cwd(), 'realtime', 'index.mjs')).href
    corePromise = import(/* @vite-ignore */ href) as Promise<RealtimeCore>
  }
  return corePromise
}

/** Test hook: forget the singleton (tests use fakes, never a real plane). */
export function resetRealtimeHub(): void {
  hubPromise = null
}
