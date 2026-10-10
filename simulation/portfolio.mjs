// =============================================================================
//  TM TRADING — SIMULATION PORTFOLIO (roadmap Phase 7P: account/equity), PURE.
//
//  Aggregates positions into the numbers an account view needs:
//    equity    = base + realized (closed, fee-net) + unrealized (open, marked
//                to the exit side of the quote, entry fees netted) — i.e. what
//                the account would be worth if everything flattened NOW;
//    realized  = sum of closed pnlAbs (already net of round-trip fees —
//                simulation/engine.mjs closeFill does the netting);
//    fees      = measured fees across closed + open (nulls from legacy docs
//                are "unknown" and count as 0 here, but never relabelled);
//    exposure  = sum of |qty * entryPrice| per symbol (the gate's D7 view);
//    marginUsed = sum of initial margin locked by OPEN positions (margin model),
//    freeMargin = equity - marginUsed.
//
//  No IO, no clock: quotes are passed in per symbol. Golden-tested in
//  simulation/test.mjs.
// =============================================================================

import { markUnrealized } from './engine.mjs'
import { FILL_DEFAULTS } from './fill.mjs'
import { MARGIN_DEFAULTS, initialMarginFor } from './margin.mjs'

const round8 = (n) => Math.round(n * 1e8) / 1e8

/**
 * Account summary from raw position docs + a quote lookup.
 *
 * @param {object} args
 * @param {number} args.base           starting/config equity (risk config equity)
 * @param {object[]} args.positions    ALL positions of the account (open + closed)
 * @param {Map<string,object>|function} [args.quotes] symbol -> quote (or fn)
 * @param {object} [args.model]        FILL_DEFAULTS overrides
 * @param {object} [args.marginModel]  MARGIN_DEFAULTS overrides
 * @returns {{equity, realized, unrealized, fees, openCount, closedCount,
 *            winRate, exposure, marginUsed, freeMargin, bySymbol}}
 */
export function accountSummary({ base, positions = [], quotes = null, model = FILL_DEFAULTS, marginModel = MARGIN_DEFAULTS }) {
  const quoteFor = typeof quotes === 'function' ? quotes : quotes instanceof Map ? (s) => quotes.get(s) : () => null

  let realized = 0
  let feesClosed = 0
  let feesOpen = 0
  let wins = 0
  let losses = 0
  let unrealized = 0
  let openCount = 0
  let closedCount = 0
  let marginUsed = 0
  const bySymbol = new Map()

  for (const p of positions) {
    const fees = Number(p?.fees) // null = unknown legacy — counts as 0, stays unknown in the doc
    if (p.status === 'closed') {
      closedCount++
      realized += Number(p.pnlAbs) || 0
      if (Number.isFinite(fees)) feesClosed += fees
      if (Number.isFinite(p.pnlAbs)) {
        if (p.pnlAbs > 0) wins++
        else if (p.pnlAbs < 0) losses++
      }
    } else if (p.status === 'open') {
      openCount++
      if (Number.isFinite(fees)) feesOpen += fees
      const notional = Math.abs((Number(p.qty) || 0) * (Number(p.entryPrice) || 0))
      bySymbol.set(p.symbol, round8((bySymbol.get(p.symbol) || 0) + notional))
      const im = initialMarginFor(p, marginModel)
      if (im !== null) marginUsed += im
      const mark = markUnrealized(p, quoteFor(p.symbol), model)
      if (mark.ok) unrealized += mark.net
    }
  }

  const equity = round8((Number(base) || 0) + realized + unrealized)
  marginUsed = round8(marginUsed)
  const closedTotal = wins + losses
  return {
    equity,
    base: Number(base) || 0,
    realized: round8(realized),
    unrealized: round8(unrealized),
    fees: round8(feesClosed + feesOpen),
    openCount,
    closedCount,
    winRate: closedTotal > 0 ? wins / closedTotal : null,
    wins,
    losses,
    exposure: round8([...bySymbol.values()].reduce((s, v) => s + v, 0)),
    marginUsed,
    freeMargin: round8(equity - marginUsed),
    bySymbol: Object.fromEntries(bySymbol),
  }
}

/**
 * Day realized PnL from closed positions (UTC day, D2) — the same grouping
 * the risk gate counts, computed here for the account view without Mongo.
 * @param {object[]} closed
 * @param {string} utcDay 'YYYY-MM-DD'
 */
export function dayRealized(closed, utcDay) {
  const day = String(utcDay)
  let pnl = 0
  let n = 0
  for (const p of closed) {
    const t = p?.exitTime ? new Date(p.exitTime) : null
    if (!t || Number.isNaN(+t)) continue
    if (t.toISOString().slice(0, 10) !== day) continue
    pnl += Number(p.pnlAbs) || 0
    n++
  }
  return { pnl: round8(pnl), trades: n }
}
