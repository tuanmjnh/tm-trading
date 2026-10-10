// =============================================================================
//  TM TRADING — SIMULATION LIQUIDATION MODEL (roadmap v3 §17.1 liquidation.mjs),
//  PURE.
//
//  When isolated margin for a position has been eaten down to the maintenance
//  floor, the exchange liquidates. This gives the paper account the SAME rule:
//
//    LONG  liqPrice = entry * (1 - (initialMarginPct - maintenanceMarginPct) / 100)
//    SHORT liqPrice = entry * (1 + (initialMarginPct - maintenanceMarginPct) / 100)
//
//  (losses tolerated per unit = entry * (initialMarginPct - mmrPct)/100).
//  A forced exit is a TAKER event in the exit direction: the fill lands at the
//  WORSE of the triggering liq level and the observed mark (a gap below/above
//  the level fills at the even worse current price) and then pays the same
//  slippage + taker fee the engine's 'sl' path applies — conservative by design.
//
//  No IO, no clock. Quotes (or bare prices) are passed in; everything is
//  golden-testable. Like the rest of the core, this never decides to TRADE —
//  it only prices the liquidation an observed mark demands.
// =============================================================================

import { MARGIN_DEFAULTS } from './margin.mjs'
import { normalizeQuote } from './fill.mjs'
import { closeFill } from './engine.mjs'

const round8 = (n) => Math.round(n * 1e8) / 1e8

const reject = (code, message) => ({ ok: false, code, message })

/**
 * Liquidation price of a position under isolated margin.
 * @param {object} pos   { dir: 1|-1, qty, entryPrice } (open)
 * @param {object} [model] MARGIN_DEFAULTS overrides
 * @returns {{ok:true, liqPrice, marginUsed, maintenanceMargin, distancePctTo}
 *          |{ok:false, code, message}}
 */
export function liquidationPrice(pos, model = MARGIN_DEFAULTS) {
  const dir = pos?.dir === 1 || pos?.dir === -1 ? pos.dir : NaN
  if (dir !== 1 && dir !== -1) return reject('BAD_DIR', 'position dir must be 1 or -1')
  const entry = Number(pos?.entryPrice)
  const qty = Number(pos?.qty)
  if (!(Number.isFinite(entry) && entry > 0)) return reject('BAD_ENTRY', 'position entryPrice must be > 0')
  if (!(Number.isFinite(qty) && qty > 0)) return reject('BAD_QTY', 'position qty must be > 0')

  const m = { ...MARGIN_DEFAULTS, ...model }
  const spread = (Number(m.initialMarginPct) - Number(m.maintenanceMarginPct)) / 100
  const liqPrice = round8(entry * (1 - dir * spread)) // LONG below, SHORT above
  const notional = round8(qty * entry)

  return {
    ok: true,
    liqPrice,
    marginUsed: round8((notional * m.initialMarginPct) / 100),
    maintenanceMargin: round8((notional * m.maintenanceMarginPct) / 100),
    /** % move from a given price to the liq level (positive = safe side). */
    distancePctTo(price) {
      const p = Number(price)
      if (!(Number.isFinite(p) && p > 0)) return null
      return round8(((p - liqPrice) / liqPrice) * 100)
    },
  }
}

/**
 * Is a position liquidated at an observed quote / mark? Accepts the same quote
 * shapes as the fill model ({bid,ask}|{last}|number via normalizeQuote).
 * @param {object} pos   { dir, qty, entryPrice }
 * @param {object} quote two-sided quote, bare {last}, or a number
 * @param {object} [model] MARGIN_DEFAULTS overrides
 * @returns {{ok:true, liquidated:boolean, liqPrice, markPrice} |{ok:false, code, message}}
 */
export function checkLiquidation(pos, quote, model = MARGIN_DEFAULTS) {
  const lp = liquidationPrice(pos, model)
  if (!lp.ok) return lp

  const mark = markPrice(quote)
  if (mark === null) return reject('NO_MARK', 'quote has no usable price')

  const longer = pos.dir === 1
  return {
    ok: true,
    liquidated: longer ? mark <= lp.liqPrice : mark >= lp.liqPrice,
    liqPrice: lp.liqPrice,
    markPrice: mark,
  }
}

/** Best-guess mark from any quote shape a caller may pass (number, {last}, {bid,ask}…). */
function markPrice(quote) {
  if (typeof quote === 'number') return Number.isFinite(quote) && quote > 0 ? quote : null
  const last = Number(quote?.last ?? quote?.close ?? quote?.price)
  if (Number.isFinite(last) && last > 0) return last
  const q = normalizeQuote(quote)
  if (q) return round8((q.bid + q.ask) / 2)
  return null
}

/**
 * Price a forced liquidation exit through the SAME engine fill model. The exit
 * is a TAKER event (kind 'sl' path in engine.closeFill: slippage + taker fee).
 * Decided price = the worse of the triggering liq level and the observed mark,
 * so a gapped market never fills "better" than the liq level.
 *
 * @param {object} pos   open position doc ({ dir, qty, entryPrice, fees })
 * @param {object} quote quote/mark the liquidation was detected on
 * @param {object} [marginModel] MARGIN_DEFAULTS overrides
 * @param {object} [fillModel]   FILL_DEFAULTS overrides (engine 'sl' path)
 * @returns {{ok:true, kind:'liquidation', liqPrice, exitPrice, fee, slippageBps,
 *            gross, feesTotal, net, pnlPct} |{ok:false, code, message}}
 */
export function liquidationFill(pos, quote, marginModel = MARGIN_DEFAULTS, fillModel = undefined) {
  const lp = liquidationPrice(pos, marginModel)
  if (!lp.ok) return lp

  const mark = markPrice(quote)
  if (mark === null) return reject('NO_MARK', 'quote has no usable price')

  const longer = pos.dir === 1
  if (!(longer ? mark <= lp.liqPrice : mark >= lp.liqPrice)) {
    return reject('NO_LIQUIDATION', `mark ${mark} has not crossed liqPrice ${lp.liqPrice} (dir=${pos.dir})`)
  }
  // Gapped market fills at the even worse current mark, never better than the level.
  const decided = longer ? Math.min(lp.liqPrice, mark) : Math.max(lp.liqPrice, mark)

  const fill = closeFill(pos, { kind: 'sl', price: decided }, fillModel)
  if (!fill.ok) return fill
  return { ...fill, ok: true, kind: 'liquidation', liqPrice: lp.liqPrice }
}