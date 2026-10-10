import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSITE_INTERVALS,
  MarketRestError,
  NATIVE_INTERVALS,
  depthToSnapshot,
  fetchJson,
  getCandles,
  getOrderBook,
  getTrades,
  klineRowToRaw,
  normalizeInterval,
  normalizeLimit,
  normalizeMarket,
  normalizeOrderbookLimit,
  normalizeSymbol,
  toHttpError,
  tradeRowToRaw,
  type FetchLike
} from '../server/utils/marketRest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)
const NOW = T0 + 6 * 60_000 + 30_000 // 12:06:30 — rows up to 12:05 are closed

/** Binance kline row: [openTime, open, high, low, close, volume, closeTime]. */
const mk1m = (openTime: number, close = 100): unknown[] => [
  openTime, 100, Math.max(100, close), Math.min(100, close), close, 10, openTime + 59_999
]

const jsonFetch = (payload: unknown, capture?: { url?: string }): FetchLike =>
  async (url) => {
    if (capture) capture.url = url
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }

const statusOf = (fn: () => unknown): number => {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  assert.ok(caught instanceof MarketRestError, 'expected a MarketRestError')
  return caught.statusCode
}

// ---------------------------------------------------------------------------
// Param parsing
// ---------------------------------------------------------------------------

describe('normalizeSymbol / normalizeMarket', () => {
  test('symbol is uppercased and validated', () => {
    assert.equal(normalizeSymbol('btcusdt'), 'BTCUSDT')
    assert.equal(normalizeSymbol(' XAUUSD '), 'XAUUSD')
    assert.equal(statusOf(() => normalizeSymbol('BTC-USDT')), 400)
    assert.equal(statusOf(() => normalizeSymbol('X')), 400)
    assert.equal(statusOf(() => normalizeSymbol(undefined)), 400)
  })

  test('market accepts futures|fapi|spot with env default', () => {
    assert.equal(normalizeMarket(undefined), 'futures')
    assert.equal(normalizeMarket('fapi'), 'futures')
    assert.equal(normalizeMarket('futures'), 'futures')
    assert.equal(normalizeMarket('spot'), 'spot')
    assert.equal(normalizeMarket(undefined, 'spot'), 'spot')
    assert.equal(statusOf(() => normalizeMarket('gold')), 400)
  })
})

describe('normalizeInterval / limits', () => {
  test('native intervals default to 1m', () => {
    assert.deepEqual(normalizeInterval(undefined), { interval: '1m', composite: false, maxLimit: 1500 })
    assert.equal(normalizeInterval('1h').composite, false)
    assert.ok(NATIVE_INTERVALS.includes('4h'))
  })

  test('4m/10m are composite with a 1500-row page budget', () => {
    assert.deepEqual(normalizeInterval('4m'), { interval: '4m', composite: true, maxLimit: 375 })
    assert.deepEqual(normalizeInterval('10m'), { interval: '10m', composite: true, maxLimit: 150 })
    assert.equal(COMPOSITE_INTERVALS['4m'], 4)
  })

  test('unknown intervals are rejected with 400', () => {
    assert.equal(statusOf(() => normalizeInterval('2m')), 400)
    assert.equal(statusOf(() => normalizeInterval('4M-month')), 400)
  })

  test('limit: default, bounds, integer-only', () => {
    assert.equal(normalizeLimit(undefined, { min: 1, max: 1500, def: 300 }), 300)
    assert.equal(normalizeLimit(' 50 ', { min: 1, max: 1500, def: 300 }), 50)
    assert.equal(statusOf(() => normalizeLimit('0', { min: 1, max: 1500, def: 300 })), 400)
    assert.equal(statusOf(() => normalizeLimit('1501', { min: 1, max: 1500, def: 300 })), 400)
    assert.equal(statusOf(() => normalizeLimit('abc', { min: 1, max: 1500, def: 300 })), 400)
    assert.equal(statusOf(() => normalizeLimit('1.5', { min: 1, max: 1500, def: 300 })), 400)
  })

  test('orderbook limits follow the per-market page sizes (live-verified)', () => {
    assert.equal(normalizeOrderbookLimit(undefined, 'futures'), 100)
    assert.equal(normalizeOrderbookLimit('50', 'futures'), 50)
    assert.equal(normalizeOrderbookLimit('30', 'spot'), 30) // spot accepts 30
    assert.equal(statusOf(() => normalizeOrderbookLimit('30', 'futures')), 400) // fapi -4021
    assert.equal(statusOf(() => normalizeOrderbookLimit('200', 'futures')), 400)
    assert.equal(statusOf(() => normalizeOrderbookLimit('1000', 'futures')), 400)
    assert.equal(normalizeOrderbookLimit('1000', 'spot'), 1000)
  })
})

// ---------------------------------------------------------------------------
// Row normalizers
// ---------------------------------------------------------------------------

describe('klineRowToRaw / tradeRowToRaw / depthToSnapshot', () => {
  test('kline row maps to canonical raw with closed/forming state', () => {
    const closed = klineRowToRaw(mk1m(T0), { symbol: 'BTCUSDT', timeframe: '1m', now: NOW })
    assert.equal(closed.state, 'closed')
    assert.equal(closed.openTime, T0)
    assert.equal(closed.closeTime, T0 + 59_999)

    const forming = klineRowToRaw(mk1m(T0 + 6 * 60_000), { symbol: 'BTCUSDT', timeframe: '1m', now: NOW })
    assert.equal(forming.state, 'forming') // closeTime 12:06:59.999 > 12:06:30
  })

  test('malformed kline rows are upstream errors (502), never crashes', () => {
    assert.equal(statusOf(() => klineRowToRaw([T0, 100], { symbol: 'BTCUSDT', timeframe: '1m', now: NOW })), 502)
    assert.equal(statusOf(() => klineRowToRaw([T0, 100, 90, 95, 99, 10, T0 + 59_999], { symbol: 'BTCUSDT', timeframe: '1m', now: NOW })), 502) // high < open
    assert.equal(statusOf(() => klineRowToRaw(['x', 1, 2, 3, 4, 5, 6], { symbol: 'BTCUSDT', timeframe: '1m', now: NOW })), 502)
  })

  test('trade row: isBuyerMaker is the WS m flag (true -> sell)', () => {
    const sell = tradeRowToRaw(
      { id: 7, price: '100.5', qty: '0.5', time: T0, isBuyerMaker: true },
      { symbol: 'BTCUSDT', market: 'futures' }
    )
    assert.equal(sell.side, 'sell')
    assert.equal(sell.price, 100.5)
    assert.equal(sell.quantity, 0.5)
    assert.equal(sell.eventTime, T0)
    assert.equal(sell.market, 'futures')

    const buy = tradeRowToRaw(
      { price: '99', time: T0, isBuyerMaker: false },
      { symbol: 'ETHUSDT', market: 'spot' }
    )
    assert.equal(buy.side, 'buy')
    assert.equal(buy.id, undefined)

    assert.equal(statusOf(() => tradeRowToRaw({ time: T0 }, { symbol: 'BTCUSDT', market: 'futures' })), 502)
    assert.equal(statusOf(() => tradeRowToRaw({ price: '1' }, { symbol: 'BTCUSDT', market: 'futures' })), 502)
  })

  test('depth snapshot: levels become {price, qty} numbers', () => {
    const snap = depthToSnapshot(
      { lastUpdateId: 42, bids: [['100', '1.5']], asks: [['101', '2', 'x']] },
      { symbol: 'BTCUSDT', market: 'futures', now: NOW }
    )
    assert.equal(snap.type, 'orderbook')
    assert.equal(snap.lastUpdateId, 42)
    assert.deepEqual(snap.bids, [{ price: 100, qty: 1.5 }])
    assert.deepEqual(snap.asks, [{ price: 101, qty: 2 }])
    assert.equal(snap.eventTime, NOW)

    assert.equal(statusOf(() => depthToSnapshot({ bids: [] }, { symbol: 'BTCUSDT', market: 'futures', now: NOW })), 502)
    assert.equal(statusOf(() => depthToSnapshot({ lastUpdateId: 1, bids: 'x', asks: [] }, { symbol: 'BTCUSDT', market: 'futures', now: NOW })), 502)
  })
})

// ---------------------------------------------------------------------------
// fetchJson error mapping
// ---------------------------------------------------------------------------

describe('fetchJson — upstream failures become typed HTTP errors', () => {
  test('HTTP 418 without body -> 502', async () => {
    const impl: FetchLike = async () => ({ ok: false, status: 418, text: async () => '' })
    await assert.rejects(fetchJson('http://x', impl), (e: unknown) =>
      e instanceof MarketRestError && e.statusCode === 502)
  })

  test('invalid symbol (-1121) -> 404', async () => {
    const impl = jsonFetch({ code: -1121, msg: 'Invalid symbol.' })
    await assert.rejects(fetchJson('http://x', impl), (e: unknown) =>
      e instanceof MarketRestError && e.statusCode === 404 && e.code === 'error.symbolNotFound')
  })

  test('other Binance error -> 502 with the message preserved', async () => {
    const impl = jsonFetch({ code: -1003, msg: 'Too many requests.' })
    await assert.rejects(fetchJson('http://x', impl), (e: unknown) =>
      e instanceof MarketRestError && e.statusCode === 502 && /Too many requests/.test(e.message))
  })

  test('network failure -> 502', async () => {
    const impl: FetchLike = async () => { throw new Error('ECONNRESET') }
    await assert.rejects(fetchJson('http://x', impl), (e: unknown) =>
      e instanceof MarketRestError && e.statusCode === 502 && /ECONNRESET/.test(e.message))
  })

  test('non-JSON body -> 502; valid array passes through', async () => {
    const bad: FetchLike = async () => ({ ok: true, status: 200, text: async () => '<html>' })
    await assert.rejects(fetchJson('http://x', bad), (e: unknown) =>
      e instanceof MarketRestError && e.statusCode === 502)
    const good = jsonFetch([1, 2])
    assert.deepEqual(await fetchJson('http://x', good), [1, 2])
  })
})

// ---------------------------------------------------------------------------
// Orchestrators (fake upstream, no network)
// ---------------------------------------------------------------------------

describe('getCandles', () => {
  test('native 1h: correct URL, canonical events, eventTime rules', async () => {
    const capture: { url?: string } = {}
    const rows = [
      [T0 - 3_600_000, 100, 110, 90, 105, 12, T0 - 1],                    // 11:00 bar — closed before NOW
      [T0, 105, 106, 104, 105, 3, T0 + 3_599_999]                         // 12:00 bar — closes 12:59:59 > NOW
    ]
    const { candles, meta } = await getCandles({
      symbol: 'BTCUSDT', market: 'futures', interval: '1h', limit: 2,
      fetchImpl: jsonFetch(rows, capture), now: NOW, ingest: 1_700_000_000_000
    })

    const url = new URL(capture.url!)
    assert.equal(url.pathname, '/fapi/v1/klines')
    assert.equal(url.searchParams.get('symbol'), 'BTCUSDT')
    assert.equal(url.searchParams.get('interval'), '1h')
    assert.equal(url.searchParams.get('limit'), '2')

    assert.equal(candles.length, 2)
    const [closed, forming] = candles
    assert.equal(closed!.type, 'market.candle')
    assert.equal(closed!.source, 'binance-rest')
    assert.equal(closed!.state, 'closed')
    assert.equal(closed!.eventTime, T0 - 1) // closed eventTime = closeTime (D16)
    assert.equal(closed!.timeframe, '1h')
    assert.equal(forming!.state, 'forming')
    assert.equal(forming!.eventTime, 1_700_000_000_000) // forming eventTime = ingest

    assert.equal(meta.composite, false)
    assert.equal(meta.count, 2)
    assert.equal(meta.market, 'futures')
  })

  test('spot candles hit /api/v3/klines', async () => {
    const capture: { url?: string } = {}
    await getCandles({
      symbol: 'BTCUSDT', market: 'spot', interval: '5m', limit: 1,
      fetchImpl: jsonFetch([mk1m(T0)], capture), now: NOW
    })
    assert.equal(new URL(capture.url!).pathname, '/api/v3/klines')
  })

  test('4m composite: composed from 1m rows with canonical boundaries', async () => {
    const capture: { url?: string } = {}
    const rows = [
      mk1m(T0, 100),                 // 12:00 bucket A
      mk1m(T0 + 60_000, 101),
      mk1m(T0 + 120_000, 102),
      mk1m(T0 + 180_000, 103),       // -> closes A when 12:04 arrives
      mk1m(T0 + 240_000, 104),       // 12:04 bucket B (forming at NOW=12:06:30)
      mk1m(T0 + 300_000, 105),
      // in-progress 1m bar at 12:06 — must be skipped (not final input)
      [T0 + 360_000, 100, 99_999, 99, 99_999, 1, T0 + 419_999]
    ]
    const { candles, meta } = await getCandles({
      symbol: 'BTCUSDT', market: 'futures', interval: '4m', limit: 10,
      fetchImpl: jsonFetch(rows, capture), now: NOW, ingest: 1_700_000_000_000
    })

    const url = new URL(capture.url!)
    assert.equal(url.searchParams.get('interval'), '1m') // composite fetches base rows
    assert.equal(url.searchParams.get('limit'), '50') // 10 * 4 + 10

    assert.equal(candles.length, 2)
    const closedA = candles[0]!
    const formingB = candles[1]!
    assert.equal(closedA.state, 'closed')
    assert.equal(closedA.timeframe, '4m')
    assert.equal(closedA.openTime, T0) // floor(12:00/4m)*4m
    assert.equal(closedA.closeTime, T0 + 240_000 - 1)
    assert.equal(closedA.eventTime, T0 + 240_000 - 1)
    assert.equal(closedA.high, 103) // merged from the four 1m rows
    assert.equal(closedA.volume, 40)
    assert.equal(formingB.state, 'forming')
    assert.equal(formingB.openTime, T0 + 240_000)
    assert.notEqual(formingB.close, 99_999) // the in-progress row was NOT aggregated

    assert.equal(meta.composite, true)
    assert.equal(meta.interval, '4m')
    assert.equal(meta.count, 2)
  })

  test('upstream invalid symbol surfaces as 404', async () => {
    const impl = jsonFetch({ code: -1121, msg: 'Invalid symbol.' })
    await assert.rejects(
      getCandles({ symbol: 'NOPEUSDT', market: 'futures', interval: '1m', limit: 1, fetchImpl: impl, now: NOW }),
      (e: unknown) => e instanceof MarketRestError && e.statusCode === 404
    )
  })
})

describe('getTrades / getOrderBook', () => {
  test('trades: URL, canonical market.trade events', async () => {
    const capture: { url?: string } = {}
    const rows = [{ id: 9, price: '86000.1', qty: '0.01', time: T0, isBuyerMaker: true }]
    const { trades, meta } = await getTrades({
      symbol: 'BTCUSDT', market: 'futures', limit: 100,
      fetchImpl: jsonFetch(rows, capture), ingest: 1_700_000_000_000
    })

    const url = new URL(capture.url!)
    assert.equal(url.pathname, '/fapi/v1/trades')
    assert.equal(url.searchParams.get('limit'), '100')

    assert.equal(trades.length, 1)
    assert.equal(trades[0]!.type, 'market.trade')
    assert.equal(trades[0]!.source, 'binance-rest')
    assert.equal(trades[0]!.side, 'sell')
    assert.equal(trades[0]!.price, 86000.1)
    assert.equal(trades[0]!.quantity, 0.01)
    assert.equal(trades[0]!.id, 9)
    assert.equal(meta.count, 1)
    assert.equal(meta.market, 'futures')
  })

  test('orderbook: URL per market, snapshot shape', async () => {
    const capture: { url?: string } = {}
    const payload = {
      lastUpdateId: 77,
      bids: [['100', '1']],
      asks: [['101', '2']]
    }
    const { book, meta } = await getOrderBook({
      symbol: 'BTCUSDT', market: 'spot', limit: 100,
      fetchImpl: jsonFetch(payload, capture), now: NOW
    })

    const url = new URL(capture.url!)
    assert.equal(url.pathname, '/api/v3/depth')
    assert.equal(url.searchParams.get('limit'), '100')

    assert.equal(book.type, 'orderbook')
    assert.equal(book.market, 'spot')
    assert.equal(book.lastUpdateId, 77)
    assert.equal(book.bids.length, 1)
    assert.equal(book.asks[0]!.price, 101)
    assert.equal(book.eventTime, NOW)
    assert.equal(meta.bids, 1)
    assert.equal(meta.asks, 1)
  })
})

describe('toHttpError', () => {
  test('wraps MarketRestError with its status, passes others through', () => {
    const wrapped = toHttpError(new MarketRestError('bad interval', 400, 'error.badRequest')) as { statusCode?: number; statusMessage?: string }
    assert.equal(wrapped.statusCode, 400)
    assert.equal(wrapped.statusMessage, 'error.badRequest')

    const plain = new Error('boom')
    assert.equal(toHttpError(plain), plain)
  })
})
