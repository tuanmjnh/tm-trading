// =============================================================================
//  TM TRADING — REST market history (roadmap V2 §17 "Historical", S4).
//
//  GET /api/v1/markets/:instrument/{candles,trades,orderbook} proxy the
//  PUBLIC Binance REST API and normalize payloads into the canonical market
//  event vocabulary (market/events.mjs — §7/D16), so REST responses and
//  /ws/market frames speak exactly the same shapes.
//
//  4m/10m are NOT Binance intervals (see engine/data.mjs MUST_RESAMPLE):
//  they are composed here from 1m klines through market/aggregate.mjs — the
//  same aggregator the realtime plane uses — so REST history and live WS
//  candles share identical bucket boundaries.
//
//  Design notes:
//  - .mjs engine modules load through dynamic pathToFileURL imports — the
//    established pattern in server/utils (journal.ts, intel.ts, market-plane).
//  - All pure logic (param parsing, row normalizing, URL building) is
//    exported and covered offline by tests/markets-api.test.ts (no network).
//  - Upstream failures map to MarketRestError: 404 unknown symbol,
//    502 unreachable/malformed upstream, 400 bad request params.
// =============================================================================

import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createError } from 'h3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical `market.candle` event (market/events.mjs candleEvent). */
export interface CandleEvent {
  type: string
  source: string
  symbol: string
  timeframe: string
  state: 'forming' | 'closed'
  open: number
  high: number
  low: number
  close: number
  volume: number
  openTime: number
  closeTime: number
  eventTime: number
  ingestTime: number
}

/** Canonical `market.trade` event (market/events.mjs tradeEvent). */
export interface TradeEvent {
  type: string
  source: string
  symbol: string
  market: string
  price: number
  eventTime: number
  ingestTime: number
  quantity?: number
  side?: 'buy' | 'sell'
  id?: number
}

/** REST order book snapshot (NOT a market.book diff event — no exchange E time). */
export interface OrderBookSnapshot {
  type: 'orderbook'
  source: string
  symbol: string
  market: string
  lastUpdateId: number
  bids: Array<{ price: number; qty: number }>
  asks: Array<{ price: number; qty: number }>
  eventTime: number
  ingestTime: number
}

/** REST funding / premium index row (Binance /fapi/v1/premiumIndex). */
export interface FundingRate {
  type: 'funding'
  source: string
  symbol: string
  market: string
  markPrice: number
  indexPrice: number
  lastFundingRate: number
  nextFundingTime: number
  eventTime: number
  ingestTime: number
}

/** REST open interest row (Binance /fapi/v1/openInterest). */
export interface OpenInterest {
  type: 'openInterest'
  source: string
  symbol: string
  market: string
  openInterest: number
  eventTime: number
  ingestTime: number
}

export type MarketKind = 'spot' | 'futures'

/** Narrow fetch shape so tests can fake it without a real Response. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/** Upstream request error with an HTTP status the route should return. */
export class MarketRestError extends Error {
  statusCode: number
  code: string
  constructor(message: string, statusCode: number, code: string) {
    super(message)
    this.name = 'MarketRestError'
    this.statusCode = statusCode
    this.code = code
  }
}

const badRequest = (msg: string) => new MarketRestError(msg, 400, 'error.badRequest')
const upstream = (msg: string) => new MarketRestError(msg, 502, 'error.upstreamFailed')

/** Convert a caught error into an h3 HTTP error (pass-through when not ours). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof MarketRestError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.code, message: err.message })
  }
  return err
}

// ---------------------------------------------------------------------------
// Upstream access (Binance public REST, no API key)
// ---------------------------------------------------------------------------

export const REST_BASE = Object.freeze({
  spot: 'https://api.binance.com',
  futures: 'https://fapi.binance.com'
})

const REST_PATH = Object.freeze({
  klines: { spot: '/api/v3/klines', futures: '/fapi/v1/klines' },
  trades: { spot: '/api/v3/trades', futures: '/fapi/v1/trades' },
  depth: { spot: '/api/v3/depth', futures: '/fapi/v1/depth' },
  premiumIndex: { spot: '/api/v3/premiumIndex', futures: '/fapi/v1/premiumIndex' },
  openInterest: { spot: '/api/v3/openInterest', futures: '/fapi/v1/openInterest' },
})

/**
 * GET one upstream JSON endpoint. Maps Binance error bodies to
 * MarketRestError: invalid symbol -> 404, anything else -> 502.
 *
 * Throttle statuses (418/429) are retried with backoff before giving up:
 * Binance rate-limit bans FLAP per request on a throttled IP, so a single
 * attempt fails far more often than the endpoint is actually down. Only
 * these statuses retry — network/parse errors keep their immediate throw.
 */
export async function fetchJson(
  url: string,
  fetchImpl: FetchLike = defaultFetch,
  opts: { throttleRetries?: number; throttleDelaysMs?: number[] } = {}
): Promise<unknown> {
  const throttleRetries = opts.throttleRetries ?? 2
  const delays = opts.throttleDelaysMs ?? [300, 900]
  let res: { ok: boolean; status: number; text(): Promise<string> }

  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) })
    } catch (err) {
      throw upstream(`market upstream unreachable: ${err instanceof Error ? err.message : String(err)}`)
    }
    const throttled = res.status === 418 || res.status === 429
    if (throttled && attempt < throttleRetries) {
      await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]))
      continue
    }
    break
  }

  let text = ''
  try {
    text = await res.text()
  } catch {
    text = ''
  }
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  // Binance error body: {code, msg} — detect before the HTTP-status check
  // (the symbol lookup can also fail on 200-class responses in mocks).
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as { code?: unknown; msg?: unknown }
    if (typeof p.code !== 'undefined' && typeof p.msg === 'string') {
      const invalidSymbol = Number(p.code) === -1121 || /invalid symbol/i.test(p.msg)
      const err = invalidSymbol
        ? new MarketRestError(`binance ${String(p.code)}: ${p.msg}`, 404, 'error.symbolNotFound')
        : upstream(`binance ${String(p.code)}: ${p.msg}`)
      throw err
    }
  }
  if (!res.ok) throw upstream(`market upstream HTTP ${res.status}`)
  if (payload === null && text !== '') throw upstream('market upstream returned invalid JSON')
  return payload
}

// ---------------------------------------------------------------------------
// Param parsing (pure — shared by routes and tests)
// ---------------------------------------------------------------------------

export function normalizeSymbol(raw: string | undefined): string {
  const symbol = String(raw ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{3,20}$/.test(symbol)) {
    throw badRequest(`instrument must be 3-20 alphanumeric characters (got "${String(raw ?? '')}")`)
  }
  return symbol
}

/** Query `market` (or env default). `fapi` is accepted as `futures`. */
export function normalizeMarket(raw: string | undefined, envDefault?: string): MarketKind {
  const v = String(raw ?? envDefault ?? 'futures').trim().toLowerCase()
  if (v === 'fapi' || v === 'futures') return 'futures'
  if (v === 'spot') return 'spot'
  throw badRequest(`market must be spot|futures (got "${String(raw ?? '')}")`)
}

/** Binance-native intervals — fetched directly from the exchange. */
export const NATIVE_INTERVALS = Object.freeze([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'
])

/** Composite intervals: composed from 1m klines (Binance has no 4m/10m). */
export const COMPOSITE_INTERVALS = Object.freeze({ '4m': 4, '10m': 10 })

export interface IntervalInfo {
  interval: string
  composite: boolean
  /** Base 1m rows a single upstream page can supply. */
  maxLimit: number
}

export function normalizeInterval(raw: string | undefined): IntervalInfo {
  const interval = String(raw ?? '1m').trim()
  if (NATIVE_INTERVALS.includes(interval)) {
    return { interval, composite: false, maxLimit: 1500 }
  }
  const bucketMin = COMPOSITE_INTERVALS[interval as keyof typeof COMPOSITE_INTERVALS]
  if (bucketMin) {
    return { interval, composite: true, maxLimit: Math.floor(1500 / bucketMin) }
  }
  throw badRequest(
    `interval not supported (got "${interval}"; native: ${NATIVE_INTERVALS.join(',')} | composite: ${Object.keys(COMPOSITE_INTERVALS).join(',')})`
  )
}

export function normalizeLimit(
  raw: string | undefined,
  opts: { min: number; max: number; def: number }
): number {
  if (raw === undefined || raw === '') return opts.def
  const s = String(raw).trim()
  if (!/^\d+$/.test(s)) throw badRequest(`limit must be an integer (got "${String(raw)}")`)
  const n = Number(s)
  if (n < opts.min || n > opts.max) {
    throw badRequest(`limit must be within ${opts.min}..${opts.max} (got ${n})`)
  }
  return n
}

/**
 * Binance depth page sizes — probe-verified live (docs drift often):
 * fapi rejects 30/40/200/300/400 with -4021, spot additionally accepts 30.
 */
const ORDERBOOK_LIMITS = Object.freeze({
  spot: [5, 10, 20, 30, 50, 100, 500, 1000],
  futures: [5, 10, 20, 50, 100, 500]
})

export function normalizeOrderbookLimit(raw: string | undefined, market: MarketKind): number {
  const allowed = ORDERBOOK_LIMITS[market]
  const n = normalizeLimit(raw, { min: allowed[0]!, max: allowed[allowed.length - 1]!, def: 100 })
  if (!allowed.includes(n)) {
    throw badRequest(`orderbook limit must be one of ${allowed.join(',')} for ${market} (got ${n})`)
  }
  return n
}

// ---------------------------------------------------------------------------
// Row normalizers (pure — validate upstream shapes, emit event "raw" objects)
// ---------------------------------------------------------------------------

const SOURCE = 'binance-rest'

function assertUpstream(cond: boolean, msg: string): asserts cond {
  if (!cond) throw upstream(`malformed upstream payload: ${msg}`)
}

/**
 * One Binance kline row -> raw input for candleEvent.
 * Row: [openTime, open, high, low, close, volume, closeTime, ...].
 * `state` mirrors reality: the last row is still forming while closeTime > now.
 */
export function klineRowToRaw(
  row: unknown,
  opts: { symbol: string; timeframe: string; now: number }
): Record<string, unknown> {
  assertUpstream(Array.isArray(row) && row.length >= 7, 'kline needs >= 7 columns')
  const openTime = Number(row[0])
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5])
  const closeTime = Number(row[6])
  assertUpstream(
    [openTime, open, high, low, close, volume, closeTime].every(Number.isFinite),
    'kline has non-finite values'
  )
  assertUpstream(high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low,
    'kline OHLC relations violated')
  assertUpstream(closeTime > openTime, 'kline closeTime must be > openTime')
  return {
    source: SOURCE,
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    state: closeTime > opts.now ? 'forming' : 'closed',
    open, high, low, close, volume, openTime, closeTime
  }
}

/**
 * One Binance trade row ({id, price, qty, time, isBuyerMaker}) -> raw input
 * for tradeEvent. `isBuyerMaker` is the WS `m` flag: true => aggressor sold.
 */
export function tradeRowToRaw(
  row: unknown,
  opts: { symbol: string; market: MarketKind }
): Record<string, unknown> {
  assertUpstream(row !== null && typeof row === 'object' && !Array.isArray(row), 'trade must be an object')
  const r = row as { id?: unknown; price?: unknown; qty?: unknown; time?: unknown; isBuyerMaker?: unknown }
  assertUpstream(typeof r.price === 'string' || typeof r.price === 'number', 'trade.price required')
  assertUpstream(typeof r.time === 'number', 'trade.time required')
  const out: Record<string, unknown> = {
    source: SOURCE,
    symbol: opts.symbol,
    market: opts.market,
    price: Number(r.price),
    eventTime: Number(r.time)
  }
  if (r.qty !== undefined && r.qty !== null) out.quantity = Number(r.qty)
  out.side = r.isBuyerMaker === true ? 'sell' : 'buy'
  if (r.id !== undefined && r.id !== null) out.id = Number(r.id)
  return out
}

/** Binance depth payload -> REST snapshot (levels as {price, qty} numbers). */
export function depthToSnapshot(
  payload: unknown,
  opts: { symbol: string; market: MarketKind; now: number }
): OrderBookSnapshot {
  assertUpstream(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'depth must be an object')
  const p = payload as { lastUpdateId?: unknown; bids?: unknown; asks?: unknown }
  assertUpstream(typeof p.lastUpdateId === 'number', 'depth.lastUpdateId required')
  const levels = (raw: unknown, side: string): Array<{ price: number; qty: number }> => {
    assertUpstream(Array.isArray(raw), `depth.${side} must be an array`)
    return raw.map((l, i) => {
      assertUpstream(Array.isArray(l) && l.length >= 2, `depth.${side}[${i}] malformed`)
      const price = Number(l[0])
      const qty = Number(l[1])
      assertUpstream(Number.isFinite(price) && Number.isFinite(qty), `depth.${side}[${i}] non-finite`)
      return { price, qty }
    })
  }
  return {
    type: 'orderbook',
    source: SOURCE,
    symbol: opts.symbol,
    market: opts.market,
    lastUpdateId: p.lastUpdateId,
    bids: levels(p.bids, 'bids'),
    asks: levels(p.asks, 'asks'),
    eventTime: opts.now,
    ingestTime: opts.now
  }
}

// ---------------------------------------------------------------------------
// market/*.mjs loader (same pathToFileURL pattern as journal/market-plane)
// ---------------------------------------------------------------------------

interface MarketLib {
  candleEvent: (raw: unknown, ingest?: number) => CandleEvent
  tradeEvent: (raw: unknown, ingest?: number) => TradeEvent
  createAggregator: (opts: {
    timeframe: string
    source?: string
    ingest?: () => number
  }) => {
    apply(candle: unknown): CandleEvent[]
    flush(): CandleEvent[]
    current(): null | {
      symbol: string
      openTime: number
      closeTime: number
      open: number
      high: number
      low: number
      close: number
      volume: number
    }
    stats(): Record<string, number>
  }
}

let libPromise: Promise<MarketLib> | null = null

function loadMarketLib(): Promise<MarketLib> {
  if (!libPromise) {
    libPromise = (async () => {
      const events = await import(pathToFileURL(join(process.cwd(), 'market', 'events.mjs')).href)
      const agg = await import(pathToFileURL(join(process.cwd(), 'market', 'aggregate.mjs')).href)
      return {
        candleEvent: events.candleEvent,
        tradeEvent: events.tradeEvent,
        createAggregator: agg.createAggregator
      } as MarketLib
    })()
  }
  return libPromise
}

// ---------------------------------------------------------------------------
// Orchestrators (routes call these)
// ---------------------------------------------------------------------------

export interface CandleResult {
  candles: CandleEvent[]
  meta: { symbol: string; market: MarketKind; interval: string; limit: number; count: number; composite: boolean; source: string }
}

function buildKlinesUrl(market: MarketKind, params: Record<string, string>): string {
  const u = new URL(REST_PATH.klines[market], REST_BASE[market])
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * GET candles. Native intervals come straight from Binance; 4m/10m are
 * composed from fetched 1m rows via market/aggregate.mjs (identical
 * boundaries to the realtime plane). Returns ascending bars, last = forming
 * when the exchange has one in progress.
 */
export async function getCandles(o: {
  symbol: string
  market: MarketKind
  interval: string
  limit: number
  fetchImpl?: FetchLike
  now?: number
  ingest?: number
}): Promise<CandleResult> {
  const info = normalizeInterval(o.interval)
  const now = o.now ?? Date.now()
  const lib = await loadMarketLib()
  const baseInterval = info.composite ? '1m' : o.interval
  const fetchLimit = info.composite
    ? Math.min(1500, o.limit * Number(COMPOSITE_INTERVALS[info.interval as keyof typeof COMPOSITE_INTERVALS]) + 10)
    : o.limit
  const url = buildKlinesUrl(o.market, {
    symbol: o.symbol,
    interval: baseInterval,
    limit: String(fetchLimit)
  })
  const payload = await fetchJson(url, o.fetchImpl)
  assertUpstream(Array.isArray(payload), 'klines payload must be an array')

  let candles: CandleEvent[]
  if (!info.composite) {
    candles = (payload as unknown[]).map((row) =>
      lib.candleEvent(klineRowToRaw(row, { symbol: o.symbol, timeframe: info.interval, now }), o.ingest)
    )
  } else {
    const ingest = o.ingest ?? Date.now()
    const agg = lib.createAggregator({
      timeframe: info.interval,
      source: SOURCE,
      ingest: () => ingest
    })
    const closed: CandleEvent[] = []
    for (const row of payload as unknown[]) {
      const raw = klineRowToRaw(row, { symbol: o.symbol, timeframe: '1m', now })
      if (raw.state !== 'closed') continue // only final 1m bars aggregate
      for (const ev of agg.apply(raw)) {
        if (ev.state === 'closed') closed.push(ev)
      }
    }
    candles = closed
    const cur = agg.current()
    if (cur) {
      candles.push(lib.candleEvent({
        source: SOURCE,
        symbol: o.symbol,
        timeframe: info.interval,
        state: 'forming',
        open: cur.open,
        high: cur.high,
        low: cur.low,
        close: cur.close,
        volume: cur.volume,
        openTime: cur.openTime,
        closeTime: cur.closeTime
      }, ingest))
    }
    candles = candles.slice(-o.limit)
  }

  return {
    candles,
    meta: {
      symbol: o.symbol,
      market: o.market,
      interval: info.interval,
      limit: o.limit,
      count: candles.length,
      composite: info.composite,
      source: url.split('?')[0] ?? url
    }
  }
}

/** GET recent public trades (ascending by exchange order). */
export async function getTrades(o: {
  symbol: string
  market: MarketKind
  limit: number
  fetchImpl?: FetchLike
  ingest?: number
}): Promise<{ trades: TradeEvent[]; meta: { symbol: string; market: MarketKind; limit: number; count: number; source: string } }> {
  const u = new URL(REST_PATH.trades[o.market], REST_BASE[o.market])
  u.searchParams.set('symbol', o.symbol)
  u.searchParams.set('limit', String(o.limit))
  const url = u.toString()
  const payload = await fetchJson(url, o.fetchImpl)
  assertUpstream(Array.isArray(payload), 'trades payload must be an array')
  const lib = await loadMarketLib()
  const trades = (payload as unknown[]).map((row) =>
    lib.tradeEvent(tradeRowToRaw(row, { symbol: o.symbol, market: o.market }), o.ingest)
  )
  return {
    trades,
    meta: { symbol: o.symbol, market: o.market, limit: o.limit, count: trades.length, source: url }
  }
}

/** GET order book snapshot (REST depth — not a market.book diff event). */
export async function getOrderBook(o: {
  symbol: string
  market: MarketKind
  limit: number
  fetchImpl?: FetchLike
  now?: number
}): Promise<{ book: OrderBookSnapshot; meta: { symbol: string; market: MarketKind; limit: number; bids: number; asks: number; source: string } }> {
  const u = new URL(REST_PATH.depth[o.market], REST_BASE[o.market])
  u.searchParams.set('symbol', o.symbol)
  u.searchParams.set('limit', String(o.limit))
  const url = u.toString()
  const payload = await fetchJson(url, o.fetchImpl)
  const book = depthToSnapshot(payload, { symbol: o.symbol, market: o.market, now: o.now ?? Date.now() })
  return {
    book,
    meta: { symbol: o.symbol, market: o.market, limit: o.limit, bids: book.bids.length, asks: book.asks.length, source: url }
  }
}

/** GET funding / premium index (Binance /fapi/v1/premiumIndex). */
export async function getFunding(o: {
  symbol: string
  market: MarketKind
  fetchImpl?: FetchLike
  ingest?: number
}): Promise<{ funding: FundingRate[]; meta: { symbol: string; market: MarketKind; count: number; source: string } }> {
  const u = new URL(REST_PATH.premiumIndex[o.market], REST_BASE[o.market])
  u.searchParams.set('symbol', o.symbol)
  const url = u.toString()
  const payload = await fetchJson(url, o.fetchImpl)
  assertUpstream(Array.isArray(payload), 'premiumIndex payload must be an array')
  const now = o.ingest ?? Date.now()
  const funding = (payload as unknown[]).map((row) => {
    const r = row as { symbol?: unknown; markPrice?: unknown; indexPrice?: unknown; lastFundingRate?: unknown; nextFundingTime?: unknown; time?: unknown }
    return {
      type: 'funding',
      source: SOURCE,
      symbol: String(r.symbol ?? o.symbol),
      market: o.market,
      markPrice: Number(r.markPrice ?? 0),
      indexPrice: Number(r.indexPrice ?? 0),
      lastFundingRate: Number(r.lastFundingRate ?? 0),
      nextFundingTime: Number(r.nextFundingTime ?? 0),
      eventTime: Number(r.time ?? now),
      ingestTime: now,
    }
  }) as FundingRate[]
  return {
    funding,
    meta: { symbol: o.symbol, market: o.market, count: funding.length, source: url }
  }
}

/** GET open interest (Binance /fapi/v1/openInterest). */
export async function getOpenInterest(o: {
  symbol: string
  market: MarketKind
  fetchImpl?: FetchLike
  ingest?: number
}): Promise<{ openInterest: OpenInterest; meta: { symbol: string; market: MarketKind; source: string } }> {
  const u = new URL(REST_PATH.openInterest[o.market], REST_BASE[o.market])
  u.searchParams.set('symbol', o.symbol)
  const url = u.toString()
  const payload = await fetchJson(url, o.fetchImpl)
  assertUpstream(typeof payload === 'object' && payload !== null, 'openInterest payload must be an object')
  const p = payload as { symbol?: unknown; openInterest?: unknown; time?: unknown }
  const now = o.ingest ?? Date.now()
  const openInterest: OpenInterest = {
    type: 'openInterest',
    source: SOURCE,
    symbol: String(p.symbol ?? o.symbol),
    market: o.market,
    openInterest: Number(p.openInterest ?? 0),
    eventTime: Number(p.time ?? now),
    ingestTime: now,
  }
  return {
    openInterest,
    meta: { symbol: o.symbol, market: o.market, source: url }
  }
}
