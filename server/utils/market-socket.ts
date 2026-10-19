// =============================================================================
//  TM TRADING — WebSocket /ws/market protocol logic (S3, roadmap §17).
//
//  Pure + peer-agnostic on purpose: the Nitro handler (server/routes/ws/market)
//  only wires a crossws peer to these three functions, so the whole protocol
//  is unit-testable without a running server (tests/market-socket.test.ts).
//
//  Protocol (JSON text frames):
//    server -> client : `hello` snapshot ON OPEN, then canonical events
//                       (market.trade|quote|candle|book|ticker24|status) as they flow
//    client -> server : {"type":"ping"}  -> {"type":"pong", now}
//                       {"type":"hello"} -> a fresh snapshot
//                       {"type":"subscribe", "symbols":[...]} -> serve more
//                         symbols at runtime (validated, capped) ->
//                         {"type":"subscribed", "symbols":[...added]}
//                       anything else    -> {"type":"error", error}
//  A client that cannot be written to is silently dropped from THAT emission
//  (bus handlers are isolated in market/eventBus.mjs — one dead peer never
//  breaks the feed for the others).
// =============================================================================

import type { MarketEvent, MarketPlane, Unsub } from './market-plane'

/** Topics every /ws/market client receives (canonical events, §7). */
export const STREAM_TOPICS: readonly string[] = [
  'market.trade',
  'market.quote',
  'market.candle',
  'market.book',
  'market.ticker24',
  'market.status'
]

export interface SocketPeer {
  send(data: string): unknown
}

export interface SocketClient {
  detach(): void
}

/** Snapshot sent as the first frame of every connection. */
export function buildHello(plane: MarketPlane): MarketEvent {
  return {
    type: 'hello',
    protocol: 1,
    serverTime: Date.now(),
    clock: { mode: plane.clock.mode(), now: plane.clock.now(), skew: plane.clock.skew?.() ?? 0 },
    topics: [...STREAM_TOPICS],
    // Static config the UI needs to render selectors (S5).
    symbols: [...(plane.symbols ?? [])],
    timeframes: [...(plane.timeframes ?? [])],
    quotes: plane.quoteStore.all(),
    ticker24: plane.ticker24Store.all(),
    bookSymbols: plane.orderbookStore.symbols(),
    provider: plane.provider ? plane.provider.status() : null,
    monitor: plane.monitor.status()
  }
}

/**
 * Subscribe one client to every stream topic. Returns a detach() that is
 * idempotent and never throws (close/error hooks may both call it).
 */
export function attachClient(plane: MarketPlane, send: (data: string) => unknown): SocketClient {
  let detached = false
  const unsubs: Unsub[] = STREAM_TOPICS.map((topic) =>
    plane.bus.on(topic, (event) => {
      if (detached) return
      try {
        send(JSON.stringify(event))
      } catch {
        /* a dead socket must not break the bus */
      }
    })
  )
  return {
    detach() {
      if (detached) return
      detached = true
      for (const off of unsubs) {
        try { off() } catch { /* already gone */ }
      }
    }
  }
}

/**
 * Serve more symbols at runtime (TradingView-style search): validated
 * exchange symbols join the plane (builders + provider streams + depth
 * snapshot); the client re-reads them from the next hello or live frames.
 * Capped per call and in total so one client cannot flood the feed.
 */
const SUBSCRIBE_PER_CALL = 10
const SUBSCRIBE_TOTAL = 30

function handleSubscribe(plane: MarketPlane, parsed: unknown): string {
  const raw = (parsed as { symbols?: unknown }).symbols
  const list = Array.isArray(raw) ? raw : []
  const clean = [...new Set(
    list.map((s) => String(s ?? '').trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
  )].slice(0, SUBSCRIBE_PER_CALL)
  if (!clean.length) return JSON.stringify({ type: 'error', error: 'bad-symbols' })
  if (typeof plane.addSymbol !== 'function') {
    return JSON.stringify({ type: 'error', error: 'unsupported' })
  }
  if ((plane.symbols?.length ?? 0) + clean.length > SUBSCRIBE_TOTAL) {
    return JSON.stringify({ type: 'error', error: 'too-many-symbols' })
  }
  const added = clean.filter((s) => {
    try {
      return plane.addSymbol!(s)
    } catch {
      return false
    }
  })
  return JSON.stringify({ type: 'subscribed', symbols: added })
}

/** Handle one client frame (string, or a crossws-like Message with .text()). */
export function handleClientMessage(plane: MarketPlane, raw: unknown): string | null {
  const text = typeof raw === 'string'
    ? raw
    : raw && typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'function'
      ? String((raw as { text: () => string }).text())
      : String(raw ?? '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return JSON.stringify({ type: 'error', error: 'bad-json' })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return JSON.stringify({ type: 'error', error: 'bad-frame' })
  }
  const type = (parsed as { type?: unknown }).type
  if (type === 'ping') return JSON.stringify({ type: 'pong', now: plane.clock.now() })
  if (type === 'hello') return JSON.stringify(buildHello(plane))
  if (type === 'subscribe') return handleSubscribe(plane, parsed)
  return JSON.stringify({ type: 'error', error: 'unknown-type', got: String(type ?? '') })
}
