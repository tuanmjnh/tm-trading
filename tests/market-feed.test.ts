import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TAPE_MAX,
  BOOK_LEVELS,
  applyFeedMessage,
  candleKey,
  candlesToBars,
  createFeedState,
  formatPrice,
  formatQty,
  spreadOf,
  upsertBar,
  type CandleMessage,
  type TradeMessage
} from '../app/utils/marketFeed'

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)

const candle = (over: Partial<CandleMessage> = {}): CandleMessage => ({
  type: 'market.candle',
  source: 'plane',
  symbol: 'BTCUSDT',
  timeframe: '1m',
  state: 'forming',
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 10,
  openTime: T0,
  closeTime: T0 + 59_999,
  eventTime: T0,
  ingestTime: T0,
  ...over
})

const trade = (over: Partial<TradeMessage> = {}): TradeMessage => ({
  type: 'market.trade',
  source: 'binance',
  symbol: 'BTCUSDT',
  price: 100,
  eventTime: T0,
  ingestTime: T0,
  side: 'buy',
  ...over
})

describe('applyFeedMessage — hello + connection', () => {
  test('hello stores config and seeds the quote snapshot', () => {
    const state = createFeedState()
    const raw = JSON.stringify({
      type: 'hello',
      protocol: 1,
      serverTime: T0,
      clock: { mode: 'live', now: T0 },
      topics: ['market.trade'],
      symbols: ['BTCUSDT', 'ETHUSDT'],
      timeframes: ['1m', '4m', '10m'],
      quotes: [{ symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: T0 }],
      bookSymbols: ['BTCUSDT'],
      provider: null,
      monitor: {}
    })
    assert.equal(applyFeedMessage(state, raw), 'ok')
    assert.deepEqual(state.hello?.symbols, ['BTCUSDT', 'ETHUSDT'])
    assert.deepEqual(state.hello?.timeframes, ['1m', '4m', '10m'])
    assert.equal(state.quotes.BTCUSDT?.bid, 100)
    assert.equal(state.frames, 1)
  })

  test('garbage frames never throw — they bump parseErrors', () => {
    const state = createFeedState()
    assert.equal(applyFeedMessage(state, 'not-json{'), 'bad-json')
    assert.equal(applyFeedMessage(state, '[1,2]'), 'bad-frame')
    assert.equal(applyFeedMessage(state, '"hi"'), 'bad-frame')
    assert.equal(state.parseErrors, 3)
    assert.equal(state.frames, 0)
  })

  test('unknown/ping frames are ignored without counters', () => {
    const state = createFeedState()
    assert.equal(applyFeedMessage(state, '{"type":"pong","now":1}'), 'ignored')
    assert.equal(applyFeedMessage(state, '{"type":"mystery"}'), 'ignored')
    assert.equal(state.frames, 0)
    assert.equal(state.parseErrors, 0)
  })
})

describe('applyFeedMessage — canonical events', () => {
  test('candles land in one slot per symbol|timeframe', () => {
    const state = createFeedState()
    assert.equal(candleKey('BTCUSDT', '4m'), 'BTCUSDT|4m')

    assert.equal(applyFeedMessage(state, JSON.stringify(candle({ timeframe: '4m', state: 'forming' }))), 'ok')
    const closed = candle({ timeframe: '4m', state: 'closed', openTime: T0 + 240_000, closeTime: T0 + 479_999 })
    assert.equal(applyFeedMessage(state, JSON.stringify(closed)), 'ok')

    const slot = state.lastCandles['BTCUSDT|4m']
    assert.equal(slot?.state, 'closed')
    assert.equal(slot?.openTime, T0 + 240_000)
    assert.equal(Object.keys(state.lastCandles).length, 1)
  })

  test('a stale forming frame never overwrites a newer closed bar', () => {
    const state = createFeedState()
    applyFeedMessage(state, JSON.stringify(candle({ state: 'closed', openTime: T0, closeTime: T0 + 59_999 })))
    applyFeedMessage(state, JSON.stringify(candle({ state: 'forming', openTime: T0 - 60_000 }))) // older
    assert.equal(state.lastCandles['BTCUSDT|1m']?.state, 'closed')
    assert.equal(state.lastCandles['BTCUSDT|1m']?.openTime, T0)
  })

  test('trades prepend to the tape and stay capped', () => {
    const state = createFeedState()
    for (let i = 0; i < TAPE_MAX + 10; i++) {
      applyFeedMessage(state, JSON.stringify(trade({ price: i, eventTime: T0 + i })))
    }
    assert.equal(state.trades.length, TAPE_MAX)
    assert.equal(state.trades[0]?.price, TAPE_MAX + 9) // newest first
    assert.equal(state.lastTrades.BTCUSDT?.price, TAPE_MAX + 9) // ticker slot
  })

  test('quotes update per symbol; older eventTime is ignored', () => {
    const state = createFeedState()
    applyFeedMessage(state, JSON.stringify({ type: 'market.quote', source: 't', symbol: 'BTCUSDT', bid: 1, ask: 2, eventTime: 100, ingestTime: 100 }))
    applyFeedMessage(state, JSON.stringify({ type: 'market.quote', source: 't', symbol: 'BTCUSDT', bid: 3, ask: 4, eventTime: 200, ingestTime: 200 }))
    applyFeedMessage(state, JSON.stringify({ type: 'market.quote', source: 't', symbol: 'BTCUSDT', bid: 9, ask: 9, eventTime: 50, ingestTime: 50 }))
    assert.equal(state.quotes.BTCUSDT?.bid, 3)
    assert.equal(state.frames, 3)
  })

  test('market.status keeps the latest provider state; errors are surfaced', () => {
    const state = createFeedState()
    applyFeedMessage(state, JSON.stringify({ type: 'market.status', provider: 'binance', state: 'connecting' }))
    assert.equal(state.providerStatus?.state, 'connecting')
    applyFeedMessage(state, JSON.stringify({ type: 'error', error: 'bad-json' }))
    assert.equal(state.lastError, 'bad-json')
  })

  test('malformed canonical frame (missing symbol) counts as bad-frame', () => {
    const state = createFeedState()
    assert.equal(applyFeedMessage(state, JSON.stringify({ type: 'market.candle', openTime: T0 })), 'bad-frame')
    assert.equal(applyFeedMessage(state, JSON.stringify({ type: 'market.trade', price: 'x' })), 'bad-frame')
    assert.equal(state.parseErrors, 2)
  })
})

describe('applyFeedMessage — market.book ladders (S6)', () => {
  const book = (over: Record<string, unknown> = {}) => ({
    type: 'market.book',
    symbol: 'BTCUSDT',
    bids: [[100, 5], [99, 2]],
    asks: [[101, 3]],
    synced: true,
    lastUpdateId: 106,
    eventTime: T0,
    source: 'depth',
    ingestTime: T0,
    ...over
  })

  test('book frames land in the books slot with numeric levels', () => {
    const state = createFeedState()
    assert.equal(applyFeedMessage(state, JSON.stringify(book())), 'ok')
    const ladder = state.books.BTCUSDT
    assert.ok(ladder)
    assert.equal(ladder.bids[0][0], 100)
    assert.equal(ladder.asks[0][1], 3)
    assert.equal(ladder.lastUpdateId, 106)
    assert.equal(state.frames, 1)
  })

  test('string levels from the wire are coerced to numbers', () => {
    const state = createFeedState()
    applyFeedMessage(state, JSON.stringify(book({ bids: [['100.0', '5']], asks: [['101.0', '0']], lastUpdateId: 7 })))
    assert.deepEqual(state.books.BTCUSDT?.bids, [[100, 5]])
    assert.equal(state.books.BTCUSDT?.lastUpdateId, 7)
  })

  test('ladders are capped at BOOK_LEVELS per side', () => {
    const state = createFeedState()
    const bids = Array.from({ length: 60 }, (_, i) => [100 - i, 1])
    applyFeedMessage(state, JSON.stringify(book({ bids, asks: [] })))
    assert.equal(state.books.BTCUSDT?.bids.length, BOOK_LEVELS)
  })

  test('malformed book frames count as bad-frame', () => {
    const state = createFeedState()
    assert.equal(applyFeedMessage(state, JSON.stringify({ type: 'market.book', symbol: 'BTCUSDT', bids: 'x' })), 'bad-frame')
    assert.equal(state.parseErrors, 1)
  })

  test('formatQty scales decimals with size', () => {
    assert.equal(formatQty(1234), '1234')
    assert.equal(formatQty(12.3456), '12.35')
    assert.equal(formatQty(0.001234), '0.0012')
    assert.equal(formatQty(undefined), '—')
  })
})

describe('chart bars — candlesToBars / upsertBar', () => {
  test('candlesToBars converts ms -> seconds, sorts and de-dupes', () => {
    const bars = candlesToBars([
      candle({ openTime: T0 + 60_000 }),
      candle({ openTime: T0 }),                    // out of order on purpose
      candle({ openTime: T0, close: 999 })         // duplicate — last wins
    ])
    assert.equal(bars.length, 2)
    assert.equal(bars[0]?.time, Math.floor(T0 / 1000))
    assert.equal(bars[0]?.close, 999)
    assert.equal(bars[1]?.time, Math.floor((T0 + 60_000) / 1000))
    assert.equal(bars[1]?.close, 105)
  })

  test('upsertBar: replace same bucket, append newer, ignore older', () => {
    let bars = candlesToBars([candle({ openTime: T0, close: 100 })])
    bars = upsertBar(bars, candle({ openTime: T0, close: 105, state: 'closed' }))
    assert.equal(bars.length, 1)
    assert.equal(bars[0]?.close, 105)

    bars = upsertBar(bars, candle({ openTime: T0 + 60_000, close: 110 }))
    assert.equal(bars.length, 2)

    const before = bars
    bars = upsertBar(bars, candle({ openTime: T0 - 60_000, close: 1 }))
    assert.equal(bars, before, 'older frame returns the SAME array (no re-render)')
  })

  test('upsertBar into an empty array just seeds it', () => {
    const bars = upsertBar([], candle())
    assert.equal(bars.length, 1)
    assert.equal(bars[0]?.time, Math.floor(T0 / 1000))
  })
})

describe('display helpers', () => {
  test('formatPrice adapts decimals, handles null', () => {
    assert.equal(formatPrice(86125.149), '86125.1')
    assert.equal(formatPrice(123.456), '123.46')
    assert.equal(formatPrice(0.001234), '0.001234')
    assert.equal(formatPrice(0.000012), '0.000012')
    assert.equal(formatPrice(undefined), '—')
    assert.equal(formatPrice(NaN), '—')
  })

  test('spreadOf needs both sides', () => {
    const base = { type: 'market.quote' as const, source: 't', symbol: 'BTCUSDT', eventTime: 1, ingestTime: 1 }
    assert.equal(spreadOf({ ...base, bid: 100, ask: 100.5 }), 0.5)
    assert.equal(spreadOf({ ...base, bid: 100 }), null)
    assert.equal(spreadOf(undefined), null)
  })
})
