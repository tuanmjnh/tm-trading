// =============================================================================
//  TM TRADING — market plane assembly (D15 layout: `market/` = transport +
//  provider + aggregation; D22: tick -> memory -> aggregation -> candle).
//
//  createMarketPlane() wires ONE provider into the plane:
//    provider events -> monitor (D16 observability)
//                     -> stores (quotes / order book)
//                     -> candle builder (source='trades') or
//                        1m -> 4m/10m aggregators (source='kline')
//                     -> event bus (fan-out to WS / UI / persistence)
//
//  Consumers ONLY see canonical events (§7). The plane owns the clock (D18)
//  and every event passes the D17 gate before being re-emitted.
// =============================================================================

import { TOPICS, defaultIngest } from './events.mjs'
import { createTradingClock } from './clock.mjs'
import { createEventBus } from './eventBus.mjs'
import { createMonitor } from './monitor.mjs'
import { createQuoteStore } from './quoteStore.mjs'
import { createOrderbookStore } from './orderbookStore.mjs'
import { createCandleBuilder } from './candleBuilder.mjs'
import { createAggregator } from './aggregate.mjs'
import { tfToMs } from './timeframes.mjs'
import { assertProvider } from './providers/contract.mjs'
import { createDepthSync } from './depthSync.mjs'

/**
 * @param {object} [opts]
 * @param {string[]} [opts.timeframes=['1m','4m','10m']]
 * @param {'trades'|'kline'} [opts.source='trades'] who builds candles:
 *   'trades' -> a candle builder per timeframe fed by trade events
 *   'kline'  -> provider streams 1m candles; higher tfs come from aggregators
 * @param {object} [opts.provider] provider adapter (assertProvider-checked)
 * @param {object} [opts.clock] inject a TradingClock (default: live)
 * @param {object} [opts.bus] inject a bus (default: fresh)
 * @param {object} [opts.depthSync] depth snapshot sync (see depthSync.mjs)
 * @param {() => number} [opts.ingest]
 */
export function createMarketPlane({
  symbols = ['BTCUSDT'],
  timeframes = ['1m', '4m', '10m'],
  source = 'trades',
  provider = null,
  clock = null,
  bus = null,
  depthSync = null,
  ingest = defaultIngest
} = {}) {
  if (!Array.isArray(timeframes) || timeframes.length === 0) throw new Error('plane: timeframes required')
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('plane: symbols required')
  if (source !== 'trades' && source !== 'kline') throw new Error(`plane: source must be trades|kline (got ${source})`)

  const tfMs = timeframes.map((tf) => ({ tf: String(tf), ms: tfToMs(tf) }))
  const baseTf = tfMs.reduce((a, b) => (b.ms < a.ms ? b : a))
  if (source === 'kline' && baseTf.ms !== 60_000) {
    throw new Error(`plane: source='kline' needs a 1m base timeframe (got ${timeframes.join(',')})`)
  }

  const clk = clock || createTradingClock({ mode: 'live' })
  const eventBus = bus || createEventBus()
  const monitor = createMonitor()
  const quoteStore = createQuoteStore()
  const orderbookStore = createOrderbookStore()
  let depthSyncRef = depthSync

  /** symbol -> tf -> candle builder (source='trades') */
  const builders = new Map()
  /** symbol -> tf -> aggregator (source='kline', tf > base) */
  const aggregators = new Map()
  if (source === 'trades') {
    for (const sym of symbols) {
      const per = new Map()
      for (const { tf } of tfMs) per.set(tf, createCandleBuilder({ symbol: sym, timeframe: tf, source: 'plane', ingest }))
      builders.set(sym, per)
    }
  } else {
    for (const sym of symbols) {
      const per = new Map()
      for (const { tf, ms } of tfMs) if (ms > baseTf.ms) per.set(tf, createAggregator({ timeframe: tf, source: 'plane', ingest }))
      aggregators.set(sym, per)
    }
  }

  const stats = { routed: 0, futureDropped: 0, unknownTopic: 0 }

  // Trades-mode forming candles are trade-rate chatty (BTCUSDT: 100+ frames/s
  // across tfs). Coalesce forming updates to ~4/s per symbol|tf; closed bars
  // always emit — they carry the final values, so nothing is lost between
  // thinned forming frames. Kline mode is untouched (exchange cadence).
  const FORMING_TICK_MS = 250
  const formingTick = new Map()

  const emitAll = (events) => {
    for (const ev of events) eventBus.emit(ev.type, ev)
  }

  const route = (event, topic) => {
    if (!event || typeof event !== 'object') return
    const t = topic || event.type
    // D17 gate: nothing from the future is ever re-emitted.
    if (Number.isFinite(event.eventTime) && !clk.canUse(event.eventTime)) {
      stats.futureDropped++
      return
    }
    if (Number.isFinite(event.eventTime)) monitor.latency(event.source, event.eventTime, event.ingestTime)
    stats.routed++

    switch (t) {
      case TOPICS.TRADE: {
        if (event.id !== undefined) monitor.seq(`trade:${event.symbol}`, event.id)
        const per = builders.get(event.symbol)
        if (source === 'trades' && per) {
          for (const [tf, b] of per.entries()) {
            const key = `${event.symbol}:${tf}`
            for (const ev of b.apply(event)) {
              const last = formingTick.get(key) ?? 0
              if (ev.state === 'closed' || clk.now() - last >= FORMING_TICK_MS) {
                eventBus.emit(TOPICS.CANDLE, ev)
                formingTick.set(key, clk.now())
              }
            }
          }
        }
        // Raw trades ALWAYS reach the bus — the tape and monitors consume
        // market.trade in both source modes; builders only add candle output.
        eventBus.emit(TOPICS.TRADE, event)
        break
      }
      case TOPICS.QUOTE: {
        if (quoteStore.apply(event)) eventBus.emit(TOPICS.QUOTE, event)
        break
      }
      case TOPICS.BOOK: {
        const errorsBefore = orderbookStore.stats().sequenceErrors
        const applied = orderbookStore.applyDiff(event)
        // A gap on a synced book (sequenceError, not a stale drop) means the
        // diff stream outran the snapshot — ask depthSync for a fresh REST
        // snapshot; its own emit publishes the repaired ladder.
        if (!applied && depthSyncRef && orderbookStore.stats().sequenceErrors > errorsBefore) {
          depthSyncRef.resync(event.symbol)
          break
        }
        // Clients receive the MATERIALIZED ladder, never raw diffs: they
        // have no snapshot of their own (the plane owns the sequencing).
        if (applied) {
          const book = orderbookStore.get(event.symbol)
          eventBus.emit(TOPICS.BOOK, {
            type: TOPICS.BOOK,
            symbol: event.symbol,
            bids: book.bids,
            asks: book.asks,
            lastUpdateId: book.lastUpdateId,
            synced: true,
            eventTime: Number.isFinite(event.eventTime) ? event.eventTime : clk.now(),
            source: event.source,
            ingestTime: Number.isFinite(event.ingestTime) ? event.ingestTime : ingest()
          })
        }
        break
      }
      case TOPICS.CANDLE: {
        if (source === 'kline' && event.state === 'closed' && event.timeframe === baseTf.tf) {
          const per = aggregators.get(event.symbol)
          if (per) for (const agg of per.values()) emitAll(agg.apply(event))
        }
        eventBus.emit(TOPICS.CANDLE, event)
        break
      }
      default:
        stats.unknownTopic++
    }
  }

  let started = false

  return {
    clock: clk,
    bus: eventBus,
    monitor,
    quoteStore,
    orderbookStore,
    builders,
    aggregators,
    provider,
    route,
    /** Static config exposed to WS clients (hello frame) and the UI. */
    symbols: [...symbols],
    timeframes: [...timeframes],
    /** Late-attach a depth snapshot sync (created after the plane, shares its store/bus). */
    attachDepthSync(sync) {
      depthSyncRef = sync || null
    },
    /** Subscribe the provider (if any) and start the feed. */
    start() {
      if (started) return
      started = true
      if (provider) {
        assertProvider(provider)
        provider.connect({
          onEvent: (event, topic) => route(event, topic),
          onStatus: (status) => eventBus.emit(TOPICS.STATUS, { type: TOPICS.STATUS, ...status, eventTime: clk.now(), ingestTime: ingest() })
        })
      }
    },
    stop() {
      if (!started) return
      started = false
      try { depthSyncRef?.stop?.() } catch { /* depth sync must not throw out */ }
      try { provider?.close?.() } catch { /* provider close must not throw out */ }
    },
    stats: () => ({ ...stats, bus: eventBus.stats(), monitor: monitor.status(), quotes: quoteStore.stats(), book: orderbookStore.stats(), depth: depthSyncRef?.stats?.() ?? null })
  }
}

export { TOPICS, defaultIngest, tradeEvent, quoteEvent, candleEvent, MARKET_KINDS } from './events.mjs'
export { createTradingClock } from './clock.mjs'
export { createEventBus } from './eventBus.mjs'
export { createMonitor } from './monitor.mjs'
export { createQuoteStore } from './quoteStore.mjs'
export { createOrderbookStore } from './orderbookStore.mjs'
export { createDepthSync } from './depthSync.mjs'
export { createCandleBuilder } from './candleBuilder.mjs'
export { createAggregator } from './aggregate.mjs'
export { tfToMs, alignDown, bucketEnd, closeTimeOf } from './timeframes.mjs'
export { assertProvider, assertHooks } from './providers/contract.mjs'
export { createBinanceProvider, buildStreams, buildUrl, normalizeMessage, DEFAULT_WS, DEFAULT_BACKOFF_MS } from './providers/binance.mjs'
