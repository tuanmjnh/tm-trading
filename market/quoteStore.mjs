// =============================================================================
//  TM TRADING — in-memory latest-quote store (Phase 7R).
//
//  One row per symbol: last bid/ask/last + eventTime. Stale writes
//  (eventTime < stored eventTime) are rejected and counted — a reconnect
//  replay must never walk the book backwards.
// =============================================================================

/**
 * @param {object} [opts]
 * @param {'spot'|'futures'|'gold'} [opts.market] force a market stamp on rows
 */
export function createQuoteStore({ market } = {}) {
  const rows = new Map() // symbol -> row
  const stats = { accepted: 0, stale: 0 }

  return {
    /**
     * Apply a `market.quote` event (or quote-shaped record).
     * @returns {boolean} true when stored, false when rejected as stale.
     */
    apply(q) {
      if (!q || typeof q !== 'object') throw new Error('quoteStore: quote required')
      const symbol = String(q.symbol || '')
      if (!symbol) throw new Error('quoteStore: symbol required')
      const eventTime = Number(q.eventTime)
      if (!Number.isFinite(eventTime)) throw new Error('quoteStore: eventTime required')

      const prev = rows.get(symbol)
      if (prev && eventTime < prev.eventTime) {
        stats.stale++
        return false
      }
      const row = {
        symbol,
        market: q.market ?? prev?.market ?? market ?? 'futures',
        source: q.source ?? prev?.source ?? 'unknown',
        eventTime,
        ingestTime: Number.isFinite(Number(q.ingestTime)) ? Number(q.ingestTime) : prev?.ingestTime
      }
      if (q.bid !== undefined && q.bid !== null) row.bid = Number(q.bid)
      else if (prev && prev.bid !== undefined) row.bid = prev.bid
      if (q.ask !== undefined && q.ask !== null) row.ask = Number(q.ask)
      else if (prev && prev.ask !== undefined) row.ask = prev.ask
      if (q.last !== undefined && q.last !== null) row.last = Number(q.last)
      else if (prev && prev.last !== undefined) row.last = prev.last
      if (q.updateId !== undefined && q.updateId !== null) row.updateId = Number(q.updateId)

      if (row.bid !== undefined && row.ask !== undefined && row.bid > row.ask) {
        throw new Error(`quoteStore: crossed quote for ${symbol} (bid ${row.bid} > ask ${row.ask})`)
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
