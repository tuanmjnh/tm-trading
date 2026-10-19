// =============================================================================
//  TM TRADING — REST 24h ticker poller (Band-1 telemetry).
//
//  The provider subscribes the fapi `@ticker` WS stream, but some venues or
//  networks never deliver it — while trade/bookTicker on the SAME connection
//  flow fine. The exchange REST 24hr ticker carries the SAME rolling window,
//  so poll it on a slow cadence and route every row through the plane: the
//  ticker24 store's stale-guard merges WS + REST safely (newer eventTime wins,
//  never a fabricated row).
//
//  Fail-soft by design: a fetch failure only bumps stats.failures — the last
//  known row keeps serving Band 1 until the next poll succeeds.
//
//  Zero dependencies: global fetch, injectable fetchImpl/timers for tests.
// =============================================================================

import { TOPICS, ticker24Event, defaultIngest } from './events.mjs'

const REST_BASES = { fapi: 'https://fapi.binance.com', spot: 'https://api.binance.com' }
const TICKER_PATHS = { fapi: '/fapi/v1/ticker/24hr', spot: '/api/v3/ticker/24hr' }

/**
 * @param {object} opts
 * @param {string[]} [opts.symbols=['BTCUSDT']]
 * @param {() => string[]} [opts.getSymbols] live symbol source (runtime-added
 *   symbols included) — preferred over the static `symbols` snapshot above
 * @param {'fapi'|'spot'} [opts.market='fapi']
 * @param {(event: object, topic: string) => void} opts.route  plane.route (D17 gate + store + bus)
 * @param {object} [opts.bus] event bus — when provided, WS ticker24 frames
 *   pause the REST poll per symbol (D34: no fake realtime from REST polling
 *   when WS delivers; the poll stays the fallback where WS is silent)
 * @param {string} [opts.base]       override the REST base URL
 * @param {number} [opts.intervalMs=30000] poll cadence per full sweep
 * @param {typeof fetch} [opts.fetchImpl=globalThis.fetch]
 * @param {(fn: Function, ms: number) => any} [opts.setIntervalFn]
 * @param {(id: any) => void} [opts.clearIntervalFn]
 * @param {() => number} [opts.ingest]
 */
export function createTicker24Poll({
  symbols = ['BTCUSDT'],
  getSymbols = null,
  market = 'fapi',
  bus = null,
  route,
  base,
  intervalMs = 30_000,
  fetchImpl = globalThis.fetch,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  ingest = defaultIngest
} = {}) {
  if (typeof route !== 'function') throw new Error('ticker24Poll: plane route() required')
  if (!base && !(market in REST_BASES)) throw new Error(`ticker24Poll: market must be ${Object.keys(REST_BASES).join('|')} (got ${market})`)
  if (typeof fetchImpl !== 'function') throw new Error('ticker24Poll: fetchImpl required')
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('ticker24Poll: intervalMs must be > 0')

  const restBase = base || REST_BASES[market]
  const tickerPath = TICKER_PATHS[market] || '/fapi/v1/ticker/24hr'
  const stats = { polls: 0, routed: 0, failures: 0, wsYielded: 0 }
  let timer = null
  let stopped = false

  // D34: remember the last WS ticker per symbol — a fresh WS frame pauses
  // the REST poll for that symbol (2 windows), so REST stays a fallback.
  const lastWs = new Map()
  let offWs = null
  if (bus && typeof bus.on === 'function') {
    offWs = bus.on(TOPICS.TICKER_24H, (ev) => {
      // Only provider frames count — our own routed REST rows re-emit on
      // the same topic and must not suppress the next poll.
      if (ev && typeof ev === 'object' && ev.source !== 'ticker24-poll' && typeof ev.symbol === 'string') {
        lastWs.set(ev.symbol, Date.now())
      }
    })
  }

  const tickerUrl = (symbol) =>
    `${restBase}${tickerPath}?symbol=${encodeURIComponent(symbol)}`

  /** REST 24hr row -> canonical event. Throws on a bad shape (fail-soft: counted, never routed). */
  const toEvent = (symbol, body, now) => ticker24Event({
    // Transport-stamped source (depthSync 'depth' precedent): lets the D34
    // WS-yield guard tell polled rows apart from genuine WS frames.
    source: 'ticker24-poll', market: market === 'fapi' ? 'futures' : market,
    symbol,
    lastPrice: body?.lastPrice,
    openPrice: body?.openPrice,
    highPrice: body?.highPrice,
    lowPrice: body?.lowPrice,
    baseVolume: body?.volume,
    quoteVolume: body?.quoteVolume,
    priceChange: body?.priceChange,
    priceChangePercent: body?.priceChangePercent,
    trades: body?.count,
    // fapi/spot 24hr payloads carry no event timestamp — the window closes
    // "now" (closeTime when present), so stamp receipt time, never a guess.
    eventTime: Number.isFinite(Number(body?.closeTime)) ? Number(body.closeTime) : now
  }, now)

  const pollSymbol = async (symbol) => {
    if (stopped) return
    // D34: a fresh WS frame pauses REST for this symbol (2 windows).
    if (Date.now() - (lastWs.get(symbol) ?? Number.NEGATIVE_INFINITY) < intervalMs * 2) {
      stats.wsYielded++
      return
    }
    try {
      const res = await fetchImpl(tickerUrl(symbol))
      if (!res || typeof res.json !== 'function') throw new Error('ticker24: bad response object')
      if (res.ok === false) throw new Error(`ticker24 HTTP ${res.status ?? '?'}`)
      const body = await res.json()
      const now = ingest()
      route(toEvent(symbol, body, now), TOPICS.TICKER_24H)
      stats.routed++
    } catch {
      if (!stopped) stats.failures++
    }
  }

  const pollOnce = async () => {
    const list = typeof getSymbols === 'function' ? getSymbols() : symbols
    for (const symbol of Array.isArray(list) ? list : []) {
      if (stopped) return
      stats.polls++
      await pollSymbol(symbol)
    }
  }

  return {
    pollOnce,
    stats: () => ({ ...stats }),
    start() {
      if (timer) return
      stopped = false
      void pollOnce()
      timer = setIntervalFn(() => { void pollOnce() }, intervalMs)
    },
    stop() {
      stopped = true
      if (timer) { try { clearIntervalFn(timer) } catch { /* already gone */ } timer = null }
      if (offWs) { try { offWs() } catch { /* already gone */ } offWs = null }
    }
  }
}
