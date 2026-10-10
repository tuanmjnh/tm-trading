// =============================================================================
//  TM TRADING — SIMULATION ENGINE (roadmap Phase 7P), PURE core.
//
//  The position/order STATE MACHINE of the paper broker: given a fill (from
//  simulation/fill.mjs) or an exit decision, what does the position become?
//  No IO, no clock — every transition is a pure function, golden-tested in
//  simulation/test.mjs.
//
//  Phase 7P transitions covered here:
//    openFromFill     first fill -> position document (fees recorded, NEVER
//                     left null on a modelled fill — null stays "unknown" for
//                     legacy docs only)
//    applyFill        subsequent (partial) fills merge by weighted average
//                     entry price; fees accumulate
//    modify           SL / TP ladder changes, validated fail-closed against
//                     the same side rules the risk gate enforces
//    partialCloseQty  how much of the qty a partial close may take (pct/abs)
//    partialCloseFill price a partial (or full) manual close: pro-rata entry
//                     fee split + closeFill on the slice, so the realized part
//                     and the running remainder stay fee-consistent
//    closeFill        price an EXIT through the fill model: SL fills pay
//                     taker slippage (gaps already fill at the worse bar open,
//                     this makes them worse still — conservative), TP fills
//                     land exactly on the level with maker fees
//    markUnrealized   live mark for the account/equity view
//    tpPortion        multiple-TP ladder -> qty per level (default: full at
//                     every level, i.e. legacy close-all-at-first-touch; a
//                     tpPcts array splits it)
//
//  D7: every OPEN reaching this engine was already approved by the risk gate
//  (exec/risk.mjs) — the engine never sizes or authorizes anything.
// =============================================================================

import { attemptFill, FILL_DEFAULTS, normalizeQuote } from './fill.mjs'

const round8 = (n) => Math.round(n * 1e8) / 1e8

const reject = (code, message) => ({ ok: false, code, message })

/**
 * First fill -> position-shaped doc. Fees start as the fill's fee (0 is a
 * MEASURED zero here — the model computed it), never null.
 * @param {object} fill   result of attemptFill (status filled|partial)
 * @param {object} meta    { account, symbol, dir, sl, tps, tf, alertKey, orderType, slippageBps, latencyMs }
 */
export function openFromFill(fill, meta) {
  if (!fill || (fill.status !== 'filled' && fill.status !== 'partial')) {
    throw new Error(`openFromFill: fill must be filled/partial (got ${fill?.status})`)
  }
  if (!(fill.filledQty > 0) || !(fill.price > 0)) throw new Error('openFromFill: fill needs filledQty > 0 and price > 0')
  return {
    account: meta.account,
    source: meta.source ?? 'paper',
    symbol: meta.symbol,
    dir: meta.dir,
    qty: fill.filledQty,
    entryPrice: fill.price,
    sl: meta.sl ?? null,
    tps: Array.isArray(meta.tps) ? [...meta.tps] : [],
    status: 'open',
    fees: fill.fee,
    orderType: meta.orderType ?? 'market',
    slippageBps: fill.slippageBps ?? null,
    tf: meta.tf ?? null,
    alertKey: meta.alertKey ?? null,
  }
}

/**
 * A later (partial) fill merges into an EXISTING position: weighted average
 * entry, fees accumulate, qty grows. Pure — returns a NEW position object.
 */
export function applyFill(pos, fill) {
  if (!pos || pos.status !== 'open') throw new Error('applyFill: position must be open')
  if (!fill || (fill.status !== 'filled' && fill.status !== 'partial')) throw new Error(`applyFill: bad fill status ${fill?.status}`)
  const qty = round8(pos.qty + fill.filledQty)
  if (!(qty > 0)) throw new Error('applyFill: qty would not grow')
  const entryPrice = (pos.entryPrice * pos.qty + fill.price * fill.filledQty) / qty
  return {
    ...pos,
    qty,
    entryPrice: round8(entryPrice),
    fees: round8((Number(pos.fees) || 0) + fill.fee),
  }
}

/**
 * Validate a SL/TP modification against the position's side — the SAME
 * invariants the risk gate enforces at entry (fail closed, index named).
 * @param {object} pos  { dir, entryPrice }
 * @param {object} patch { sl?, tps? }  tps undefined = keep current
 */
export function validateModify(pos, patch = {}) {
  const dir = pos?.dir === 1 || pos?.dir === -1 ? pos.dir : NaN
  if (dir !== 1 && dir !== -1) return reject('BAD_DIR', 'position dir must be 1 or -1')
  const entry = Number(pos?.entryPrice)
  if (!(Number.isFinite(entry) && entry > 0)) return reject('BAD_ENTRY', 'position entryPrice must be > 0')

  let sl = pos.sl ?? null
  if (patch.sl !== undefined) {
    const n = Number(patch.sl)
    if (!(Number.isFinite(n) && n > 0)) return reject('BAD_SL', `sl must be a positive number (got ${String(patch.sl)})`)
    if ((dir === 1 && n >= entry) || (dir === -1 && n <= entry)) {
      return reject('BAD_SL', `SL ${n} on wrong side of entry ${entry} (dir=${dir})`)
    }
    sl = n
  }

  let tps = Array.isArray(pos.tps) ? [...pos.tps] : []
  if (patch.tps !== undefined) {
    if (!Array.isArray(patch.tps) || patch.tps.length === 0) return reject('BAD_TPS', 'tps must be a non-empty array')
    const out = []
    for (let i = 0; i < patch.tps.length; i++) {
      const n = Number(patch.tps[i])
      if (!(Number.isFinite(n) && n > 0)) return reject('BAD_TPS', `tps[${i}] is not a positive finite number (${JSON.stringify(patch.tps[i])})`)
      if ((dir === 1 && n <= entry) || (dir === -1 && n >= entry)) {
        return reject('BAD_TPS', `TP ${n} on wrong side of entry ${entry} (dir=${dir})`)
      }
      out.push(n)
    }
    tps = out
  }
  if (patch.sl === undefined && patch.tps === undefined) return reject('EMPTY_PATCH', 'nothing to modify (sl/tps both absent)')
  return { ok: true, sl, tps }
}

/** Apply a VALIDATED modification. Throws on invalid input (fail closed). */
export function modifyPosition(pos, patch) {
  const v = validateModify(pos, patch)
  if (!v.ok) throw new Error(`modifyPosition: ${v.code} — ${v.message}`)
  return { ...pos, sl: v.sl, tps: v.tps }
}

/**
 * How much of the position a partial close may take.
 * @param {object} pos     { qty }
 * @param {object} target  { qty? | pct? }  pct = 0..100 of current qty
 * @returns {{ok:true, qty} | {ok:false, code, message}}
 */
export function partialCloseQty(pos, target = {}) {
  const cur = Number(pos?.qty)
  if (!(Number.isFinite(cur) && cur > 0)) return reject('BAD_QTY', `position qty must be > 0 (got ${String(pos?.qty)})`)
  if (target.qty !== undefined && target.pct !== undefined) return reject('AMBIGUOUS', 'pass qty OR pct, not both')
  let q
  if (target.qty !== undefined) {
    q = Number(target.qty)
    if (!(Number.isFinite(q) && q > 0)) return reject('BAD_QTY', `close qty must be > 0 (got ${String(target.qty)})`)
    if (q > cur + 1e-12) return reject('TOO_LARGE', `close qty ${q} > position qty ${cur}`)
  } else if (target.pct !== undefined) {
    const pct = Number(target.pct)
    if (!(Number.isFinite(pct) && pct > 0 && pct <= 100)) return reject('BAD_PCT', `pct must be in (0, 100] (got ${String(target.pct)})`)
    q = (cur * pct) / 100
  } else {
    return reject('MISSING', 'partial close needs qty or pct')
  }
  q = round8(q)
  if (!(q > 0)) return reject('BAD_QTY', 'rounded close qty is zero')
  if (q > cur) q = cur // rounding may land a hair above — clamp to full close
  return { ok: true, qty: q }
}

/**
 * Price a MANUAL partial (or full) close — the realization half of a partial:
 * which slice leaves, what that slice nets after its pro-rata share of the
 * entry fees, and what the running remainder keeps.
 *
 * Fee split is pro-rata on qty, and BOTH sides are computed from the SAME
 * `feeShare` number, so `feeShare + remainingFees` sums back to the position's
 * original `fees` (no dust is created or destroyed). A legacy position whose
 * entry fee is unknown (null) stays unknown: `feeShare`/`remainingFees` are
 * null and the slice is priced gross-of-entry-fee — exactly what closeFill
 * already does for a full close of such a position, and `fees: null` on the
 * written docs keeps the "never claimed as measured" contract.
 *
 * `isFull` is true when the slice takes the whole qty (pct=100 / qty=cur):
 * the caller then closes the ORIGINAL document instead of forking a child.
 * `qty` is 8-dp (round8 — same precision the position qtys are stored at), so
 * a 100% request on a real position lands exactly on `cur`.
 *
 * @param {object} pos     { dir, qty, entryPrice, fees } (open)
 * @param {object} target  { qty? | pct? } — same contract as partialCloseQty
 * @param {object} exit    { kind:'sl'|'tp'|'market', price } — decided event
 *                         ('market' = taker, see closeFill)
 * @param {object} [model] FILL_DEFAULTS overrides
 * @returns {{ok:true, qty, remainingQty, isFull, feeShare, remainingFees, fill}
 *          |{ok:false, code, message}}
 */
export function partialCloseFill(pos, target, exit, model = FILL_DEFAULTS) {
  if (!pos || pos.status !== 'open') return reject('NOT_OPEN', 'position must be open')
  const q = partialCloseQty(pos, target)
  if (!q.ok) return q
  const cur = Number(pos.qty)
  const known = pos.fees !== null && pos.fees !== undefined && Number.isFinite(Number(pos.fees))
  const feeShare = known ? (Number(pos.fees) * q.qty) / cur : null
  const fill = closeFill({ ...pos, qty: q.qty, fees: feeShare }, exit, model)
  if (!fill.ok) return fill
  return {
    ok: true,
    qty: q.qty,
    remainingQty: round8(cur - q.qty),
    isFull: q.qty >= cur,
    feeShare,
    remainingFees: known ? round8(Number(pos.fees) - feeShare) : null,
    fill,
  }
}

/**
 * Build the EXIT order for a position (the mirror of its entry) so exits flow
 * through the SAME fill model: SL = market order in the exit direction,
 * TP = limit order resting at the level (maker role).
 */
export function exitOrderFor(pos, kind) {
  const side = pos.dir === 1 ? 'SELL' : 'BUY'
  if (kind === 'tp') return { type: 'limit', side, qty: pos.qty, price: Number(pos.tps?.[0] ?? NaN), role: 'maker' }
  return { type: 'market', side, qty: pos.qty, role: 'taker' }
}

/**
 * Price an EXIT decision through the fill model.
 *
 * `decidedPrice` is the level the exit PATH decided (bar scan / follow-up
 * alert): TP levels fill EXACTLY there (maker), SL fills pay taker slippage
 * on top (gaps already got the worse bar open from findFirstExit). The quote
 * is optional and only used to express the slippage — exits are driven by
 * observed events, not by top-of-book.
 *
 * @param {object} pos       { dir, qty, entryPrice, fees }
 * @param {object} exit      { kind:'sl'|'tp'|'market', price, quote? } —
 *                            'market' (manual close) is a TAKER event like
 *                            'sl': slippage + taker fee, never a free exit
 * @param {object} [model]   FILL_DEFAULTS overrides
 * @returns {{ok:true, kind, exitPrice, fee, slippageBps, gross, feesTotal, net, pnlAbs, pnlPct}
 *          |{ok:false, code, message}}
 */
export function closeFill(pos, exit, model = FILL_DEFAULTS) {
  const dir = pos?.dir === 1 || pos?.dir === -1 ? pos.dir : NaN
  if (dir !== 1 && dir !== -1) return reject('BAD_DIR', 'position dir must be 1 or -1')
  const qty = Number(pos?.qty)
  const entry = Number(pos?.entryPrice)
  const decided = Number(exit?.price)
  if (!(Number.isFinite(qty) && qty > 0)) return reject('BAD_QTY', 'position qty must be > 0')
  if (!(Number.isFinite(entry) && entry > 0)) return reject('BAD_ENTRY', 'entryPrice must be > 0')
  if (!(Number.isFinite(decided) && decided > 0)) return reject('BAD_PRICE', `exit price must be > 0 (got ${String(exit?.price)})`)

  const m = { ...FILL_DEFAULTS, ...model }
  const kind = exit?.kind === 'tp' ? 'tp' : 'sl'
  const role = kind === 'tp' ? 'maker' : 'taker'
  const exitSideDir = -dir // long exits sell, short exits buy
  // SL pays slippage in the exit direction; TP lands exactly on the level.
  const slipBps = kind === 'sl' ? m.slippageBps : 0
  const exitPrice = round8(decided * (1 + exitSideDir * (slipBps / 1e4)))
  const notional = exitPrice * qty
  const fee = round8((notional * (role === 'maker' ? m.makerFeeBps : m.takerFeeBps)) / 1e4)

  const gross = dir * (exitPrice - entry) * qty
  const openFees = Number(pos.fees) || 0
  const net = gross - openFees - fee
  const pnlPct = entry * qty > 0 ? (net / (entry * qty)) * 100 : 0

  return {
    ok: true,
    kind,
    exitPrice,
    fee,
    slippageBps: slipBps,
    gross: round8(gross),
    feesTotal: round8(openFees + fee),
    net: round8(net),
    pnlAbs: round8(net),
    pnlPct,
  }
}

/**
 * Multiple TP ladder -> qty to close at level `index` (0-based).
 * - no tpPcts            -> legacy behaviour: EVERY level closes the FULL
 *                           remaining position (first touch wins);
 * - tpPcts (e.g. [50,30,20]) -> that share of the position's ORIGINAL qty at
 *                           each level; the last level always takes whatever
 *                           is left so rounding never strands dust.
 * @returns {{ok:true, qty} | {ok:false, code, message}}
 */
export function tpPortion(pos, index, tpPcts = null) {
  const qty = Number(pos?.qty)
  if (!(Number.isFinite(qty) && qty > 0)) return reject('BAD_QTY', 'position qty must be > 0')
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0) return reject('BAD_INDEX', `tp index must be a non-negative integer (got ${String(index)})`)
  if (!Array.isArray(pos.tps) || i >= pos.tps.length) return reject('NO_TP', `position has no tps[${i}]`)
  if (tpPcts === null || tpPcts === undefined) return { ok: true, qty: round8(qty) }
  if (!Array.isArray(tpPcts) || tpPcts.length !== pos.tps.length) {
    return reject('BAD_PCTS', 'tpPcts must align 1:1 with tps')
  }
  const pct = Number(tpPcts[i])
  if (!(Number.isFinite(pct) && pct > 0 && pct <= 100)) return reject('BAD_PCT', `tpPcts[${i}] must be in (0, 100]`)
  const isLast = i === pos.tps.length - 1
  if (isLast) return { ok: true, qty: round8(qty) } // last level takes the remainder
  const q = Math.min(round8((qty * pct) / 100), qty)
  if (!(q > 0)) return reject('BAD_QTY', 'portion rounds to zero')
  return { ok: true, qty: q }
}

/**
 * Live mark of an OPEN position for the account/equity view.
 * Marks at the EXIT side of the quote (long sells at bid, short buys at ask)
 * and nets the already-paid entry fees — an unrealized number you could
 * actually realize today.
 */
export function markUnrealized(pos, quote, model = FILL_DEFAULTS) {
  if (!pos || pos.status !== 'open') return { ok: false, code: 'NOT_OPEN', message: 'position is not open' }
  const dir = pos.dir === 1 || pos.dir === -1 ? pos.dir : NaN
  if (dir !== 1 && dir !== -1) return { ok: false, code: 'BAD_DIR', message: 'position dir must be 1 or -1' }
  const m = { ...FILL_DEFAULTS, ...model }
  const q = normalizeQuote(quote, m)
  if (!q) return { ok: false, code: 'NO_QUOTE', message: 'quote has no usable price' }
  const qty = Number(pos.qty)
  const entry = Number(pos.entryPrice)
  if (!(qty > 0) || !(entry > 0)) return { ok: false, code: 'BAD_POS', message: 'position qty/entry not usable' }

  const mark = dir === 1 ? q.bid : q.ask // exit side of the book
  const gross = dir * (mark - entry) * qty
  const net = gross - (Number(pos.fees) || 0)
  return {
    ok: true,
    markPrice: mark,
    gross: round8(gross),
    net: round8(net),
    pnlPct: entry * qty > 0 ? (net / (entry * qty)) * 100 : 0,
  }
}

// Convenience: one call from a position + a raw quote for the UI's "state
// realtime" view (roadmap Phase 7P: position state realtime).
export function positionState(pos, quote, model = FILL_DEFAULTS) {
  const mark = markUnrealized(pos, quote, model)
  return {
    symbol: pos.symbol,
    dir: pos.dir,
    qty: pos.qty,
    entryPrice: pos.entryPrice,
    sl: pos.sl ?? null,
    tps: pos.tps ?? [],
    fees: Number(pos.fees) || 0,
    status: pos.status,
    ...(mark.ok ? { unrealized: mark.net, markPrice: mark.markPrice, unrealizedPct: mark.pnlPct } : { unrealized: null }),
  }
}

// attemptFill is re-exported so callers (exec/paper.mjs) can import the whole
// engine surface from one module when composing fills + transitions.
export { attemptFill }
