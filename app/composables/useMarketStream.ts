// =============================================================================
//  TM TRADING — /ws/market client singleton (S5).
//
//  ONE WebSocket per browser tab: the /trade page (and any future consumer)
//  reads the shared reactive `state` instead of opening its own socket.
//  Frames are parsed by the pure reducer in app/utils/marketFeed.ts — this
//  file only owns transport concerns: connect, ping, exponential reconnect,
//  and the 250ms batch-flush rhythm (hot symbols would otherwise saturate
//  the renderer — see createBatchedFeed).
//
//  No auth on /ws/market (roadmap §17; the API guard only covers /api/**).
// =============================================================================

import { reactive } from 'vue'
import {
  BATCH_FLUSH_MS,
  createBatchedFeed,
  createFeedState,
  type FeedState
} from '../utils/marketFeed'

const state = reactive(createFeedState()) as FeedState
// Hot symbols sustain 1000+ frames/s — coalesce into one reactive commit per
// 250ms window or the renderer saturates and clicks queue for seconds.
const batch = createBatchedFeed(state)

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let attempts = 0
let manualClose = false

const PING_INTERVAL_MS = 25_000
const MAX_BACKOFF_MS = 15_000

const marketWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws/market`
}

const clearTimers = (): void => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
}

const startFlush = (): void => {
  if (flushTimer) return
  flushTimer = setInterval(() => batch.flush(), BATCH_FLUSH_MS)
}

const scheduleReconnect = (): void => {
  if (manualClose || reconnectTimer) return
  attempts++
  const delay = Math.min(1_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    openSocket()
  }, delay)
}

const openSocket = (): void => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  manualClose = false
  state.connection = 'connecting'
  try {
    socket = new WebSocket(marketWsUrl())
  } catch (err) {
    state.connection = 'error'
    state.lastError = err instanceof Error ? err.message : 'ws-construction-failed'
    scheduleReconnect()
    return
  }

  socket.onopen = () => {
    attempts = 0
    state.connection = 'open'
    state.lastError = null
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      try {
        socket?.send(JSON.stringify({ type: 'ping' }))
      } catch { /* socket died — onclose will handle the reconnect */ }
    }, PING_INTERVAL_MS)
    startFlush()
  }

  socket.onmessage = (ev: MessageEvent) => {
    // Runtime subscribe handshake (TradingView-style search): intercept the
    // ack/error while a waiter is pending — everything else flows to batch.
    // The pre-parse runs ONLY with an active waiter (hot path stays single).
    if (subscribeWaiter && typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data) as { type?: unknown; symbols?: unknown; error?: unknown }
        if (msg && typeof msg === 'object' && msg.type === 'subscribed') {
          const w = subscribeWaiter
          subscribeWaiter = null
          clearTimeout(w.timer)
          w.resolve(Array.isArray(msg.symbols) ? msg.symbols.map((s) => String(s)) : [])
          return
        }
        if (
          msg && typeof msg === 'object' && msg.type === 'error' &&
          (msg.error === 'bad-symbols' || msg.error === 'unsupported' || msg.error === 'too-many-symbols')
        ) {
          const w = subscribeWaiter
          subscribeWaiter = null
          clearTimeout(w.timer)
          w.reject(new Error(`subscribe-${String(msg.error)}`))
          return
        }
      } catch { /* not our frame — falls through to batch below */ }
    }
    batch.push(ev.data)
  }

  socket.onerror = () => {
    state.connection = 'error'
  }

  socket.onclose = (ev: CloseEvent) => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (subscribeWaiter) {
      const w = subscribeWaiter
      subscribeWaiter = null
      clearTimeout(w.timer)
      w.reject(new Error('subscribe-closed'))
    }
    // Drain the window so no frame is applied twice after reconnect (the
    // fresh hello re-seeds snapshots; the tape simply continues).
    batch.flush()
    socket = null
    if (manualClose) {
      state.connection = 'closed'
      return
    }
    state.connection = ev.code === 1011 && state.lastError ? 'error' : 'closed'
    scheduleReconnect()
  }
}

export interface MarketStream {
  /** Shared reactive feed state (hello, quotes, candles, trades, status). */
  state: FeedState
  /** Idempotent — first call opens the socket, later calls are no-ops. */
  connect(): void
  /** Close and stop reconnecting (rarely needed — the feed is cheap). */
  disconnect(): void
  /**
   * Serve more symbols at runtime (single-flight): sends the subscribe
   * control frame and resolves with the symbols the plane accepted.
   * Rejects on bad input, server refusal, close, or a 10s timeout.
   */
  subscribe(symbols: string[]): Promise<string[]>
}

interface SubscribeWaiter {
  resolve: (symbols: string[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let subscribeWaiter: SubscribeWaiter | null = null

export const useMarketStream = (): MarketStream => {
  const connect = (): void => {
    if (typeof window === 'undefined') return
    if (reconnectTimer) return // a reconnect is already pending — let it fire
    openSocket()
  }

  const disconnect = (): void => {
    manualClose = true
    batch.flush()
    clearTimers()
    attempts = 0
    try {
      socket?.close(1000, 'client-disconnect')
    } catch { /* already gone */ }
    socket = null
    state.connection = 'closed'
  }

  const subscribe = (symbols: string[]): Promise<string[]> => {
    if (typeof window === 'undefined') return Promise.reject(new Error('subscribe-no-window'))
    if (subscribeWaiter) return Promise.reject(new Error('subscribe-busy'))
    const clean = [...new Set(
      symbols.map((s) => String(s ?? '').trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
    )].slice(0, 10)
    if (!clean.length) return Promise.reject(new Error('subscribe-bad-symbols'))
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('subscribe-offline'))
    }
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (subscribeWaiter?.timer === timer) subscribeWaiter = null
        reject(new Error('subscribe-timeout'))
      }, 10_000)
      subscribeWaiter = { resolve, reject, timer }
      try {
        socket?.send(JSON.stringify({ type: 'subscribe', symbols: clean }))
      } catch {
        clearTimeout(timer)
        subscribeWaiter = null
        reject(new Error('subscribe-send-failed'))
      }
    })
  }

  return { state, connect, disconnect, subscribe }
}
