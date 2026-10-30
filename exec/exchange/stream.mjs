// =============================================================================
//  TM TRADING — V3.9 demo WebSocket connection manager (§63.8/§64.7).
//
//  Generic transport with per-venue auth/subscribe/ping protocol builders. The
//  socket AND timers are INJECTED (deps) so reconnect/heartbeat/sequence-gap
//  behaviour is unit-testable offline with a fake socket — no live venue needed.
//
//  Guarantees:
//   - TCP-connected != healthy: a frame-age heartbeat drives health, and a
//     stalled socket is torn down and reconnected (bounded backoff + jitter).
//   - On reconnect: re-auth (private), re-subscribe, then call onResync() so the
//     adapter fetches authoritative REST snapshots and reconciles before READY.
//   - Public (market-data) and private (account/order) sockets are SEPARATE
//     transports with separate state; one failing never marks the other down.
//   - Demo WS hosts only (assertDemoWsHost) — a production stream is refused.
// =============================================================================

import { createHmac } from 'node:crypto'
import { assertDemoWsHost } from './profiles.mjs'

const STATES = Object.freeze({ IDLE: 'idle', CONNECTING: 'connecting', CONNECTED: 'connected', RECONNECTING: 'reconnecting', CLOSED: 'closed' })

// --- per-venue WS protocol builders ------------------------------------------
export const wsProtocol = {
  bybit: {
    // Private demo WS auth: sign `GET/realtime<expires>` with the secret.
    authMessage(credentials, now = Date.now()) {
      const expires = now + 10_000
      const sign = createHmac('sha256', credentials.apiSecret).update(`GET/realtime${expires}`).digest('hex')
      return { op: 'auth', args: [credentials.apiKey, expires, sign] }
    },
    subscribe(topics) { return { op: 'subscribe', args: topics } },
    ping: () => ({ op: 'ping' }),
    isPong(msg) { return msg?.op === 'pong' || msg?.ret_msg === 'pong' },
  },
  okx: {
    authMessage(credentials, now = Date.now()) {
      const ts = (now / 1000).toFixed(3)
      const sign = createHmac('sha256', credentials.apiSecret).update(`${ts}GET/users/self/verify`).digest('base64')
      return { op: 'login', args: [{ apiKey: credentials.apiKey, passphrase: credentials.passphrase, timestamp: ts, sign }] }
    },
    subscribe(topics) { return { op: 'subscribe', args: topics } },
    ping: () => 'ping',
    isPong(msg) { return msg === 'pong' || msg?.event === 'pong' },
  },
  binance: {
    // Private stream connects with a REST-obtained listenKey embedded in the
    // url (adapter supplies it); no in-band auth frame.
    authMessage: () => null,
    subscribe(topics) { return { method: 'SUBSCRIBE', params: topics, id: 1 } },
    ping: () => ({ method: 'GET_RESPONSE', id: 1 }),
    isPong(msg) { return msg != null && typeof msg === 'object' && msg.result !== undefined && msg.e === undefined },
  },
}

/**
 * Create a managed WS connection for one profile + channel (public|private).
 * socketLike: { send(data), close(), addEventListener('open'|'message'|'close'|'error', cb) }
 */
export function createStream(cfg) {
  const {
    profileId, venue, channel, url, credentials, connectSocket,
    topics = [], onMessage = () => {}, onStatus = () => {}, onResync = () => {},
    now = () => Date.now(), heartbeatMs = 20_000, maxBackoffMs = 30_000, maxAttempts = Infinity,
    setTimeout: setTimeoutFn = globalThis.setTimeout,
    clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
    setInterval: setIntervalFn = globalThis.setInterval,
    clearInterval: clearIntervalFn = globalThis.clearInterval,
  } = cfg

  // Fail-closed: refuse to open a non-demo private WS host.
  if (channel === 'private') assertDemoWsHost(venue, url)

  const proto = wsProtocol[venue]
  let socket = null
  let state = STATES.IDLE
  let attempt = 0
  let closedByUs = false
  let lastFrameAt = 0
  let lastSeq = null
  let seqGaps = 0
  let reconnects = 0
  let heartbeatTimer = null
  let reconnectTimer = null

  function safeUrl(u) { try { const x = new URL(u); x.search = ''; return x.toString() } catch { return '' } }
  function emit(extra = {}) {
    onStatus({ profileId, venue, channel, state, attempt, reconnects, lastFrameAt, seqGaps, url: safeUrl(url), ...extra })
  }
  function clearTimers() {
    if (heartbeatTimer) clearIntervalFn(heartbeatTimer)
    if (reconnectTimer) clearTimeoutFn(reconnectTimer)
    heartbeatTimer = reconnectTimer = null
  }

  function scheduleReconnect() {
    if (closedByUs || attempt >= maxAttempts) { state = STATES.CLOSED; emit(); return }
    state = STATES.RECONNECTING
    attempt += 1
    const base = Math.min(maxBackoffMs, 250 * 2 ** Math.min(attempt, 7))
    const wait = base + Math.floor(base * 0.25 * ((now() % 997) / 997))
    emit({ backoffMs: wait })
    reconnectTimer = setTimeoutFn(() => open(), wait)
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearIntervalFn(heartbeatTimer)
    heartbeatTimer = setIntervalFn(() => {
      if (socket && state === STATES.CONNECTED) {
        try { socket.send(JSON.stringify(proto.ping())) } catch { /* surfaces via close */ }
      }
      // Stall detection: no frame for 2.5x heartbeat => tear down + reconnect.
      if (lastFrameAt && now() - lastFrameAt > heartbeatMs * 2.5) {
        try { socket?.close() } catch { /* ignore */ }
      }
    }, heartbeatMs)
  }

  function handleMessage(raw) {
    lastFrameAt = now()
    let msg = raw
    if (typeof raw === 'string') { try { msg = JSON.parse(raw) } catch { msg = raw } }
    if (proto.isPong(msg)) return
    const seq = msg?.i ?? msg?.u ?? msg?.seq ?? msg?.data?.seq ?? null
    if (typeof seq === 'number' && lastSeq != null && seq > lastSeq + 1) seqGaps += 1
    if (typeof seq === 'number') lastSeq = seq
    onMessage(msg, { channel, profileId, venue, ingestTime: now() })
  }

  function open() {
    if (closedByUs) return
    clearTimers()
    state = attempt === 0 ? STATES.CONNECTING : STATES.RECONNECTING
    emit()
    socket = connectSocket(url)
    socket.addEventListener('open', () => {
      const wasReconnect = attempt > 0 || reconnects > 0
      state = STATES.CONNECTED
      attempt = 0
      lastFrameAt = now()
      try {
        if (channel === 'private') {
          const auth = proto.authMessage(credentials, now(), cfg)
          if (auth) socket.send(JSON.stringify(auth))
        }
        if (topics.length) socket.send(JSON.stringify(proto.subscribe(topics)))
      } catch { /* surfaced by error/close */ }
      emit({ authenticated: channel === 'private' })
      startHeartbeat()
      if (wasReconnect) { reconnects += 1; Promise.resolve(onResync()).catch(() => {}) }
    })
    socket.addEventListener('message', (ev) => handleMessage(typeof ev?.data !== 'undefined' ? ev.data : ev))
    socket.addEventListener('close', () => { if (!closedByUs) scheduleReconnect() })
    socket.addEventListener('error', () => emit({ error: true }))
  }

  return {
    get state() { return state },
    get stats() { return { state, attempt, reconnects, seqGaps, lastFrameAt, lastSeq } },
    start() { closedByUs = false; attempt = 0; open() },
    send(data) { if (socket && state === STATES.CONNECTED) socket.send(typeof data === 'string' ? data : JSON.stringify(data)) },
    close() { closedByUs = true; clearTimers(); try { socket?.close() } catch { /* ignore */ } state = STATES.CLOSED; emit() },
  }
}

export { STATES as STREAM_STATES }
