// =============================================================================
//  TM TRADING — Binance provider (Phase 7R: binance spot/futures WS,
//  connection manager, normalized canonical events).
//
//  Transport: combined-stream WebSocket (`/stream?streams=a/b/c`).
//  Normalizer: raw payload -> ONLY canonical events (§7) + `market.book`
//  diffs for the orderbook store. Raw payloads never cross this file.
//
//  Connection manager:
//    * auto-reconnect with capped exponential backoff (injectable timers)
//    * resubscribe = same stream list baked into the URL -> reopen same URL
//    * trade-id dedupe per stream (acceptance: không duplicate event)
//    * close() stops reconnect permanently
//
//  No network in unit tests: inject `WebSocketImpl` (see market/test.mjs).
// =============================================================================

import { TOPICS, tradeEvent, quoteEvent, candleEvent, defaultIngest } from '../events.mjs'
import { assertHooks } from './contract.mjs'

export const DEFAULT_WS = Object.freeze({
  fapi: 'wss://fstream.binance.com/stream',
  spot: 'wss://stream.binance.com:9443/stream'
})

export const DEFAULT_BACKOFF_MS = Object.freeze([500, 1000, 2000, 5000, 10000])

/**
 * Stream keys for a symbol set (Binance combined streams are lowercase).
 * @param {{symbols?:string[], trades?:boolean, bookTicker?:boolean, klineInterval?:string|null, depth?:boolean, depthSpeed?:'100ms'|'1000ms'}} [opts]
 */
export function buildStreams({
  symbols = ['BTCUSDT'],
  trades = true,
  bookTicker = true,
  klineInterval = null,
  depth = false,
  depthSpeed = '100ms'
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('binance: symbols required')
  const out = []
  for (const raw of symbols) {
    const sym = String(raw || '').trim().toUpperCase()
    if (!sym) throw new Error('binance: empty symbol')
    if (trades) out.push(`${sym.toLowerCase()}@trade`)
    if (bookTicker) out.push(`${sym.toLowerCase()}@bookTicker`)
    if (klineInterval) out.push(`${sym.toLowerCase()}@kline_${klineInterval}`)
    if (depth) out.push(`${sym.toLowerCase()}@depth@${depthSpeed}`)
  }
  return [...new Set(out)]
}

/** Combined-stream URL. `streams` keys are joined path-style, `@`/`/` raw. */
export function buildUrl(base, streams) {
  if (!base) throw new Error('binance: base url required')
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('binance: streams required')
  const u = new URL(base)
  const existing = u.search.replace(/^\?/, '')
  // Manual query build: URLSearchParams would escape '@' (%40); Binance
  // documents the raw form `?streams=btcusdt@trade/btcusdt@aggTrade`.
  u.search = existing ? `${existing}&streams=${streams.join('/')}` : `streams=${streams.join('/')}`
  return u.toString()
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }

/**
 * Exchange market id -> canonical event market (§7: spot|futures|gold).
 * 'fapi' (USDⓈ-M) maps to 'futures'; anything unknown fails fast in the
 * event constructors (never silently mislabeled).
 */
const toEventMarket = (market) => (market === 'fapi' ? 'futures' : market)

/**
 * Raw combined-stream message -> {topic, event} | null (ignored payload).
 * @param {string|object} raw        message payload (string or parsed object)
 * @param {{source?:string, market?:'spot'|'futures'|'gold'|'fapi', ingest?:() => number}} [ctx]
 */
export function normalizeMessage(raw, { source = 'binance', market = 'futures', ingest = defaultIngest } = {}) {
  const kind = toEventMarket(market)
  let msg = raw
  if (typeof msg === 'string') {
    if (msg === '' || msg === 'pong') return null
    try { msg = JSON.parse(msg) }
    catch { throw new Error('binance: payload is not valid JSON') } // broken feed -> counted as parseError
  }
  if (!msg || typeof msg !== 'object') return null

  // Combined stream wraps {stream, data}; raw stream pushes only {data}.
  const data = msg.data && typeof msg.data === 'object' ? msg.data : msg
  const stream = typeof msg.stream === 'string' ? msg.stream : ''
  const ingestTime = ingest()
  const e = typeof data.e === 'string' ? data.e : ''

  // --- trade / aggTrade ----------------------------------------------------
  if (e === 'trade' || e === 'aggTrade' || stream.endsWith('@trade') || stream.endsWith('@aggTrade')) {
    if (!Number.isFinite(num(data.p))) return null
    const eventTime = Number.isFinite(num(data.T)) ? num(data.T)
      : Number.isFinite(num(data.E)) ? num(data.E)
      : ingestTime
    const event = tradeEvent({
      source, market: kind,
      symbol: String(data.s || stream.split('@')[0] || '').toUpperCase(),
      price: data.p,
      quantity: data.q,
      // m = "buyer is market maker" -> the AGGRESSOR is the seller.
      side: data.m === undefined ? undefined : (data.m ? 'sell' : 'buy'),
      eventTime,
      id: e === 'aggTrade' ? data.a : data.t
    }, ingestTime)
    return { topic: TOPICS.TRADE, event }
  }

  // --- bookTicker (best bid/ask; payload has NO event time -> ingest) ------
  if (e === 'bookTicker' || stream.endsWith('@bookTicker')) {
    if (!Number.isFinite(num(data.b)) || !Number.isFinite(num(data.a))) return null
    const event = quoteEvent({
      source, market: kind,
      symbol: String(data.s || stream.split('@')[0] || '').toUpperCase(),
      bid: data.b,
      ask: data.a,
      eventTime: Number.isFinite(num(data.E)) ? num(data.E) : ingestTime,
      updateId: data.u
    }, ingestTime)
    return { topic: TOPICS.QUOTE, event }
  }

  // --- depth diff (feeds orderbook store, §7 book companion) ---------------
  if (e === 'depthUpdate' || (stream.includes('@depth') && Array.isArray(data.b))) {
    const eventTime = Number.isFinite(num(data.E)) ? num(data.E) : ingestTime
    return {
      topic: TOPICS.BOOK,
      event: {
        type: TOPICS.BOOK, source, market: kind,
        symbol: String(data.s || stream.split('@')[0] || '').toUpperCase(),
        firstUpdateId: num(data.U),
        lastUpdateId: num(data.u),
        bids: Array.isArray(data.b) ? data.b : [],
        asks: Array.isArray(data.a) ? data.a : [],
        eventTime, ingestTime
      }
    }
  }

  // --- kline (forming/closed candles straight from the exchange) -----------
  if (e === 'kline' || stream.includes('@kline_')) {
    const k = data.k
    if (!k || typeof k !== 'object') return null
    const closed = k.x === true
    const event = candleEvent({
      source, market: kind,
      symbol: String(k.s || data.s || stream.split('@')[0] || '').toUpperCase(),
      timeframe: String(k.i),
      state: closed ? 'closed' : 'forming',
      open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v,
      openTime: num(k.t),
      closeTime: num(k.T),
      eventTime: Number.isFinite(num(data.E)) ? num(data.E) : (closed ? num(k.T) : ingestTime)
    }, ingestTime)
    return { topic: TOPICS.CANDLE, event }
  }

  return null
}

/**
 * @param {object} [opts]
 * @param {'fapi'|'spot'} [opts.market='fapi']
 * @param {string[]} [opts.symbols=['BTCUSDT']]
 * @param {string|null} [opts.klineInterval=null] e.g. '1m' -> @kline_1m stream
 * @param {boolean} [opts.depth=false] subscribe depth diffs too
 * @param {boolean} [opts.trades=true]
 * @param {boolean} [opts.bookTicker=true]
 * @param {string} [opts.base] override WS base url
 * @param {WebSocket} [opts.WebSocketImpl=globalThis.WebSocket]
 * @param {readonly number[]} [opts.backoffMs=DEFAULT_BACKOFF_MS]
 * @param {(fn:Function, ms:number)=>any} [opts.setTimeoutFn]
 * @param {(h:any)=>void} [opts.clearTimeoutFn]
 * @param {() => number} [opts.ingest]
 */
export function createBinanceProvider({
  market = 'fapi',
  symbols = ['BTCUSDT'],
  klineInterval = null,
  depth = false,
  trades = true,
  bookTicker = true,
  base,
  WebSocketImpl,
  backoffMs = DEFAULT_BACKOFF_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  ingest = defaultIngest,
  source = 'binance'
} = {}) {
  if (!(market in DEFAULT_WS) && !base) throw new Error(`binance: market must be ${Object.keys(DEFAULT_WS).join('|')} (got ${market})`)
  const wsBase = base || DEFAULT_WS[market]
  const streams = buildStreams({ symbols, trades, bookTicker, klineInterval, depth })
  const url = buildUrl(wsBase, streams)
  const WS = WebSocketImpl ?? globalThis.WebSocket
  if (typeof WS !== 'function') throw new Error('binance: no WebSocket implementation available (inject WebSocketImpl)')

  let ws = null
  let state = 'idle'          // idle | connecting | connected | disconnected
  let attempt = 0
  let closedByUs = false
  let timer = null
  let hooks = null
  const lastTradeId = new Map() // stream key -> last exchange trade id
  const stats = { opened: 0, closed: 0, reconnects: 0, messages: 0, normalized: 0, ignored: 0, dupTrades: 0, parseErrors: 0 }

  const emitStatus = (extra = {}) => {
    try { hooks?.onStatus({ provider: source, market, state, attempt, url, streams: streams.length, ...extra }) } catch { /* status must not kill the feed */ }
  }

  /** Detach every handler so a retired socket can never call back in. */
  const strip = (sock) => {
    if (!sock) return
    sock.onopen = null
    sock.onmessage = null
    sock.onerror = null
    sock.onclose = null
  }

  const scheduleReconnect = () => {
    if (closedByUs || timer) return
    const idx = Math.min(attempt, backoffMs.length - 1)
    const delay = backoffMs[Math.max(0, idx)]
    attempt++
    timer = setTimeoutFn(() => {
      timer = null
      if (closedByUs) return
      stats.reconnects++
      open(false)
    }, delay)
    emitStatus({ nextRetryMs: delay })
  }

  const onMessage = (evt) => {
    if (closedByUs || !hooks) return // retired feed: never dispatch after close()
    const raw = evt && typeof evt === 'object' && 'data' in evt ? evt.data : evt
    stats.messages++
    let parsed
    try { parsed = normalizeMessage(raw, { source, market, ingest }) }
    catch (err) {
      stats.parseErrors++
      try { hooks?.onStatus({ provider: source, state, parseError: err instanceof Error ? err.message : String(err) }) } catch { /* isolated */ }
      return
    }
    if (!parsed) { stats.ignored++; return }

    // Trade-id dedupe per stream (acceptance: no duplicate events after
    // reconnect/replay). Only exchange ids are deduped — quotes/depth run
    // their own sequencing inside the stores.
    if (parsed.topic === TOPICS.TRADE && parsed.event.id !== undefined) {
      const key = `${parsed.event.symbol}@${parsed.event.market}`
      const lastId = lastTradeId.get(key)
      if (lastId !== undefined && parsed.event.id <= lastId) {
        stats.dupTrades++
        return
      }
      lastTradeId.set(key, parsed.event.id)
    }

    stats.normalized++
    try { hooks?.onEvent(parsed.event, parsed.topic) } catch (err) {
      try { hooks?.onStatus({ provider: source, state, eventError: err instanceof Error ? err.message : String(err) }) } catch { /* isolated */ }
    }
  }

  const open = (resetAttempt) => {
    if (resetAttempt) attempt = 0
    closedByUs = false
    state = 'connecting'
    stats.opened++
    let sock
    try { sock = new WS(url) } catch (err) {
      state = 'disconnected'
      emitStatus({ error: err instanceof Error ? err.message : String(err) })
      scheduleReconnect()
      return
    }
    ws = sock
    sock.onopen = () => {
      state = 'connected'
      attempt = 0 // fresh backoff ladder after a successful open
      emitStatus()
    }
    sock.onmessage = onMessage
    sock.onerror = () => {
      if (ws !== sock) return // retired socket: never touch live state
      state = 'disconnected'
      emitStatus({ error: 'ws error' })
      // Hardened: some runtimes drop the socket after 'error' without a
      // follow-up 'close' — start the backoff ladder here, guarded once.
      scheduleReconnect()
    }
    sock.onclose = () => {
      stats.closed++
      if (ws !== sock) return // retired socket: stats only
      ws = null
      if (closedByUs) { state = 'idle'; emitStatus(); return }
      state = 'disconnected'
      scheduleReconnect()
    }
    emitStatus()
  }

  return {
    id: 'binance',
    markets: [market],
    market,
    url,
    streams: () => [...streams],

    connect(hooksIn) {
      assertHooks(hooksIn)
      hooks = hooksIn
      if (timer) { clearTimeoutFn(timer); timer = null }
      if (ws) { const old = ws; ws = null; strip(old); try { old.close?.() } catch { /* old socket */ } }
      open(true)
    },

    close() {
      closedByUs = true
      if (timer) { clearTimeoutFn(timer); timer = null }
      if (ws) { const old = ws; ws = null; strip(old); try { old.close?.() } catch { /* old socket */ } }
      state = 'idle'
      if (hooks) emitStatus()
    },

    status: () => ({ provider: source, market, state, attempt, url, streams: streams.length, stats: { ...stats } }),
    stats: () => ({ ...stats })
  }
}
