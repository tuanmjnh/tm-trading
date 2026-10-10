// =============================================================================
//  TM TRADING — closed-candle aggregation: 1m -> 4m / 10m (Phase 7R).
//
//  Input : CLOSED `market.candle` events of a smaller timeframe (e.g. 1m).
//  Output: `market.candle` events of `timeframe` (forming while partial,
//          closed exactly once when the next bucket arrives or on flush).
//
//  Boundary rule (acceptance: 4m/10m boundary đúng): the aggregate bucket is
//  floor(openTime / bucketMs) * bucketMs — a 4m bucket starting 12:00 closes
//  the moment a 1m bar from 12:04 (or later — gap-tolerant) arrives, never
//  before, never twice.  Missing bars (gap) still close the bucket on the
//  next arrival: state only has 'forming'|'closed' (§7).
// =============================================================================

import { TOPICS, candleEvent, defaultIngest } from './events.mjs'
import { tfToMs, alignDown, closeTimeOf, bucketEnd } from './timeframes.mjs'

/**
 * @param {object} opts
 * @param {string} opts.timeframe  target timeframe ('4m', '10m', '1h' ...)
 * @param {string} [opts.source='engine']
 * @param {() => number} [opts.ingest]
 */
export function createAggregator({ timeframe, source = 'engine', ingest = defaultIngest } = {}) {
  if (!timeframe) throw new Error('aggregator: timeframe required')
  const bucketMs = tfToMs(timeframe)
  const tfLabel = String(timeframe)
  if (bucketMs % 60_000 !== 0 || bucketMs < 120_000) {
    throw new Error(`aggregator: target timeframe must be >= 2m and whole minutes (got ${timeframe})`)
  }

  let cur = null
  let lastClosedOpen = -Infinity
  const stats = { inputs: 0, dropped: 0, closed: 0, forms: 0 }

  const snapshot = (state, eventTime) => {
    stats.forms++
    return candleEvent({
      source, symbol: cur.symbol, timeframe: tfLabel, state,
      open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume,
      openTime: cur.openTime, closeTime: cur.closeTime, eventTime
    }, ingest())
  }

  const closeCurrent = () => {
    stats.closed++
    lastClosedOpen = Math.max(lastClosedOpen, cur.openTime)
    const ev = snapshot('closed', cur.closeTime)
    cur = null
    return ev
  }

  return {
    timeframe: tfLabel,
    bucketMs,

    /**
     * Apply ONE closed smaller-timeframe candle. Returns 0..2 events.
     * @param {{symbol:string, openTime:number, open:number, high:number, low:number, close:number, volume:number, state:string}} candle
     */
    apply(candle) {
      if (!candle || typeof candle !== 'object') throw new Error('aggregator: candle required')
      if (candle.state !== 'closed') {
        // Only closed inputs are aggregated — forming ones are not final.
        stats.dropped++
        return []
      }
      const openTime = Number(candle.openTime)
      if (!Number.isFinite(openTime)) throw new Error('aggregator: candle.openTime required')
      const bucket = alignDown(openTime, bucketMs)

      if (bucket <= lastClosedOpen) { stats.dropped++; return [] }   // stale / duplicate
      if (cur && bucket < cur.openTime) { stats.dropped++; return [] } // out-of-order

      const out = []
      if (cur && bucket > cur.openTime) out.push(closeCurrent())      // boundary crossed
      if (!cur) {
        cur = {
          symbol: candle.symbol,
          openTime: bucket,
          closeTime: closeTimeOf(bucket, bucketMs),
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume)
        }
      } else {
        if (bucketEnd(openTime, 60_000) > bucketEnd(cur.openTime, bucketMs)) {
          // Input claims to extend past this bucket — corrupt ordering, drop.
          stats.dropped++
          return out
        }
        cur.high = Math.max(cur.high, Number(candle.high))
        cur.low = Math.min(cur.low, Number(candle.low))
        cur.close = Number(candle.close)
        cur.volume += Number(candle.volume)
      }
      stats.inputs++
      out.push(snapshot('forming', Number(candle.closeTime) || Date.now()))
      return out
    },

    /** Close the open aggregate (if any) — returns 0..1 events. */
    flush() {
      if (!cur) return []
      return [closeCurrent()]
    },

    current: () => (cur ? { ...cur } : null),
    stats: () => ({ ...stats })
  }
}
