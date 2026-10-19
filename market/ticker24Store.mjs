// =============================================================================
//  TM TRADING — in-memory rolling-24h ticker store.
//
//  One row per symbol: the exchange-computed 24h window (open/high/low/last,
//  base+quote volume, absolute + percent change, trade count). Same discipline
//  as quoteStore: stale writes (eventTime < stored eventTime) are rejected and
//  counted — a reconnect replay must never walk the window backwards.
// =============================================================================

/**
 * @param {object} [opts]
 * @param {'spot'|'futures'|'gold'} [opts.market] force a market stamp on rows
 */
export function createTicker24Store({ market } = {}) {
  const rows = new Map() // symbol -> row
  const stats = { accepted: 0, stale: 0 }

  return {
    /**
     * Apply a `market.ticker24` event (or ticker-shaped record).
     * @returns {boolean} true when stored, false when rejected as stale.
     */
    apply(t) {
      if (!t || typeof t !== 'object') throw new Error('ticker24Store: ticker required')
      const symbol = String(t.symbol || '')
      if (!symbol) throw new Error('ticker24Store: symbol required')
      const eventTime = Number(t.eventTime)
      if (!Number.isFinite(eventTime)) throw new Error('ticker24Store: eventTime required')

      const prev = rows.get(symbol)
      if (prev && eventTime < prev.eventTime) {
        stats.stale++
        return false
      }
      const num = (v, fallback) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      const row = {
        symbol,
        market: t.market ?? prev?.market ?? market ?? 'futures',
        source: t.source ?? prev?.source ?? 'unknown',
        eventTime,
        ingestTime: Number.isFinite(Number(t.ingestTime)) ? Number(t.ingestTime) : prev?.ingestTime,
        lastPrice: num(t.lastPrice, prev?.lastPrice),
        openPrice: num(t.openPrice, prev?.openPrice),
        highPrice: num(t.highPrice, prev?.highPrice),
        lowPrice: num(t.lowPrice, prev?.lowPrice),
        baseVolume: num(t.baseVolume, prev?.baseVolume),
        quoteVolume: num(t.quoteVolume, prev?.quoteVolume),
        priceChange: num(t.priceChange, prev?.priceChange),
        priceChangePercent: num(t.priceChangePercent, prev?.priceChangePercent),
        trades: num(t.trades, prev?.trades)
      }
      rows.set(symbol, row)
      stats.accepted++
      return true
    },

    /** Latest row for a symbol, or null. */
    get: (symbol) => (rows.has(symbol) ? { ...rows.get(symbol) } : null),
    /** All rows sorted by symbol (stable for UI/tests). */
    all: () => [...rows.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((r) => ({ ...r })),
    size: () => rows.size,
    stats: () => ({ ...stats })
  }
}
