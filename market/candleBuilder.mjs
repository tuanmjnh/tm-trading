// =============================================================================
//  TM TRADING — realtime candle builder (Phase 7R: forming/closed, boundaries,
//  no duplicate closes).
//
//  Input: canonical trade events (or trade-shaped records).
//  Output: arrays of `market.candle` events —
//    [forming]                 after each applied trade
//    [closed(prev), forming(new)]  when a trade crosses the bucket boundary
//
//  Rules (acceptance):
//    * bucket = floor(eventTime / tfMs) * tfMs (UTC-aligned, D2)
//    * a closed bar is emitted EXACTLY ONCE — a trade landing in an
//      already-closed bucket is dropped (stale), never re-closing it
//    * a trade older than the CURRENT bucket open (out-of-order) is dropped
//    * flush() closes the open bar (shutdown / test teardown)
// =============================================================================

import { candleEvent, defaultIngest } from './events.mjs'
import { tfToMs, alignDown, closeTimeOf } from './timeframes.mjs'

/**
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {string} opts.timeframe   '1m' | '4m' | '10m' | '60' ...
 * @param {string} [opts.source='engine']
 * @param {'spot'|'futures'|'gold'} [opts.market='futures']
 * @param {() => number} [opts.ingest]  injectable ingest clock (tests)
 */
export function createCandleBuilder({ symbol, timeframe, source = 'engine', market = 'futures', ingest = defaultIngest } = {}) {
  if (!symbol) throw new Error('candleBuilder: symbol required')
  if (!timeframe) throw new Error('candleBuilder: timeframe required')
  const tfMs = tfToMs(timeframe)
  const tfLabel = String(timeframe)

  let cur = null
  let lastClosedOpen = -Infinity
  const stats = { tradesApplied: 0, tradesDropped: 0, closed: 0, forms: 0 }

  const emitForming = () => {
    stats.forms++
    return candleEvent({
      source, symbol, market, timeframe: tfLabel, state: 'forming',
      open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume,
      openTime: cur.openTime, closeTime: cur.closeTime, eventTime: cur.eventTime
    }, ingest())
  }

  const closeCurrent = () => {
    stats.closed++
    lastClosedOpen = Math.max(lastClosedOpen, cur.openTime)
    const ev = candleEvent({
      source, symbol, market, timeframe: tfLabel, state: 'closed',
      open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume,
      openTime: cur.openTime, closeTime: cur.closeTime, eventTime: cur.closeTime
    }, ingest())
    cur = null
    return ev
  }

  return {
    symbol,
    timeframe: tfLabel,
    tfMs,

    /**
     * Apply one trade. Returns the candle events produced (0..2).
     * @param {{price:number, quantity?:number, eventTime:number}} trade
     */
    apply(trade) {
      const et = Number(trade?.eventTime)
      if (!Number.isFinite(et)) throw new Error('candleBuilder: trade.eventTime required')
      const price = Number(trade?.price)
      if (!Number.isFinite(price) || price <= 0) throw new Error(`candleBuilder: trade.price must be > 0 (got ${trade?.price})`)
      const qty = Number(trade?.quantity ?? 0)
      if (!Number.isFinite(qty) || qty < 0) throw new Error(`candleBuilder: trade.quantity must be >= 0 (got ${trade?.quantity})`)

      const openTime = alignDown(et, tfMs)

      // Already-closed bucket -> stale, drop (no duplicate close ever).
      if (openTime <= lastClosedOpen) {
        stats.tradesDropped++
        return []
      }
      // Older than the open bucket -> out-of-order, drop (D17 spirit: no past).
      if (cur && openTime < cur.openTime) {
        stats.tradesDropped++
        return []
      }

      const out = []
      if (cur && openTime > cur.openTime) out.push(closeCurrent()) // boundary crossed
      if (!cur) {
        cur = { openTime, closeTime: closeTimeOf(openTime, tfMs), open: price, high: price, low: price, close: price, volume: qty, eventTime: et }
      } else {
        cur.high = Math.max(cur.high, price)
        cur.low = Math.min(cur.low, price)
        cur.close = price
        cur.volume += qty
        cur.eventTime = Math.max(cur.eventTime, et)
      }
      stats.tradesApplied++
      out.push(emitForming())
      return out
    },

    /** Close the open bar (if any) — returns 0..1 events. */
    flush() {
      if (!cur) return []
      return [closeCurrent()]
    },

    /** Snapshot of the forming bar, or null. */
    current() {
      return cur ? { ...cur } : null
    },

    stats: () => ({ ...stats, lastClosedOpen })
  }
}
