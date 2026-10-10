// =============================================================================
//  TM TRADING — /ws/market client singleton (S5).
//
//  ONE WebSocket per browser tab: the /trade page (and any future consumer)
//  reads the shared reactive `state` instead of opening its own socket.
//  Frames are parsed by the pure reducer in app/utils/marketFeed.ts — this
//  file only owns transport concerns: connect, ping, exponential reconnect.
//
//  No auth on /ws/market (roadmap §17; the API guard only covers /api/**).
// =============================================================================

import { reactive } from 'vue'
import {
  applyFeedMessage,
  createFeedState,
  type FeedState
} from '../utils/marketFeed'

const state = reactive(createFeedState()) as FeedState

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
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
  }

  socket.onmessage = (ev: MessageEvent) => {
    applyFeedMessage(state, ev.data)
  }

  socket.onerror = () => {
    state.connection = 'error'
  }

  socket.onclose = (ev: CloseEvent) => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
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
}

export const useMarketStream = (): MarketStream => {
  const connect = (): void => {
    if (typeof window === 'undefined') return
    if (reconnectTimer) return // a reconnect is already pending — let it fire
    openSocket()
  }

  const disconnect = (): void => {
    manualClose = true
    clearTimers()
    attempts = 0
    try {
      socket?.close(1000, 'client-disconnect')
    } catch { /* already gone */ }
    socket = null
    state.connection = 'closed'
  }

  return { state, connect, disconnect }
}
