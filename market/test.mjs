#!/usr/bin/env node
// =============================================================================
//  TM TRADING — test:market: Phase 7R market plane acceptance.
//
//  Covers D15-D22 building blocks with ZERO network/dependency:
//    canonical events (§7, D16) · clock (D18) + future gate (D17) ·
//    timeframe boundaries (D22) · candle builder (forming/closed, 4m/10m
//    boundaries, no duplicate close) · 1m -> 4m/10m aggregation ·
//    quote/orderbook stores (stale + Binance sequencing) · event bus ·
//    latency/sequence monitor · provider contract · Binance provider with an
//    injected fake WebSocket (normalize, dedupe, reconnect + resubscribe) ·
//    plane wiring (trades mode, kline mode, D17 drop).
//
//  Run: node market/test.mjs   (wired into `npm test`)
// =============================================================================

import {
  TOPICS, tradeEvent, quoteEvent, candleEvent,
  createTradingClock, tfToMs, alignDown, closeTimeOf,
  createCandleBuilder, createAggregator,
  createQuoteStore, createOrderbookStore, createEventBus, createMonitor,
  assertProvider, assertHooks,
  createBinanceProvider, buildStreams, buildUrl, normalizeMessage,
  createMarketPlane, createDepthSync
} from './index.mjs'
import {
  candleRecord, manifestPatches, upsertedIds, candleId, datasetIdFor,
  DEFAULT_RETENTION_DAYS, createCandleRecorder
} from './recorder.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unexpected rejection) — ${(e && e.message) || e}`); finish() })

// Deterministic timeline: 2026-10-05 12:00:00 UTC (D2 — UTC buckets).
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60_000
const at = (minutes, ms = 0) => T0 + minutes * MIN + ms
const INGEST = 1_800_000_000_000
const fixedIngest = () => INGEST

// =============================================================================
section('1. canonical events (§7, D16 — eventTime/ingestTime/source on all)')

{
  const t = tradeEvent({ source: 'binance', symbol: 'BTCUSDT', price: '100', quantity: '2.5', side: 'buy', eventTime: T0 }, 1234)
  check('tradeEvent stamps type/source + both times', t.type === TOPICS.TRADE && t.source === 'binance' && t.eventTime === T0 && t.ingestTime === 1234)
  check('tradeEvent coerces numeric strings', t.price === 100 && t.quantity === 2.5)
  check('tradeEvent keeps optional id', tradeEvent({ source: 'x', symbol: 'S', price: 1, eventTime: T0, id: 42 }, 1).id === 42)
  let threw = ''
  try { tradeEvent({ source: 'x', symbol: 'S', price: 0, eventTime: T0 }, 1) } catch (e) { threw = e.message }
  check('tradeEvent rejects price <= 0', /price/.test(threw), threw)
  threw = ''
  try { tradeEvent({ source: 'x', symbol: 'S', price: 1, side: 'hold', eventTime: T0 }, 1) } catch (e) { threw = e.message }
  check('tradeEvent rejects unknown side', /side/.test(threw), threw)
  threw = ''
  try { tradeEvent({ source: 'x', symbol: 'S', price: 1 }, 1) } catch (e) { threw = e.message }
  check('tradeEvent rejects missing eventTime (D16)', /eventTime/.test(threw), threw)

  const q = quoteEvent({ source: 'binance', symbol: 'BTCUSDT', bid: '99.5', ask: '100.5', eventTime: T0 }, 7)
  check('quoteEvent accepts bid/ask', q.bid === 99.5 && q.ask === 100.5 && q.ingestTime === 7)
  threw = ''
  try { quoteEvent({ source: 'x', symbol: 'S', bid: 101, ask: 100, eventTime: T0 }, 1) } catch (e) { threw = e.message }
  check('quoteEvent rejects crossed quote (bid > ask)', /bid/.test(threw), threw)
  threw = ''
  try { quoteEvent({ source: 'x', symbol: 'S', eventTime: T0 }, 1) } catch (e) { threw = e.message }
  check('quoteEvent requires one of bid/ask/last', /bid\/ask\/last/.test(threw), threw)

  const cClosed = candleEvent({ source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', state: 'closed', open: 100, high: 110, low: 90, close: 105, volume: 12, openTime: T0, closeTime: T0 + MIN - 1 }, 9)
  check('candleEvent closed: eventTime defaults to closeTime (D17)', cClosed.eventTime === T0 + MIN - 1 && cClosed.ingestTime === 9)
  const cForming = candleEvent({ source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', state: 'forming', open: 100, high: 101, low: 99, close: 100, volume: 1, openTime: T0, closeTime: T0 + MIN - 1 }, 9)
  check('candleEvent forming: eventTime defaults to ingest', cForming.eventTime === 9)
  threw = ''
  try { candleEvent({ source: 'x', symbol: 'S', timeframe: '1m', state: 'closed', open: 100, high: 99, low: 90, close: 95, volume: 1, openTime: T0, closeTime: T0 + MIN }, 1) } catch (e) { threw = e.message }
  check('candleEvent rejects OHLC without high >= open/close', /OHLC/.test(threw), threw)
  threw = ''
  try { candleEvent({ source: 'x', symbol: 'S', timeframe: '1m', state: 'wat', open: 1, high: 1, low: 1, close: 1, volume: 0, openTime: T0, closeTime: T0 + 1 }, 1) } catch (e) { threw = e.message }
  check('candleEvent rejects unknown state', /state/.test(threw), threw)
}

// =============================================================================
section('2. trading clock (D18 modes, D17 future gate)')

{
  let sysTime = T0
  const live = createTradingClock({ nowFn: () => sysTime })
  check('live mode now() follows injected system time', live.now() === T0 && live.mode() === 'live')
  sysTime = T0 + 5000
  check('live now() tracks the clock function', live.now() === T0 + 5000)
  check('live canUse: eventTime <= now passes (D17)', live.canUse(T0 + 5000) === true)
  check('live canUse: future eventTime rejected', live.canUse(T0 + 5001) === false)
  check('live setSkew widens the D17 gate into the exchange domain', live.setSkew(2000) === 2000 && live.skew() === 2000
    && live.canUse(T0 + 7000) === true && live.canUse(T0 + 7001) === false)
  check('live setSkew(0) restores the strict gate', live.setSkew(0) === 0 && live.canUse(T0 + 5001) === false)
  let threw = ''
  try { live.setSkew(NaN) } catch (e) { threw = e.message }
  check('setSkew needs a finite ms', /finite/.test(threw), threw)
  try { live.setNow(T0) } catch (e) { threw = e.message }
  check('live mode refuses setNow (time is the exchange\'s)', /only valid in replay/.test(threw), threw)

  const replay = createTradingClock({ mode: 'replay', start: T0 })
  check('replay mode freezes now() at start', replay.now() === T0 && replay.mode() === 'replay')
  check('replay setNow advances time', replay.setNow(T0 + MIN) === T0 + MIN)
  threw = ''
  try { replay.setNow(T0) } catch (e) { threw = e.message }
  check('replay setNow is monotonic — never rewinds', /backwards/.test(threw), threw)
  check('replay canUse at boundary == now', replay.canUse(T0 + MIN) === true)
  threw = ''
  try { replay.setSkew(1000) } catch (e) { threw = e.message }
  check('replay refuses setSkew — simulated clock never skews', /live mode/.test(threw), threw)

  const bt = createTradingClock({ mode: 'backtest', start: T0 })
  check('backtest mode accepted (D18)', bt.mode() === 'backtest')
  threw = ''
  try { createTradingClock({ mode: 'warp' }) } catch (e) { threw = e.message }
  check('unknown mode throws', /mode/.test(threw), threw)
}

// =============================================================================
section('3. timeframes + boundaries (D2/D22)')

{
  check('engine notation: "4" -> 4m in ms', tfToMs('4') === 4 * MIN)
  check('binance notation: "10m" -> 10m in ms', tfToMs('10m') === 10 * MIN)
  check('binance notation: "1h"', tfToMs('1h') === 60 * MIN)
  check('alignDown lands on the bucket start', alignDown(at(3, 25_000), 4 * MIN) === at(0))
  check('alignDown of exact boundary is itself', alignDown(at(4), 4 * MIN) === at(4))
  check('closeTimeOf = end - 1ms (Binance convention)', closeTimeOf(at(0), 4 * MIN) === at(4) - 1)
  let threw = ''
  try { tfToMs('nonsense') } catch (e) { threw = e.message }
  check('unsupported timeframe throws', /unsupported/.test(threw), threw)
}

// =============================================================================
section('4. candle builder — forming/closed, boundaries, no duplicate close')

{
  const b = createCandleBuilder({ symbol: 'BTCUSDT', timeframe: '4m', source: 'test', ingest: fixedIngest })
  const e1 = b.apply({ price: 100, quantity: 1, eventTime: at(0) })
  check('first trade opens a forming bar', e1.length === 1 && e1[0].state === 'forming' && e1[0].openTime === at(0))
  check('forming OHLC so far', e1[0].open === 100 && e1[0].high === 100 && e1[0].close === 100 && e1[0].volume === 1)

  b.apply({ price: 110, quantity: 2, eventTime: at(0, 30_000) })
  const e3 = b.apply({ price: 90, quantity: 1, eventTime: at(3, 59_000) }) // 12:03:59 — same 4m bucket
  const cur = b.current()
  check('bar stays open across the whole bucket (O100 H110 L90 C90)', cur.open === 100 && cur.high === 110 && cur.low === 90 && cur.close === 90 && cur.volume === 4)
  check('in-bucket trade only emits forming', e3.length === 1 && e3[0].state === 'forming')

  const e4 = b.apply({ price: 95, quantity: 1, eventTime: at(4) }) // 12:04:00 — boundary cross
  check('boundary trade emits [closed(prev), forming(new)]', e4.length === 2 && e4[0].state === 'closed' && e4[1].state === 'forming')
  check('closed bar carries the full OHLCV', e4[0].open === 100 && e4[0].high === 110 && e4[0].low === 90 && e4[0].close === 90 && e4[0].volume === 4)
  check('closed bar closeTime = boundary - 1', e4[0].closeTime === at(4) - 1)
  check('new forming bar opens at the new bucket', e4[1].openTime === at(4) && e4[1].open === 95)

  const stale = b.apply({ price: 50, quantity: 1, eventTime: at(1) }) // replay of an old bucket
  check('stale trade (old bucket) dropped — no duplicate close', stale.length === 0 && b.stats().closed === 1 && b.stats().tradesDropped === 1)

  b.flush()
  check('flush closes the open bar exactly once', b.stats().closed === 2)
  check('flush on empty builder is a no-op', b.flush().length === 0 && b.stats().closed === 2)

  // 10m boundary: 12:09:59 belongs to [12:00,12:10), 12:10:00 starts a new one.
  const t10 = createCandleBuilder({ symbol: 'BTCUSDT', timeframe: '10m', source: 'test', ingest: fixedIngest })
  t10.apply({ price: 1, eventTime: at(9, 59_999) })
  const cross10 = t10.apply({ price: 2, eventTime: at(10) })
  check('10m boundary: 12:09:59 inside, 12:10:00 closes it', cross10.length === 2 && cross10[0].openTime === at(0) && cross10[1].openTime === at(10))

  // Out-of-order guard inside an open bucket.
  const ooo = createCandleBuilder({ symbol: 'BTCUSDT', timeframe: '1m', source: 'test', ingest: fixedIngest })
  ooo.apply({ price: 10, eventTime: at(6) })
  const dropped = ooo.apply({ price: 9, eventTime: at(5, 30_000) })
  check('out-of-order trade older than open bucket dropped', dropped.length === 0 && ooo.stats().tradesDropped === 1)

  let threw = ''
  try { ooo.apply({ price: -1, eventTime: at(7) }) } catch (e) { threw = e.message }
  check('builder throws on invalid trade', /price/.test(threw), threw)
}

// =============================================================================
section('5. aggregation 1m -> 4m/10m (closed inputs, gap-tolerant boundaries)')

{
  const mk = (minutes, o, h, l, c, v) => ({
    symbol: 'BTCUSDT', timeframe: '1m', state: 'closed',
    openTime: at(minutes), closeTime: at(minutes + 1) - 1,
    open: o, high: h, low: l, close: c, volume: v
  })

  const a4 = createAggregator({ timeframe: '4m', source: 'test', ingest: fixedIngest })
  let out = []
  out = out.concat(a4.apply(mk(0, 100, 102, 99, 101, 1)))
  out = out.concat(a4.apply(mk(1, 101, 105, 100, 104, 2)))
  out = out.concat(a4.apply(mk(2, 104, 106, 103, 105, 3)))
  check('partial 4m: every 1m input emits forming, none closed yet', out.length === 3 && out.every((e) => e.state === 'forming') && a4.stats().closed === 0)

  out = out.concat(a4.apply(mk(3, 105, 110, 104, 109, 4)))
  const closed4 = a4.apply(mk(4, 109, 111, 108, 110, 5)) // 12:04 bar crosses the 4m boundary
  check('12:04 input closes the [12:00,12:04) 4m bar', closed4.length === 2 && closed4[0].state === 'closed' && closed4[0].openTime === at(0))
  check('aggregate OHLCV = merge of 4x 1m bars', closed4[0].open === 100 && closed4[0].high === 110 && closed4[0].low === 99 && closed4[0].close === 109 && closed4[0].volume === 10)
  check('new 4m bucket starts forming', closed4[1].state === 'forming' && closed4[1].openTime === at(4))

  const dup = a4.apply(mk(2, 104, 106, 103, 105, 3)) // replayed old 1m bar
  check('replayed 1m bar dropped — 4m never re-closes (no duplicate event)', dup.length === 0 && a4.stats().closed === 1)

  const forming = a4.apply({ ...mk(5, 1, 1, 1, 1, 1), state: 'forming' })
  check('forming 1m inputs are not aggregated (not final)', forming.length === 0 && a4.stats().dropped >= 1)

  a4.flush()
  check('flush closes the partial 4m bar', a4.stats().closed === 2)

  // 10m + gap: 12:00 then jump to 12:10 — bucket closes on arrival anyway.
  const a10 = createAggregator({ timeframe: '10m', source: 'test', ingest: fixedIngest })
  a10.apply(mk(0, 5, 6, 4, 5, 1))
  const gap = a10.apply(mk(10, 7, 8, 6, 7, 2))
  check('gap: 10m bucket closes when a later bucket arrives', gap.length === 2 && gap[0].state === 'closed' && gap[0].openTime === at(0) && gap[0].volume === 1)
  check('after-gap bucket forms', gap[1].state === 'forming' && gap[1].openTime === at(10))

  let threw = ''
  try { createAggregator({ timeframe: '1m' }) } catch (e) { threw = e.message }
  check('aggregator refuses a 1m target (must be >= 2m)', /2m/.test(threw), threw)
}

// =============================================================================
section('6. quote store (stale rejection, merge, crossed guard)')

{
  const s = createQuoteStore()
  check('apply returns true on first write', s.apply({ source: 'binance', symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: at(0), ingestTime: 1 }) === true)
  check('stale write rejected and counted', s.apply({ source: 'binance', symbol: 'BTCUSDT', bid: 90, ask: 91, eventTime: at(0) - 1, ingestTime: 2 }) === false && s.stats().stale === 1)
  s.apply({ source: 'binance', symbol: 'BTCUSDT', ask: 103, eventTime: at(1), ingestTime: 3 })
  const row = s.get('BTCUSDT')
  check('newer partial write merges with previous (bid kept)', row.bid === 100 && row.ask === 103 && row.eventTime === at(1))
  let threw = ''
  try { s.apply({ source: 'x', symbol: 'XAUUSD', bid: 2001, ask: 1999, eventTime: at(1) }) } catch (e) { threw = e.message }
  check('crossed result throws', /crossed/.test(threw), threw)
  check('unknown symbol returns null', s.get('NOPE') === null)
  check('all() sorted + snapshot', s.all().length === 1 && s.all()[0].symbol === 'BTCUSDT')
}

// =============================================================================
section('7. orderbook store — bookTicker seq + Binance depth rules')

{
  const ob = createOrderbookStore({ maxLevels: 3 })
  check('bookTicker applies', ob.applyBookTicker({ symbol: 'BTCUSDT', bid: 100, ask: 101, updateId: 10, eventTime: at(0) }) === true)
  check('bookTicker stale updateId rejected', ob.applyBookTicker({ symbol: 'BTCUSDT', bid: 99, ask: 100, updateId: 9, eventTime: at(1) }) === false && ob.stats().bookTickerStale === 1)
  let threw = ''
  try { ob.applyBookTicker({ symbol: 'BTCUSDT', bid: 102, ask: 101, updateId: 11, eventTime: at(1) }) } catch (e) { threw = e.message }
  check('bookTicker crossed bid>ask throws', /bad bookTicker/.test(threw), threw)

  check('diff before snapshot counted out-of-sync', ob.applyDiff({ symbol: 'ETHUSDT', firstUpdateId: 1, lastUpdateId: 5, bids: [], asks: [] }) === false && ob.stats().outOfSync === 1)

  ob.applySnapshot({ symbol: 'BTCUSDT', lastUpdateId: 100, bids: [[100, 5], [101, 3], [99, 2], [98, 1]], asks: [[102, 2], [103, 1]] })
  const snap = ob.get('BTCUSDT')
  check('snapshot loads + sorts bids desc / asks asc + maxLevels', snap.bids.length === 3 && snap.bids[0][0] === 101 && snap.asks[0][0] === 102 && snap.synced === true)

  check('straddling first diff applies (U <= lastUpdateId+1 <= u)', ob.applyDiff({ symbol: 'BTCUSDT', firstUpdateId: 101, lastUpdateId: 105, bids: [[100, 0]], asks: [[102, 7]] }) === true)
  const after = ob.get('BTCUSDT')
  check('qty 0 removes the level', after.bids.every((l) => l[0] !== 100) && after.bids.some((l) => l[0] === 101))
  check('level update replaces quantity', after.asks[0][0] === 102 && after.asks[0][1] === 7 && after.lastUpdateId === 105)

  check('already-applied diff dropped (u <= lastUpdateId)', ob.applyDiff({ symbol: 'BTCUSDT', firstUpdateId: 102, lastUpdateId: 104, bids: [], asks: [] }) === false && ob.stats().diffsDropped === 1)
  check('gapped diff counted as sequenceError, state unchanged', ob.applyDiff({ symbol: 'BTCUSDT', firstUpdateId: 110, lastUpdateId: 120, bids: [[101, 9]], asks: [] }) === false && ob.stats().sequenceErrors === 1 && ob.get('BTCUSDT').lastUpdateId === 105)
  check('contiguous diff applies (U === lastUpdateId+1)', ob.applyDiff({ symbol: 'BTCUSDT', firstUpdateId: 106, lastUpdateId: 106, bids: [[101, 4]], asks: [] }) === true && ob.get('BTCUSDT').lastUpdateId === 106)
  check('bookTicker row exposed via get().best', ob.get('BTCUSDT').best.bid === 100)
}

// =============================================================================
section('8. event bus — fan-out, once, handler-error isolation')

{
  const errors = []
  const bus = createEventBus({ onError: (e, topic) => errors.push(`${topic}:${e.message}`) })
  const got = []
  const off = bus.on(TOPICS.TRADE, (ev) => got.push(ev.price))
  bus.on(TOPICS.TRADE, () => { throw new Error('boom') }) // must not break the loop
  check('emit fans out, counts successful deliveries', bus.emit(TOPICS.TRADE, { price: 1 }) === 1 && got.length === 1)
  check('throwing handler reported through onError', errors.length === 1 && errors[0].startsWith('market.trade:boom'))
  off()
  check('unsubscribe stops delivery (only the throwing handler left)', bus.emit(TOPICS.TRADE, { price: 2 }) === 0 && got.length === 1)

  let onceCount = 0
  bus.once(TOPICS.QUOTE, () => { onceCount++ })
  bus.emit(TOPICS.QUOTE, {})
  bus.emit(TOPICS.QUOTE, {})
  check('once() fires exactly one time', onceCount === 1)
  check('emit to unknown topic returns 0', bus.emit('market.nope', {}) === 0)
  let threw = ''
  try { bus.on('', () => {}) } catch (e) { threw = e.message }
  check('on() requires a topic', /topic/.test(threw), threw)
}

// =============================================================================
section('9. monitor — latency percentiles + sequence gaps/dupes')

{
  const m = createMonitor({ window: 100 })
  m.latency('binance', 1000, 1020)
  m.latency('binance', 1000, 1050)
  m.latency('binance', 1000, 1100)
  const st = m.status().latency
  check('latency stats: samples/min/p50/p95/max', st.samples === 3 && st.min === 20 && st.p50 === 50 && st.p95 === 100 && st.max === 100)
  check('per-source counters', st.bySource.binance.count === 3 && st.bySource.binance.max === 100)

  check('first id -> first', m.seq('t1', 5) === 'first')
  check('repeat id -> dup counted', m.seq('t1', 5) === 'dup' && m.status().seq.t1.dup === 1)
  check('skip ids -> gaps counted', m.seq('t1', 8) === 'ok' && m.status().seq.t1.gaps === 2)
  check('older id -> outOfOrder counted', m.seq('t1', 7) === 'outOfOrder' && m.status().seq.t1.outOfOrder === 1)

  for (let i = 0; i < 150; i++) m.latency('x', 1, 2)
  check('rolling window trims samples', m.status().latency.samples === 100)

  let threw = ''
  try { m.latency('x', NaN, 1) } catch (e) { threw = e.message }
  check('latency requires numbers', /number/.test(threw), threw)
}

// =============================================================================
section('10. provider contract (D15 adapter)')

{
  const good = {
    id: 'fake', markets: ['futures'],
    streams: () => ['a@trade'],
    connect: () => {}, close: () => {}, status: () => ({ state: 'idle' })
  }
  check('complete provider passes assertProvider', assertProvider(good) === good)
  let   threw = ''
  try { assertProvider({ id: 'x', markets: ['futures'], streams: () => [] }) } catch (e) { threw = e.message }
  check('missing connect/close/status listed precisely', /^provider contract: missing connect\(hooks\), close\(\), status\(\)$/.test(threw), threw)
  threw = ''
  try { assertHooks({ onEvent: () => {} }) } catch (e) { threw = e.message }
  check('hooks need onStatus too', /onStatus/.test(threw), threw)
}

// =============================================================================
section('11. Binance normalizer — raw payloads -> canonical events only')

{
  const ctx = { source: 'binance', market: 'fapi', ingest: fixedIngest }

  const trade = normalizeMessage(JSON.stringify({
    stream: 'btcusdt@trade',
    data: { e: 'trade', s: 'BTCUSDT', t: 7, p: '101.5', q: '0.5', T: at(0, 123), m: false }
  }), ctx)
  check('trade normalized with topic + D16 stamps', trade.topic === TOPICS.TRADE && trade.event.type === TOPICS.TRADE && trade.event.price === 101.5 && trade.event.side === 'buy' && trade.event.id === 7 && trade.event.ingestTime === INGEST)
  check('exchange market fapi mapped to canonical futures (§7)', trade.event.market === 'futures')
  check('trade eventTime = exchange T, not ingest', trade.event.eventTime === at(0, 123))

  const sell = normalizeMessage({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 8, p: '100', q: '1', T: at(1), m: true } }, ctx)
  check('m=true (buyer is maker) -> aggressor side sell', sell.event.side === 'sell')

  const quote = normalizeMessage({ stream: 'btcusdt@bookTicker', data: { u: 55, s: 'BTCUSDT', b: '100.1', B: '3', a: '100.2', A: '4' } }, ctx)
  check('bookTicker -> quote (no E on payload -> eventTime=ingest, updateId kept)', quote.topic === TOPICS.QUOTE && quote.event.bid === 100.1 && quote.event.ask === 100.2 && quote.event.eventTime === INGEST && quote.event.updateId === 55)

  const depth = normalizeMessage({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: at(2), U: 101, u: 105, b: [['100', '0']], a: [['101', '2']] } }, ctx)
  check('depthUpdate -> market.book diff event', depth.topic === TOPICS.BOOK && depth.event.firstUpdateId === 101 && depth.event.lastUpdateId === 105 && depth.event.bids[0][0] === '100')

  const kOpen = normalizeMessage({ stream: 'btcusdt@kline_1m', data: { e: 'kline', E: at(0, 500), k: { s: 'BTCUSDT', i: '1m', t: at(0), T: at(1) - 1, o: '100', h: '102', l: '99', c: '101', v: '10', x: false } } }, ctx)
  check('kline forming -> candle forming', kOpen.topic === TOPICS.CANDLE && kOpen.event.state === 'forming' && kOpen.event.timeframe === '1m' && kOpen.event.openTime === at(0))

  const kClose = normalizeMessage({ stream: 'btcusdt@kline_1m', data: { e: 'kline', E: at(1) - 1, k: { s: 'BTCUSDT', i: '1m', t: at(0), T: at(1) - 1, o: '100', h: '102', l: '99', c: '101', v: '10', x: true } } }, ctx)
  check('kline x=true -> candle closed, eventTime = exchange E', kClose.event.state === 'closed' && kClose.event.eventTime === at(1) - 1)

  check('garbage string throws (broken feed -> parseError)', (() => { try { normalizeMessage('not-json{', ctx); return false } catch { return true } })())
  check('pong ignored', normalizeMessage('pong', ctx) === null)
  check('unrelated payload ignored', normalizeMessage({ e: 'listenKeyExpired' }, ctx) === null)

  const streams = buildStreams({ symbols: ['BTCUSDT', 'ETHUSDT'], klineInterval: '1m' })
  check('streams = trade + bookTicker + kline per symbol, lowercase symbol',
    streams.length === 6 && streams.includes('btcusdt@kline_1m') &&
    streams.every((s) => { const sym = s.split('@')[0]; return sym === sym.toLowerCase() }))
  const url = buildUrl('wss://fstream.binance.com/stream', ['btcusdt@trade'])
  check('combined-stream URL carries raw ?streams= (Binance form)', url.includes('streams=btcusdt@trade'))
}

// =============================================================================
section('12. Binance provider — fake WebSocket: connect, dedupe, reconnect+resubscribe')

{
  const created = []
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; created.push(this) }
    close() { this.readyState = 3; if (this.onclose) this.onclose() }
  }
  const timers = []
  const setT = (fn, ms) => { const h = { fn, ms, cancelled: false }; timers.push(h); return h }
  const clearT = (h) => { if (h) h.cancelled = true }

  const p = createBinanceProvider({
    market: 'fapi', symbols: ['BTCUSDT'], klineInterval: null,
    WebSocketImpl: FakeWS, setTimeoutFn: setT, clearTimeoutFn: clearT, ingest: fixedIngest
  })
  check('provider satisfies its own contract', assertProvider(p) === p)
  check('provider exposes stream list + url', p.streams().length === 2 && p.url.includes('btcusdt@trade'))

  const events = []
  const statuses = []
  p.connect({
    onEvent: (ev, topic) => events.push([topic, ev]),
    onStatus: (s) => statuses.push(s)
  })
  check('connect opens socket #1 in connecting state', created.length === 1 && created[0].url === p.url && statuses.at(-1).state === 'connecting')

  created[0].onopen()
  check('open -> connected status', statuses.at(-1).state === 'connected')

  created[0].onmessage({ data: JSON.stringify({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 1, p: '100', q: '1', T: at(0), m: false } }) })
  check('message -> canonical trade via onEvent', events.length === 1 && events[0][0] === TOPICS.TRADE && events[0][1].id === 1)

  created[0].onmessage({ data: JSON.stringify({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 1, p: '100', q: '1', T: at(0), m: false } }) })
  check('duplicate trade id dropped (no duplicate event)', events.length === 1 && p.stats().dupTrades === 1)

  created[0].onmessage({ data: 'garbage{' })
  check('unparseable frame counted, feed survives', p.stats().parseErrors === 1 && events.length === 1)

  created[0].onclose() // server dropped us
  check('close -> disconnected + reconnect scheduled with backoff', statuses.at(-1).state === 'disconnected' && timers.length === 1 && timers[0].ms === 500 && p.status().attempt === 1)

  timers[0].fn() // fire the reconnect
  check('reconnect opens socket #2 with the SAME url (resubscribe)', created.length === 2 && created[1].url === created[0].url && p.stats().reconnects === 1)

  created[1].onopen()
  check('reconnect success resets attempt/backoff', p.status().attempt === 0 && statuses.at(-1).state === 'connected')

  created[1].onmessage({ data: JSON.stringify({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 1, p: '100', q: '1', T: at(0), m: false } }) })
  check('trade-id dedupe survives the reconnect (replay dropped)', events.length === 1 && p.stats().dupTrades === 2)

  created[1].onmessage({ data: JSON.stringify({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 2, p: '101', q: '1', T: at(1), m: false } }) })
  check('fresh trade after reconnect flows again', events.length === 2 && events[1][1].id === 2)

  created[1].onclose() // drop the reconnect once more so close() has a timer to cancel
  check('close -> disconnected + reconnect scheduled with backoff', statuses.at(-1).state === 'disconnected' && timers.length === 2 && timers[1].ms === 500)
  p.close()
  check('close() cancels the pending reconnect timer and idles', timers[1].cancelled === true && p.status().state === 'idle')
  const before = created.length
  created[1].onmessage?.({ data: JSON.stringify({ stream: 'btcusdt@trade', data: { e: 'trade', s: 'BTCUSDT', t: 3, p: '102', q: '1', T: at(2), m: false } }) })
  check('after close() no further events are delivered', events.length === 2 && created.length === before)
}

// =============================================================================
section('13. market plane — trades mode (builders) + kline mode (aggregators) + D17')

{
  // --- trades mode: every timeframe built from raw trades ------------------
  const futureLimit = at(60) // 13:00 — trades below are in the past of the clock
  const plane = createMarketPlane({
    symbols: ['BTCUSDT'], timeframes: ['1m', '4m'], source: 'trades',
    clock: createTradingClock({ mode: 'replay', start: futureLimit })
  })
  const seen = []
  plane.bus.on(TOPICS.CANDLE, (ev) => seen.push(ev))
  plane.bus.on(TOPICS.QUOTE, (ev) => seen.push(ev))
  plane.bus.on(TOPICS.TRADE, (ev) => seen.push(ev))

  const planeTrade = (t, price) => plane.route(tradeEvent({ source: 'test', symbol: 'BTCUSDT', price, quantity: 1, eventTime: t }, INGEST), TOPICS.TRADE)
  planeTrade(at(0), 100)
  planeTrade(at(1), 105)
  const closedAfter1m = seen.filter((e) => e.type === TOPICS.CANDLE && e.state === 'closed' && e.timeframe === '1m').length
  const closed4m = seen.filter((e) => e.type === TOPICS.CANDLE && e.state === 'closed' && e.timeframe === '4m').length
  check('trades mode: 1m closed at its boundary, 4m still forming', closedAfter1m === 1 && closed4m === 0)
  check('trades mode: both tfs produced forming events', seen.some((e) => e.timeframe === '1m' && e.state === 'forming') && seen.some((e) => e.timeframe === '4m' && e.state === 'forming'))
  check('trades mode: raw trade still reaches the bus (tape)', seen.filter((e) => e.type === TOPICS.TRADE).length === 2)

  planeTrade(at(4), 110) // 12:04 — 4m boundary
  check('trades mode: 4m closes exactly once at 12:04', seen.filter((e) => e.type === TOPICS.CANDLE && e.state === 'closed' && e.timeframe === '4m').length === 1)

  plane.route(quoteEvent({ source: 'test', symbol: 'BTCUSDT', bid: 109, ask: 110, eventTime: at(4, 10) }, INGEST), TOPICS.QUOTE)
  check('trades mode: quote stored + re-emitted', plane.quoteStore.get('BTCUSDT').bid === 109 && seen.some((e) => e.type === TOPICS.QUOTE))

  plane.route(tradeEvent({ source: 'test', symbol: 'BTCUSDT', price: 1, eventTime: at(90) }, INGEST), TOPICS.TRADE) // 13:30 > clock 13:00
  check('D17 gate: future event dropped, never emitted', plane.stats().futureDropped === 1 && seen.every((e) => !(e.type === TOPICS.CANDLE && e.eventTime > futureLimit)))
  plane.stop()

  // --- kline mode: 1m from provider, 4m/10m aggregated ---------------------
  const kplane = createMarketPlane({
    symbols: ['BTCUSDT'], timeframes: ['1m', '4m', '10m'], source: 'kline',
    clock: createTradingClock({ mode: 'replay', start: futureLimit })
  })
  const kseen = []
  kplane.bus.on(TOPICS.CANDLE, (ev) => kseen.push(ev))
  const k1m = (minutes, extra = {}) => candleEvent({
    source: 'binance', symbol: 'BTCUSDT', timeframe: '1m', state: 'closed',
    openTime: at(minutes), closeTime: at(minutes + 1) - 1,
    open: 100 + minutes, high: 101 + minutes, low: 99 + minutes, close: 100 + minutes, volume: 1,
    eventTime: at(minutes + 1) - 1, ...extra
  }, INGEST)

  for (let m = 0; m < 4; m++) kplane.route(k1m(m), TOPICS.CANDLE)
  check('kline mode: 1m passes through + 4m/10m forming from aggregation',
    kseen.filter((e) => e.timeframe === '1m' && e.state === 'closed').length === 4 &&
    kseen.some((e) => e.timeframe === '4m' && e.state === 'forming') &&
    kseen.some((e) => e.timeframe === '10m' && e.state === 'forming'))

  kplane.route(k1m(4), TOPICS.CANDLE) // 12:04 — closes the 4m bucket
  const k4closed = kseen.filter((e) => e.timeframe === '4m' && e.state === 'closed')
  check('kline mode: 4m closes once at 12:04 boundary, 10m still open',
    k4closed.length === 1 && k4closed[0].openTime === at(0) &&
    kseen.filter((e) => e.timeframe === '10m' && e.state === 'closed').length === 0)
  check('kline mode: aggregate OHLCV from the 4 x 1m bars of the bucket', k4closed[0].volume === 4 && k4closed[0].open === 100 && k4closed[0].close === 103 && k4closed[0].high === 104 && k4closed[0].low === 99)
  kplane.stop()

  // --- plane wires a provider through the contract -------------------------
  let wired = null
  const stub = {
    id: 'stub', markets: ['futures'], streams: () => [],
    connect(hooks) { wired = hooks },
    close() { this.closed = true },
    status: () => ({ state: 'idle' })
  }
  const pplane = createMarketPlane({ provider: stub, clock: createTradingClock({ mode: 'replay', start: futureLimit }) })
  pplane.start()
  check('start() connects the provider through assertProvider', typeof wired?.onEvent === 'function' && typeof wired?.onStatus === 'function')
  let statusSeen = null
  pplane.bus.on(TOPICS.STATUS, (s) => { statusSeen = s })
  wired.onStatus({ state: 'connected' })
  check('provider status re-emitted on the bus', statusSeen?.state === 'connected')
  pplane.stop()
  check('stop() closes the provider', stub.closed === true)
}

// =============================================================================
section('14. depth sync — REST snapshot -> store -> materialized book frames')

{
  const snapshot = { lastUpdateId: 100, bids: [['100.0', '5'], ['99.0', '2']], asks: [['101.0', '3'], ['102.0', '4']] }

  // --- happy path: start() fetches, applies, emits a renderable ladder ----
  const store = createOrderbookStore()
  const bus = createEventBus()
  let fetchCount = 0
  const okFetch = async () => { fetchCount++; return { ok: true, status: 200, json: async () => snapshot } }
  const sync = createDepthSync({ symbols: ['BTCUSDT'], store, bus, fetchImpl: okFetch, retryMs: 5 })
  const frames = []
  bus.on(TOPICS.BOOK, (ev) => frames.push(ev))
  sync.start()
  await sleep(10)
  check('snapshot applied from REST', store.get('BTCUSDT')?.synced === true && sync.stats().snapshots === 1)
  check('materialized book frame emitted (levels normalized to numbers)',
    frames.length === 1 && frames[0].type === TOPICS.BOOK && frames[0].synced === true &&
    frames[0].bids[0][0] === 100 && frames[0].asks.length === 2)
  sync.start() // idempotent
  await sleep(10)
  check('start() is idempotent — no duplicate snapshot fetch', fetchCount === 1)

  // --- STATUS connected triggers a resync (fresh snapshot per reconnect) --
  bus.emit(TOPICS.STATUS, { type: TOPICS.STATUS, state: 'connected' })
  await sleep(10)
  check('provider reconnect re-syncs every symbol',
    fetchCount === 2 && sync.stats().snapshots === 2 && frames.length === 2)
  sync.stop()

  // --- failure -> retry loop ---------------------------------------------
  const store2 = createOrderbookStore()
  const bus2 = createEventBus()
  let calls = 0
  const flakyFetch = async () => {
    calls++
    if (calls === 1) throw new Error('network down')
    return { ok: true, status: 200, json: async () => snapshot }
  }
  const sync2 = createDepthSync({ symbols: ['BTCUSDT'], store: store2, bus: bus2, fetchImpl: flakyFetch, retryMs: 5 })
  sync2.start()
  await sleep(30)
  check('failed snapshot retried until it lands',
    store2.get('BTCUSDT')?.synced === true && sync2.stats().failures === 1 && sync2.stats().retries === 1)
  sync2.stop()
  const callsAfterStop = calls
  await sleep(20)
  check('stop() cancels pending retries', calls === callsAfterStop)

  // --- inflight guard: concurrent resyncs share one fetch ----------------
  const store3 = createOrderbookStore()
  const bus3 = createEventBus()
  let fetch3 = 0
  let release3
  const gate3 = new Promise((r) => { release3 = r })
  const gatedFetch = async () => { fetch3++; await gate3; return { ok: true, status: 200, json: async () => snapshot } }
  const sync3 = createDepthSync({ symbols: ['BTCUSDT'], store: store3, bus: bus3, fetchImpl: gatedFetch })
  sync3.resync('BTCUSDT')
  sync3.resync('BTCUSDT')
  sync3.resync('BTCUSDT')
  check('concurrent resync is inflight-guarded', fetch3 === 1)
  release3()
  await sleep(10)
  sync3.stop()

  // --- plane integration: diff -> ladder frame, gap -> resync -------------
  let wired = null
  const stub = {
    id: 'stub', markets: ['futures'], streams: () => [],
    connect(hooks) { wired = hooks },
    close() { this.closed = true },
    status: () => ({ state: 'idle' })
  }
  const pclock = createTradingClock({ mode: 'replay', start: at(60) })
  const plane = createMarketPlane({
    symbols: ['BTCUSDT'], timeframes: ['1m', '4m'], source: 'trades',
    provider: stub, clock: pclock
  })
  let planeFetch = 0
  const planeSync = createDepthSync({
    symbols: ['BTCUSDT'], store: plane.orderbookStore, bus: plane.bus,
    fetchImpl: async () => { planeFetch++; return { ok: true, status: 200, json: async () => snapshot } }
  })
  plane.attachDepthSync(planeSync)
  planeSync.start()
  plane.start()
  await sleep(10)
  const bookFrames = []
  plane.bus.on(TOPICS.BOOK, (ev) => bookFrames.push(ev))

  const depthDiff = {
    type: TOPICS.BOOK, topic: TOPICS.BOOK, source: 'binance', market: 'futures',
    symbol: 'BTCUSDT', firstUpdateId: 101, lastUpdateId: 106,
    bids: [['100.0', '6']], asks: [['101.0', '0']], eventTime: at(5), ingestTime: INGEST
  }
  plane.route(depthDiff, TOPICS.BOOK)
  check('synced diff applies and publishes the updated ladder',
    bookFrames.length === 1 && bookFrames[0].bids[0][1] === 6 &&
    bookFrames[0].asks.length === 1 && bookFrames[0].asks[0][0] === 102 &&
    bookFrames[0].lastUpdateId === 106)

  // stale diff: u <= lastUpdateId -> dropped, no frame, no resync
  plane.route({ ...depthDiff, firstUpdateId: 102, lastUpdateId: 104, bids: [], asks: [], eventTime: at(6), ingestTime: INGEST }, TOPICS.BOOK)
  check('stale diff is dropped without a frame', bookFrames.length === 1 && planeFetch === 1)

  // gap: U far ahead -> sequenceError -> plane asks depthSync for a resync
  plane.route({ ...depthDiff, firstUpdateId: 900, lastUpdateId: 910, eventTime: at(7), ingestTime: INGEST }, TOPICS.BOOK)
  await sleep(10)
  check('sequence gap triggers a fresh snapshot resync',
    planeFetch === 2 && bookFrames.length === 2 && bookFrames[1].lastUpdateId === 100)

  plane.stop()
  check('plane.stop() stops the attached depth sync',
    planeSync.stats().inFlight === 0 && planeSync.stats().retrying === 0)
}

// =============================================================================
section('11. candle recorder — §23 persistence (closed-only, fail-soft, manifest)')

const recBar = (n, over = {}) => ({ type: TOPICS.CANDLE, source: 'binance', market: 'futures', symbol: 'BTCUSDT', timeframe: '1m', state: 'closed', open: 100, high: 102, low: 99, close: 101, volume: 12, openTime: 1_700_000_000_000 + n * 60_000, closeTime: 1_700_000_000_000 + (n + 1) * 60_000, eventTime: 1_700_000_000_000 + (n + 1) * 60_000, ingestTime: 1_700_000_000_060 + n, ...over })

check('candleRecord stamps an idempotent _id + model version (D3/D1)',
  (() => {
    const r = candleRecord(recBar(0))
    return r && r._id === candleId('BTCUSDT', '1m', 1_700_000_000_000) && r.schemaVersion === 'candle.v1' && r.state === 'closed' && r.close === 101
  })())
check('candleRecord rejects forming bars and malformed payloads (D12)',
  candleRecord(recBar(0, { state: 'forming' })) === null &&
  candleRecord({ ...recBar(0), open: NaN }) === null &&
  candleRecord({ ...recBar(0), closeTime: recBar(0).openTime }) === null &&
  candleRecord({ ...recBar(0), high: 90 }) === null &&
  candleRecord(null) === null)

check('manifestPatches groups per dataset, min/max start/end + countNew',
  (() => {
    const p = manifestPatches([candleRecord(recBar(0)), candleRecord(recBar(1)), candleRecord(recBar(2, { symbol: 'ETHUSDT' }))], { retentionDays: 30 })
    return p.length === 2 &&
      p.find((x) => x.symbol === 'BTCUSDT').countNew === 2 &&
      p.find((x) => x.symbol === 'BTCUSDT').startTs === 1_700_000_000_000 &&
      p.find((x) => x.symbol === 'BTCUSDT').endTs === 1_700_000_120_000 &&
      p.find((x) => x.symbol === 'ETHUSDT').datasetId === datasetIdFor('candles', 'binance', 'ETHUSDT', '1m') &&
      p.every((x) => x.retentionDays === 30)
  })())

check('upsertedIds extracts the newly-inserted _ids from a bulkWrite result',
  (() => {
    const s = upsertedIds({ upserted: [{ _id: 'a' }, { _id: 'b' }] })
    return s.size === 2 && s.has('a') && s.has('b') && upsertedIds({ upsertedCount: 2 }) === null
  })())

{
  const bus = createEventBus()
  let writes = []
  let manifestUpserts = 0
  let manifestInc = 0
  let failWrites = false
  const seen = new Set()
  const candleModel = {
    collection: {
      bulkWrite: async (ops) => {
        if (failWrites) throw new Error('network down')
        writes.push(...ops)
        // A realistic driver: only rows whose _id is NEW count as upserted.
        let upsertedCount = 0
        const upserted = []
        for (const o of ops) {
          const id = o.updateOne.filter._id
          if (!seen.has(id)) { seen.add(id); upsertedCount += 1; upserted.push({ _id: id }) }
        }
        return { upsertedCount, upserted }
      },
    },
  }
  const datasetModel = {
    collection: {
      updateOne: async (filter, update) => {
        manifestUpserts += 1
        manifestInc += update.$inc.count
        return { upsertedCount: 1, matchedCount: 1 }
      },
    },
  }
  const rec = createCandleRecorder({ bus, candleModel, datasetModel, batchIntervalMs: 10_000, maxBatchSize: 2 })
  rec.start()

  bus.emit(TOPICS.CANDLE, recBar(0)) // closed -> buffered
  bus.emit(TOPICS.CANDLE, recBar(1, { state: 'forming' })) // ignored
  check('forming bars never enter the buffer', rec.stats().buffered === 1)

  bus.emit(TOPICS.CANDLE, recBar(2)) // hits maxBatchSize=2 -> async flush
  await sleep(25)
  check('batch flush writes closed rows and updates the manifest once',
    rec.stats().written === 2 && writes.length === 2 && manifestUpserts === 1 && manifestInc === 2 && rec.stats().buffered === 0, JSON.stringify(rec.stats()))

  // Duplicate INSIDE the same buffer window is the only "duplicate" anomaly;
  // a row the DB already holds upserts to nothing and is not re-counted.
  bus.emit(TOPICS.CANDLE, recBar(3))
  bus.emit(TOPICS.CANDLE, recBar(3)) // same close re-emitted before flush
  check('a re-emitted close within the buffer is deduped',
    rec.stats().duplicate === 1 && rec.stats().buffered === 1, JSON.stringify(rec.stats()))

  failWrites = true
  await rec.flush()
  check('a Mongo outage fails soft and re-buffers the rows for retry',
    rec.stats().errors === 1 && rec.stats().buffered === 1, JSON.stringify(rec.stats()))
  failWrites = false
  await rec.flush()
  check('the retried flush recovers the re-buffered rows',
    rec.stats().errors === 1 && rec.stats().buffered === 0 && rec.stats().written === 3 && rec.stats().duplicate === 1)

  // DB-level re-emission: same candle again after it is on file -> written NOT
  // incremented (already recorded once, D4), manifest count not bumped.
  bus.emit(TOPICS.CANDLE, recBar(0))
  await rec.flush()
  check('a row already on file is an idempotent no-op',
    rec.stats().written === 3 && manifestInc === 3 && rec.stats().buffered === 0, JSON.stringify(rec.stats()))

  await rec.stop()
  bus.emit(TOPICS.CANDLE, recBar(4))
  check('stop() unsubscribes — no more candles are recorded',
    rec.stats().buffered === 0 && rec.stats().written === 3)
  check('DEFAULT_RETENTION_DAYS is a sane declaration', DEFAULT_RETENTION_DAYS === 90)
}

finish()
