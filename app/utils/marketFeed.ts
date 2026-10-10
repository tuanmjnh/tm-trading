// =============================================================================
//  TM TRADING — client-side market feed helpers (S5).
//
//  Pure, framework-free logic shared by the /trade page:
//    * applyFeedMessage — reducer for /ws/market frames (hello + canonical
//      market.* events, §7/D16) into one plain state object
//    * candlesToBars / upsertBar — canonical candles -> lightweight-charts
//      bars (time in UTCTimestamp SECONDS — the chart API contract)
//  The composable (useMarketStream) owns the socket and Vue reactivity; the
//  chart component owns the library. Everything in between lives here and is
//  covered offline by tests/market-feed.test.ts.
// =============================================================================

// ---------------------------------------------------------------------------
// Wire types (mirrors of the /ws/market protocol — server/utils/market-socket)
// ---------------------------------------------------------------------------

export interface HelloMessage {
  type: 'hello'
  protocol: number
  serverTime: number
  clock: { mode: string; now: number }
  topics: string[]
  symbols: string[]
  timeframes: string[]
  quotes: QuoteSnapshotRow[]
  bookSymbols: string[]
  provider: Record<string, unknown> | null
  monitor: Record<string, unknown>
}

export interface QuoteSnapshotRow {
  symbol: string
  bid?: number
  ask?: number
  last?: number
  eventTime?: number
}

export interface CandleMessage {
  type: 'market.candle'
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

export interface TradeMessage {
  type: 'market.trade'
  source: string
  symbol: string
  market?: string
  price: number
  eventTime: number
  ingestTime: number
  quantity?: number
  side?: 'buy' | 'sell'
  id?: number
}

export interface QuoteMessage {
  type: 'market.quote'
  source: string
  symbol: string
  market?: string
  bid?: number
  ask?: number
  last?: number
  eventTime: number
  ingestTime: number
  updateId?: number
}

export interface StatusMessage {
  type: 'market.status'
  provider?: string
  market?: string
  state?: string
  attempt?: number
  url?: string
  streams?: number
  eventTime?: number
}

/** One price level: [price, qty] as plain numbers. */
export type BookLevel = [number, number]

export interface BookMessage {
  type: 'market.book'
  symbol: string
  bids: BookLevel[]
  asks: BookLevel[]
  synced: boolean
  lastUpdateId?: number
  eventTime: number
  source?: string
  ingestTime?: number
}

/** Materialized ladder per symbol (the plane publishes full books, not diffs). */
export interface BookLadder {
  symbol: string
  bids: BookLevel[]
  asks: BookLevel[]
  eventTime: number
  lastUpdateId?: number
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface FeedState {
  connection: ConnectionState
  hello: HelloMessage | null
  /** Last quote per symbol. */
  quotes: Record<string, QuoteMessage>
  /** Last candle per `${symbol}|${timeframe}`. */
  lastCandles: Record<string, CandleMessage>
  /** Recent trades, NEWEST FIRST, capped. */
  trades: TradeMessage[]
  /** Last trade per symbol (watchlist ticker). */
  lastTrades: Record<string, TradeMessage>
  /** Materialized depth ladder per symbol (S6 orderbook panel). */
  books: Record<string, BookLadder>
  providerStatus: StatusMessage | null
  lastError: string | null
  /** Frames that failed JSON parsing (observability, never thrown). */
  parseErrors: number
  /** Canonical frames successfully applied. */
  frames: number
}

export const TAPE_MAX = 100
/** Per-side levels kept for the ladder panel (server sends 50). */
export const BOOK_LEVELS = 30

export function createFeedState(): FeedState {
  return {
    connection: 'idle',
    hello: null,
    quotes: {},
    lastCandles: {},
    trades: [],
    lastTrades: {},
    books: {},
    providerStatus: null,
    lastError: null,
    parseErrors: 0,
    frames: 0
  }
}

export const candleKey = (symbol: string, timeframe: string): string => `${symbol}|${timeframe}`

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type ApplyResult = 'ok' | 'bad-json' | 'bad-frame' | 'ignored'

/** Coerce depth levels to [price, qty] numbers, dropping malformed rows. */
const normalizeLevels = (raw: unknown[]): BookLevel[] => {
  const out: BookLevel[] = []
  for (const lvl of raw) {
    if (!Array.isArray(lvl) || lvl.length < 2) continue
    const price = Number(lvl[0])
    const qty = Number(lvl[1])
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue
    out.push([price, qty])
  }
  return out
}

/**
 * Apply ONE /ws/market frame to the state (mutates in place — the composable
 * wraps it in Vue `reactive`). Never throws: malformed frames only bump
 * counters. Returns how the frame was classified (tests assert on it).
 */
export function applyFeedMessage(state: FeedState, raw: unknown): ApplyResult {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      state.parseErrors++
      return 'bad-json'
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    state.parseErrors++
    return 'bad-frame'
  }
  const msg = parsed as Record<string, unknown>
  const type = typeof msg.type === 'string' ? msg.type : ''

  switch (type) {
    case 'hello': {
      state.hello = msg as unknown as HelloMessage
      for (const row of (msg.quotes as QuoteSnapshotRow[] | undefined) ?? []) {
        if (!row || typeof row.symbol !== 'string') continue
        state.quotes[row.symbol] = {
          type: 'market.quote',
          source: 'hello',
          symbol: row.symbol,
          bid: row.bid,
          ask: row.ask,
          last: row.last,
          eventTime: Number(row.eventTime) || 0,
          ingestTime: 0
        }
      }
      state.frames++
      return 'ok'
    }
    case 'market.candle': {
      const c = msg as unknown as CandleMessage
      if (typeof c.symbol !== 'string' || typeof c.timeframe !== 'string' || !Number.isFinite(c.openTime)) {
        state.parseErrors++
        return 'bad-frame'
      }
      const key = candleKey(c.symbol, c.timeframe)
      const prev = state.lastCandles[key]
      // One slot per bucket: ignore frames older than what we already show
      // (a closed bar must not be overwritten by a stale forming retry).
      if (!prev || c.openTime >= prev.openTime) state.lastCandles[key] = c
      state.frames++
      return 'ok'
    }
    case 'market.trade': {
      const t = msg as unknown as TradeMessage
      if (typeof t.symbol !== 'string' || !Number.isFinite(t.price)) {
        state.parseErrors++
        return 'bad-frame'
      }
      state.trades.unshift(t)
      if (state.trades.length > TAPE_MAX) state.trades.length = TAPE_MAX
      state.lastTrades[t.symbol] = t
      state.frames++
      return 'ok'
    }
    case 'market.quote': {
      const q = msg as unknown as QuoteMessage
      if (typeof q.symbol !== 'string') {
        state.parseErrors++
        return 'bad-frame'
      }
      const prev = state.quotes[q.symbol]
      if (!prev || (q.eventTime ?? 0) >= prev.eventTime) state.quotes[q.symbol] = q
      state.frames++
      return 'ok'
    }
    case 'market.status': {
      state.providerStatus = msg as unknown as StatusMessage
      state.frames++
      return 'ok'
    }
    case 'market.book': {
      const b = msg as unknown as BookMessage
      if (typeof b.symbol !== 'string' || !Array.isArray(b.bids) || !Array.isArray(b.asks)) {
        state.parseErrors++
        return 'bad-frame'
      }
      state.books[b.symbol] = {
        symbol: b.symbol,
        bids: normalizeLevels(b.bids).slice(0, BOOK_LEVELS),
        asks: normalizeLevels(b.asks).slice(0, BOOK_LEVELS),
        eventTime: Number.isFinite(b.eventTime) ? b.eventTime : 0,
        lastUpdateId: Number.isFinite(b.lastUpdateId) ? b.lastUpdateId : undefined
      }
      state.frames++
      return 'ok'
    }
    case 'pong':
      return 'ignored'
    case 'error': {
      state.lastError = typeof msg.error === 'string' ? msg.error : 'server-error'
      return 'ignored'
    }
    default:
      return 'ignored'
  }
}

// ---------------------------------------------------------------------------
// Chart mapping (canonical candle -> lightweight-charts bar)
// ---------------------------------------------------------------------------

/** lightweight-charts `UTCTimestamp` — SECONDS since epoch. */
export interface ChartBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type CandleInput = Pick<CandleMessage, 'openTime' | 'open' | 'high' | 'low' | 'close' | 'volume'>

const toBar = (c: CandleInput): ChartBar => ({
  time: Math.floor(Number(c.openTime) / 1000),
  open: Number(c.open),
  high: Number(c.high),
  low: Number(c.low),
  close: Number(c.close),
  volume: Number.isFinite(c.volume) ? Number(c.volume) : 0
})

/**
 * REST history -> ascending, de-duplicated bars (keep the LAST row per
 * openTime — the forming bar may repeat).
 */
export function candlesToBars(candles: CandleInput[]): ChartBar[] {
  const byTime = new Map<number, ChartBar>()
  for (const c of candles) {
    if (!c || !Number.isFinite(c.openTime)) continue
    const bar = toBar(c)
    byTime.set(bar.time, bar)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/**
 * Apply one live candle to an existing bar array (immutable — Vue reactivity
 * sees a new array). Same bucket -> replace; newer -> append; older -> no-op.
 */
export function upsertBar(bars: ChartBar[], candle: CandleInput): ChartBar[] {
  if (!candle || !Number.isFinite(candle.openTime)) return bars
  const bar = toBar(candle)
  const last = bars[bars.length - 1]
  if (!last) return [bar]
  if (bar.time < last.time) return bars
  if (bar.time === last.time) {
    const next = bars.slice()
    next[next.length - 1] = bar
    return next
  }
  return [...bars, bar]
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Compact price formatting: more decimals as the price shrinks. */
export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null || !Number.isFinite(price)) return '—'
  const abs = Math.abs(price)
  if (abs >= 1000) return price.toFixed(1)
  if (abs >= 1) return price.toFixed(2)
  if (abs >= 0.01) return price.toFixed(4)
  return price.toFixed(6)
}

/** Bid-ask spread in price units, or null when a side is missing. */
export function spreadOf(quote: QuoteMessage | undefined): number | null {
  if (!quote || quote.bid === undefined || quote.ask === undefined) return null
  const spread = quote.ask - quote.bid
  return Number.isFinite(spread) ? spread : null
}

/** Compact quantity formatting (more decimals as the size shrinks). */
export function formatQty(qty: number | undefined | null): string {
  if (qty === undefined || qty === null || !Number.isFinite(qty)) return '—'
  const abs = Math.abs(qty)
  if (abs >= 1000) return qty.toFixed(0)
  if (abs >= 100) return qty.toFixed(1)
  if (abs >= 1) return qty.toFixed(2)
  return qty.toFixed(4)
}
