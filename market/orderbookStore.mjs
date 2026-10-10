// =============================================================================
//  TM TRADING — in-memory order book store (Phase 7R).
//
//  Two Binance-style inputs per symbol:
//    * bookTicker  — best bid/ask only (self-contained, no snapshot sync)
//    * depth       — full snapshot (`lastUpdateId`) + diff stream (`U..u`)
//                    with the official sequencing rules:
//                      - u < lastUpdateId          -> drop (already applied)
//                      - first diff must straddle  -> U <= lastUpdateId+1 <= u
//                      - then U === lastUpdateId+1 -> apply
//                      - otherwise                 -> sequenceError (resync)
//                    qty === 0 removes a level (Binance convention).
//  Everything is counted — Phase 7R has an explicit sequence monitor.
// =============================================================================

const toLevels = (raw, side) => {
  const out = []
  for (const lvl of raw || []) {
    if (!Array.isArray(lvl) || lvl.length < 2) continue
    const price = Number(lvl[0])
    const qty = Number(lvl[1])
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue
    out.push([price, qty])
  }
  out.sort((a, b) => (side === 'bids' ? b[0] - a[0] : a[0] - b[0]))
  return out
}

const applyLevels = (levels, raw, side) => {
  const map = new Map(levels.map(([p, q]) => [p, q]))
  for (const lvl of raw || []) {
    if (!Array.isArray(lvl) || lvl.length < 2) continue
    const price = Number(lvl[0])
    const qty = Number(lvl[1])
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue
    if (qty === 0) map.delete(price)
    else map.set(price, qty)
  }
  const arr = [...map.entries()]
  arr.sort((a, b) => (side === 'bids' ? b[0] - a[0] : a[0] - b[0]))
  return arr
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxLevels=50] levels kept per side
 */
export function createOrderbookStore({ maxLevels = 50 } = {}) {
  if (!Number.isInteger(maxLevels) || maxLevels < 1) throw new Error('orderbook: maxLevels must be a positive integer')
  const books = new Map()   // symbol -> {bids, asks, lastUpdateId, eventTime, synced}
  const tickers = new Map() // symbol -> {bid, ask, updateId, eventTime}
  const stats = { bookTickerApplied: 0, bookTickerStale: 0, snapshots: 0, diffsApplied: 0, diffsDropped: 0, sequenceErrors: 0, outOfSync: 0 }

  const book = (symbol) => {
    let b = books.get(symbol)
    if (!b) { b = { bids: [], asks: [], lastUpdateId: -1, eventTime: 0, synced: false }; books.set(symbol, b) }
    return b
  }

  return {
    /** bookTicker row: {symbol, bid, ask, updateId, eventTime} — seq: updateId must advance. */
    applyBookTicker(t) {
      if (!t || typeof t !== 'object') throw new Error('orderbook: bookTicker required')
      const symbol = String(t.symbol || '')
      if (!symbol) throw new Error('orderbook: symbol required')
      const bid = Number(t.bid)
      const ask = Number(t.ask)
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid > ask) throw new Error(`orderbook: bad bookTicker for ${symbol}`)
      const updateId = Number(t.updateId ?? 0)
      const eventTime = Number(t.eventTime)
      const prev = tickers.get(symbol)
      if (prev && Number.isFinite(updateId) && prev.updateId !== undefined && updateId < prev.updateId) {
        stats.bookTickerStale++
        return false
      }
      if (prev && Number.isFinite(eventTime) && prev.eventTime && eventTime < prev.eventTime) {
        stats.bookTickerStale++
        return false
      }
      tickers.set(symbol, { symbol, bid, ask, updateId: Number.isFinite(updateId) ? updateId : prev?.updateId, eventTime: Number.isFinite(eventTime) ? eventTime : prev?.eventTime })
      stats.bookTickerApplied++
      return true
    },

    /** Depth snapshot: {symbol, lastUpdateId, bids:[[p,q]], asks:[[p,q]], eventTime?} */
    applySnapshot(s) {
      if (!s || typeof s !== 'object') throw new Error('orderbook: snapshot required')
      const symbol = String(s.symbol || '')
      if (!symbol) throw new Error('orderbook: symbol required')
      const lastUpdateId = Number(s.lastUpdateId)
      if (!Number.isFinite(lastUpdateId) || lastUpdateId < 0) throw new Error('orderbook: snapshot.lastUpdateId required')
      const b = book(symbol)
      b.bids = toLevels(s.bids, 'bids').slice(0, maxLevels)
      b.asks = toLevels(s.asks, 'asks').slice(0, maxLevels)
      b.lastUpdateId = lastUpdateId
      b.eventTime = Number.isFinite(Number(s.eventTime)) ? Number(s.eventTime) : b.eventTime
      b.synced = true
      stats.snapshots++
      return true
    },

    /** Depth diff: {symbol, firstUpdateId: U, lastUpdateId: u, bids, asks, eventTime?} */
    applyDiff(d) {
      if (!d || typeof d !== 'object') throw new Error('orderbook: diff required')
      const symbol = String(d.symbol || '')
      if (!symbol) throw new Error('orderbook: symbol required')
      const U = Number(d.firstUpdateId)
      const u = Number(d.lastUpdateId)
      if (!Number.isFinite(U) || !Number.isFinite(u) || u < U) throw new Error('orderbook: diff needs U <= u')
      const b = book(symbol)
      if (!b.synced) { stats.outOfSync++; return false }
      if (u <= b.lastUpdateId) { stats.diffsDropped++; return false } // already applied / stale
      if (b.lastUpdateId === -1 || U <= b.lastUpdateId + 1) {
        // first straddling diff (or contiguous) -> apply
      } else {
        stats.sequenceErrors++ // gap -> caller must resync from snapshot
        return false
      }
      b.bids = applyLevels(b.bids, d.bids, 'bids').slice(0, maxLevels)
      b.asks = applyLevels(b.asks, d.asks, 'asks').slice(0, maxLevels)
      b.lastUpdateId = u
      b.eventTime = Number.isFinite(Number(d.eventTime)) ? Number(d.eventTime) : b.eventTime
      stats.diffsApplied++
      return true
    },

    get(symbol) {
      const b = books.get(symbol)
      const t = tickers.get(symbol)
      if (!b && !t) return null
      return {
        bids: b ? b.bids.map((l) => [...l]) : [],
        asks: b ? b.asks.map((l) => [...l]) : [],
        lastUpdateId: b?.lastUpdateId ?? null,
        synced: b?.synced ?? false,
        best: t ? { bid: t.bid, ask: t.ask, updateId: t.updateId, eventTime: t.eventTime } : null
      }
    },

    symbols: () => [...new Set([...books.keys(), ...tickers.keys()])].sort(),
    stats: () => ({ ...stats })
  }
}
