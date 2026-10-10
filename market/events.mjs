// =============================================================================
//  TM TRADING — canonical market events (roadmap V2 §7, D16).
//
//  Every consumer reads THESE events, never a raw exchange payload (§7 rule).
//  D16: every event carries `eventTime` (trading time — what strategies use),
//  `ingestTime` (arrival time — latency/observability ONLY) and `source`.
//
//  Pure + dependency-free: no WebSocket, no clock, no IO (D15 — `market/` is
//  transport/aggregation, but this file is the shared vocabulary).
// =============================================================================

export const TOPICS = Object.freeze({
  TRADE: 'market.trade',
  QUOTE: 'market.quote',
  CANDLE: 'market.candle',
  BOOK: 'market.book',
  STATUS: 'market.status'
})

export const MARKET_KINDS = Object.freeze(['spot', 'futures', 'gold'])

const req = (cond, msg) => { if (!cond) throw new Error(`event: ${msg}`) }

const finite = (v) => Number.isFinite(Number(v))

/** Default ingest stamp — injectable for tests (D16). */
export const defaultIngest = () => Date.now()

/**
 * `market.trade` (§7). `raw` = provider-shaped {symbol, price, quantity?, side?,
 * eventTime, market?, source?, id?}; `ingest` overrides Date.now() in tests.
 */
export function tradeEvent(raw, ingest = defaultIngest()) {
  req(raw && typeof raw === 'object' && !Array.isArray(raw), 'trade raw object required')
  const source = String(raw.source || '')
  const symbol = String(raw.symbol || '')
  req(source, 'source required')
  req(symbol, 'symbol required')
  const market = raw.market ?? 'futures'
  req(MARKET_KINDS.includes(market), `market must be one of ${MARKET_KINDS.join('|')}`)
  const price = Number(raw.price)
  req(finite(price) && price > 0, `price must be > 0 (got ${raw.price})`)
  const quantity = raw.quantity === undefined || raw.quantity === null ? undefined : Number(raw.quantity)
  if (quantity !== undefined) req(finite(quantity) && quantity >= 0, `quantity must be >= 0 (got ${raw.quantity})`)
  const side = raw.side === undefined || raw.side === null ? undefined : raw.side
  req(side === undefined || side === 'buy' || side === 'sell', 'side must be buy|sell')
  const eventTime = Number(raw.eventTime)
  req(finite(eventTime), `eventTime required (got ${raw.eventTime})`)
  const ingestTime = Number(ingest)
  req(finite(ingestTime), 'ingestTime must be a number')
  const ev = { type: TOPICS.TRADE, source, symbol, market, price, eventTime, ingestTime }
  if (quantity !== undefined) ev.quantity = quantity
  if (side !== undefined) ev.side = side
  if (raw.id !== undefined && raw.id !== null) ev.id = Number(raw.id)
  return ev
}

/**
 * `market.quote` (§7). `raw` = {symbol, bid?, ask?, last?, eventTime, source,
 * market?, updateId?}. At least one of bid/ask/last is required.
 */
export function quoteEvent(raw, ingest = defaultIngest()) {
  req(raw && typeof raw === 'object' && !Array.isArray(raw), 'quote raw object required')
  const source = String(raw.source || '')
  const symbol = String(raw.symbol || '')
  req(source, 'source required')
  req(symbol, 'symbol required')
  const market = raw.market ?? 'futures'
  req(MARKET_KINDS.includes(market), `market must be one of ${MARKET_KINDS.join('|')}`)
  const pick = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))
  const bid = pick(raw.bid)
  const ask = pick(raw.ask)
  const last = pick(raw.last)
  for (const [k, v] of [['bid', bid], ['ask', ask], ['last', last]]) {
    if (v !== undefined) req(finite(v) && v > 0, `${k} must be > 0 (got ${raw[k]})`)
  }
  req(bid !== undefined || ask !== undefined || last !== undefined, 'one of bid/ask/last required')
  if (bid !== undefined && ask !== undefined) req(bid <= ask, 'bid must be <= ask')
  const eventTime = Number(raw.eventTime)
  req(finite(eventTime), `eventTime required (got ${raw.eventTime})`)
  const ingestTime = Number(ingest)
  req(finite(ingestTime), 'ingestTime must be a number')
  const ev = { type: TOPICS.QUOTE, source, symbol, market, eventTime, ingestTime }
  if (bid !== undefined) ev.bid = bid
  if (ask !== undefined) ev.ask = ask
  if (last !== undefined) ev.last = last
  if (raw.updateId !== undefined && raw.updateId !== null) ev.updateId = Number(raw.updateId)
  return ev
}

/**
 * `market.candle` (§7 + D16). `state`: 'forming' | 'closed'.
 * eventTime default: closed -> closeTime (the bar EXISTS at its boundary),
 * forming -> ingest (it is being written right now).
 */
export function candleEvent(raw, ingest = defaultIngest()) {
  req(raw && typeof raw === 'object' && !Array.isArray(raw), 'candle raw object required')
  const source = String(raw.source || '')
  const symbol = String(raw.symbol || '')
  const timeframe = String(raw.timeframe || '')
  req(source, 'source required')
  req(symbol, 'symbol required')
  req(timeframe, 'timeframe required')
  const state = raw.state
  req(state === 'forming' || state === 'closed', 'state must be forming|closed')
  const open = Number(raw.open)
  const high = Number(raw.high)
  const low = Number(raw.low)
  const close = Number(raw.close)
  const volume = Number(raw.volume)
  for (const [k, v] of [['open', open], ['high', high], ['low', low], ['close', close]]) {
    req(finite(v) && v > 0, `${k} must be > 0 (got ${raw[k]})`)
  }
  req(finite(volume) && volume >= 0, `volume must be >= 0 (got ${raw.volume})`)
  req(high >= Math.max(open, close) && low <= Math.min(open, close), 'OHLC inconsistent: high/low must contain open/close')
  const openTime = Number(raw.openTime)
  const closeTime = Number(raw.closeTime)
  req(finite(openTime), 'openTime required')
  req(finite(closeTime), 'closeTime required')
  req(closeTime > openTime, 'closeTime must be > openTime')
  const ingestTime = Number(ingest)
  req(finite(ingestTime), 'ingestTime must be a number')
  const fallbackEventTime = state === 'closed' ? closeTime : ingestTime
  const eventTime = raw.eventTime === undefined || raw.eventTime === null ? fallbackEventTime : Number(raw.eventTime)
  req(finite(eventTime), 'eventTime must be a number')
  return {
    type: TOPICS.CANDLE, source, symbol, timeframe, state,
    open, high, low, close, volume, openTime, closeTime, eventTime, ingestTime
  }
}
