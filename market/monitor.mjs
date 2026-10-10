// =============================================================================
//  TM TRADING — latency + sequence monitor (Phase 7R: "latency/sequence
//  monitoring", D16 observability).
//
//  * latency: rolling window of (ingestTime - eventTime) per source —
//    ingest/event split exists precisely so strategies never read latency.
//  * sequence: per stream (e.g. 'binance:fapi:BTCUSDT@trade') we track the
//    last id and count duplicates / gaps / out-of-order arrivals.
//
//  Pure bookkeeping — no timers, no IO; consumers poll status().
// =============================================================================

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

/**
 * @param {object} [opts]
 * @param {number} [opts.window=500] max latency samples kept
 */
export function createMonitor({ window = 500 } = {}) {
  if (!Number.isInteger(window) || window < 10) throw new Error('monitor: window must be an integer >= 10')
  /** @type {number[]} */
  const samples = []
  const bySource = new Map() // source -> {count, max}
  /** @type {Map<string, {last:number, dup:number, gaps:number, outOfOrder:number, count:number}>} */
  const streams = new Map()

  const recordLatency = (source, eventTime, ingestTime) => {
    const et = Number(eventTime)
    const it = Number(ingestTime)
    if (!Number.isFinite(et) || !Number.isFinite(it)) throw new Error('monitor: eventTime and ingestTime must be numbers')
    const lat = it - et
    samples.push(lat)
    if (samples.length > window) samples.splice(0, samples.length - window)
    const key = source || 'unknown'
    let s = bySource.get(key)
    if (!s) { s = { count: 0, max: -Infinity }; bySource.set(key, s) }
    s.count++
    if (lat > s.max) s.max = lat
    return lat
  }

  const recordSeq = (stream, id) => {
    if (!stream) throw new Error('monitor: stream name required')
    const n = Number(id)
    if (!Number.isFinite(n)) throw new Error(`monitor: id must be a number (got ${id})`)
    let s = streams.get(stream)
    if (!s) { s = { last: null, dup: 0, gaps: 0, outOfOrder: 0, count: 0 }; streams.set(stream, s) }
    s.count++
    if (s.last === null) { s.last = n; return 'first' }
    if (n < s.last) { s.outOfOrder++; return 'outOfOrder' }
    if (n === s.last) { s.dup++; return 'dup' }
    if (n > s.last + 1) s.gaps += n - s.last - 1
    s.last = n
    return 'ok'
  }

  return {
    /** Record (ingestTime - eventTime) for one event. */
    latency: recordLatency,
    /** Record an id on a stream; returns 'first'|'ok'|'dup'|'outOfOrder'. */
    seq: recordSeq,

    status() {
      const sorted = [...samples].sort((a, b) => a - b)
      const sources = {}
      for (const [k, v] of bySource) sources[k] = { count: v.count, max: v.max === -Infinity ? null : v.max }
      const seq = {}
      for (const [k, v] of streams) seq[k] = { ...v }
      return {
        latency: {
          samples: sorted.length,
          min: sorted.length ? sorted[0] : null,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          max: sorted.length ? sorted[sorted.length - 1] : null,
          window,
          bySource: sources
        },
        seq
      }
    },
    reset() {
      samples.length = 0
      bySource.clear()
      streams.clear()
    }
  }
}
