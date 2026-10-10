// =============================================================================
//  TM TRADING — PAPER FILL MODEL (roadmap Phase 7P), PURE core.
//
//  Answers ONE question honestly: at what price/qty/fee does a paper order
//  actually fill against the REAL market — never at a phantom signal price.
//  No IO, no clock of its own: every input (quote, now) is passed in, so the
//  whole model is golden-testable (simulation/test.mjs).
//
//  What it models (Phase 7P feature list):
//    spread      — BUY fills at the ASK, SELL at the BID (never at mid);
//    slippage    — taker slippage in the trade direction (model.slippageBps);
//    latency     — the quote's age adds adverse slip
//                  (ageSec * model.latencySlipPerSecBps): the older the data
//                  we fill on, the worse we assume the market moved against us;
//                  quotes older than model.maxQuoteAgeMs are refused as STALE
//                  instead of being filled against dead prices;
//    partial     — when the quote carries top-of-book size, an order larger
//                  than the available side fills only what exists now
//                  (status 'partial' + remainderQty for the caller to retry);
//    fees        — taker/maker bps on the filled notional, role decided by
//                  the caller (market/stop = taker, resting TP = maker).
//
//  Order types:
//    market  — fills immediately against the opposite side of the quote;
//    limit   — fills only when the market is AT OR THROUGH the level
//              (marketable limit, at the better of limit/market price);
//              otherwise 'working' — the caller keeps the intent alive for a
//              later quote (paper: the alert stays 'received');
//    stop    — triggers when the market reaches the level, then fills like a
//              market order AT THE CURRENT price (gaps fill at the worse
//              current price, never at the stop level).
//
//  D7 note: this model NEVER decides to trade. The risk gate (exec/risk.mjs)
//  approves quantity first; this only prices what the gate allowed.
// =============================================================================

export const FILL_DEFAULTS = Object.freeze({
  spreadBps: 1, // fallback spread when the quote has no bid/ask (0.01% of mid)
  slippageBps: 2, // taker slippage in the trade direction
  latencySlipPerSecBps: 0.5, // adverse slip per second of quote age
  takerFeeBps: 4, // 0.04% of notional (Binance futures taker)
  makerFeeBps: 1, // 0.01% of notional (Binance futures maker)
  maxQuoteAgeMs: 15_000, // quotes older than this are 'stale', not filled
})

const ENV_MAP = Object.freeze({
  SIM_SPREAD_BPS: ['spreadBps', Number],
  SIM_SLIPPAGE_BPS: ['slippageBps', Number],
  SIM_LATENCY_SLIP_BPS: ['latencySlipPerSecBps', Number],
  SIM_TAKER_FEE_BPS: ['takerFeeBps', Number],
  SIM_MAKER_FEE_BPS: ['makerFeeBps', Number],
  SIM_MAX_QUOTE_AGE_MS: ['maxQuoteAgeMs', Number],
})

/** Defaults <- env. Invalid numbers keep the default (never crash the model). */
export function loadFillConfig(env = process.env) {
  const cfg = { ...FILL_DEFAULTS }
  for (const [key, [field, type]] of Object.entries(ENV_MAP)) {
    const raw = env[key]
    if (raw === undefined || raw === '') continue
    if (type === Number) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) cfg[field] = n
    }
  }
  return cfg
}

const ORDER_TYPES = Object.freeze(['market', 'limit', 'stop'])
export { ORDER_TYPES }

/**
 * Normalize any quote shape into { bid, ask, bidQty, askQty, time }.
 * Accepts a full bookTicker ({bid, ask, bidQty, askQty}) or a bare last price
 * ({ last } / number) — the fallback derives a spread from model.spreadBps so
 * BUY still never fills at mid.
 */
export function normalizeQuote(quote, model = FILL_DEFAULTS) {
  const q = typeof quote === 'number' ? { last: quote } : quote || {}
  const last = Number(q.last ?? q.close ?? q.price)
  if (Number.isFinite(last) && last > 0) {
    if (!Number.isFinite(Number(q.bid)) || !Number.isFinite(Number(q.ask))) {
      const half = (last * (Number(model.spreadBps) || 0)) / 1e4 / 2
      return { bid: last - half, ask: last + half, bidQty: numOrNull(q.bidQty), askQty: numOrNull(q.askQty), time: numOrNull(q.time) }
    }
  }
  const bid = Number(q.bid)
  const ask = Number(q.ask)
  if (!(Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0)) return null
  return { bid, ask, bidQty: numOrNull(q.bidQty), askQty: numOrNull(q.askQty), time: numOrNull(q.time) }
}

const numOrNull = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const round8 = (n) => Math.round(n * 1e8) / 1e8

/**
 * Attempt one fill against `quote`. PURE.
 *
 * @param {object} order  { type:'market'|'limit'|'stop', side:'BUY'|'SELL',
 *                          qty, price? }  price = limit level / stop trigger
 * @param {object|number} quote  { bid, ask, bidQty?, askQty?, time? } or { last } or number
 * @param {object} [model] FILL_DEFAULTS overrides
 * @param {number} now    epoch ms (caller's clock — D2 UTC epoch)
 * @param {object} [opts] { role: 'taker'|'maker' } fee role (default taker)
 * @returns {{status:'filled'|'partial'|'working'|'stale'|'rejected',
 *            filledQty:number, remainderQty:number, price:number|null,
 *            fee:number, feeRateBps:number, slippageBps:number,
 *            latencyMs:number, eventTime:number,
 *            marketable:boolean, reason?:string}}
 */
export function attemptFill(order, quote, model = FILL_DEFAULTS, now = Date.now(), opts = {}) {
  const base = {
    status: 'rejected', filledQty: 0, remainderQty: 0, price: null,
    fee: 0, feeRateBps: 0, slippageBps: 0, latencyMs: 0, eventTime: now,
    marketable: false,
  }
  const type = String(order?.type || 'market')
  const side = String(order?.side || '')
  const qty = Number(order?.qty)
  const dir = side === 'BUY' ? 1 : side === 'SELL' ? -1 : NaN

  if (!ORDER_TYPES.includes(type)) return { ...base, reason: `unknown order type ${type}` }
  if (dir !== 1 && dir !== -1) return { ...base, reason: 'side must be BUY or SELL' }
  if (!(qty > 0) || !Number.isFinite(qty)) return { ...base, reason: `qty must be > 0 (got ${order?.qty})` }
  if (type !== 'market') {
    const lvl = Number(order?.price)
    if (!(Number.isFinite(lvl) && lvl > 0)) return { ...base, reason: `${type} order needs a positive price level` }
  }

  const m = { ...FILL_DEFAULTS, ...model }
  const nq = normalizeQuote(quote, m)
  if (!nq) return { ...base, reason: 'quote has no usable bid/ask/last' }

  // --- latency: dead quotes are refused, live ones pay age-based adverse slip
  const ageMs = Number.isFinite(nq.time) && nq.time > 0 ? Math.max(0, now - nq.time) : 0
  if (ageMs > m.maxQuoteAgeMs) {
    return { ...base, status: 'stale', latencyMs: ageMs, reason: `quote age ${Math.round(ageMs)}ms > max ${m.maxQuoteAgeMs}ms` }
  }
  const ageSec = ageMs / 1000
  const slipBps = m.slippageBps + ageSec * m.latencySlipPerSecBps

  // --- does the order fill at all on this quote?
  let refPrice
  let marketable = true
  const level = type === 'market' ? null : Number(order.price)
  if (type === 'market') {
    refPrice = dir === 1 ? nq.ask : nq.bid
  } else if (type === 'limit') {
    if (dir === 1) {
      if (nq.ask <= level) refPrice = Math.min(nq.ask, level) // marketable: fill at the better price
      else return { ...base, status: 'working', reason: `ask ${nq.ask} > limit ${level}` }
    } else {
      if (nq.bid >= level) refPrice = Math.max(nq.bid, level)
      else return { ...base, status: 'working', reason: `bid ${nq.bid} < limit ${level}` }
    }
  } else {
    // stop: trigger, then fill like a market order at the CURRENT price —
    // a gapped market fills worse than the stop level, never better.
    const triggered = dir === 1 ? nq.ask >= level : nq.bid <= level
    if (!triggered) return { ...base, status: 'working', reason: `stop ${level} not reached (ref ${dir === 1 ? nq.ask : nq.bid})` }
    refPrice = dir === 1 ? nq.ask : nq.bid
  }

  // --- slippage in the trade direction (adverse for both sides)
  const price = round8(refPrice * (1 + dir * (slipBps / 1e4)))

  // --- partial fills: only the displayed size on our side is available now
  const available = dir === 1 ? nq.askQty : nq.bidQty
  let fillQty = qty
  if (Number.isFinite(available) && available > 0 && qty > available) fillQty = available
  fillQty = Math.min(round8(fillQty), qty) // never round UP past the order
  if (!(fillQty > 0)) return { ...base, status: 'partial', reason: 'no displayed liquidity on our side' }

  const notional = price * fillQty
  const feeRateBps = opts.role === 'maker' ? m.makerFeeBps : m.takerFeeBps
  const fee = round8((notional * feeRateBps) / 1e4)
  const partial = fillQty < qty - 1e-12

  return {
    status: partial ? 'partial' : 'filled',
    filledQty: fillQty,
    remainderQty: partial ? round8(qty - fillQty) : 0,
    price,
    fee,
    feeRateBps,
    slippageBps: slipBps,
    latencyMs: ageMs,
    eventTime: now,
    marketable,
    ...(partial ? { reason: `only ${fillQty} of ${qty} available at top of book` } : {}),
  }
}
