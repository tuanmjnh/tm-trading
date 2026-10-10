// =============================================================================
//  TM TRADING — simulation/order.mjs — PAPER ORDER STATE MACHINE (§17.2, PURE).
//
//  The order is the FIRST-CLASS unit of paper execution intent. It is created
//  only after the risk gate approves (D7) and records every state the roadmap
//  §17.2 names:
//
//    CREATED → RISK_CHECKED → PENDING → (PARTIALLY_FILLED) → FILLED   (open)
//                              ├──→ CANCELLED
//                              ├──→ EXPIRED
//    (CREATED/RISK_CHECKED/PENDING) → REJECTED   (terminal move, e.g. gate)
//
//  Like every simulation module this file is PURE and dependency-free: no then,
//  no clock, no Mongo. Callers own time (`now`), idempotency (`clientOrderId`,
//  D3) and persistence. A transition returns the NEW order slice or a guarded
//  refusal — the caller persists, never guesses (D21/D25).
// =============================================================================

// §17.2 order states, in storage order of meaning.
export const ORDER_STATES = Object.freeze([
  'created',
  'riskChecked',
  'pending',
  'partiallyFilled',
  'filled',
  'cancelled',
  'expired',
  'rejected',
])

/** P0 order types (fill model + ticket both gate on the same set). */
export const ORDER_TYPES = Object.freeze(['market', 'limit', 'stop'])

/** Terminal states: no further transition may move an order away from these. */
export const TERMINAL = Object.freeze(['filled', 'cancelled', 'expired', 'rejected'])

/** States still able to be cancelled / expire / fill after a quote. */
export const ACTIVE = Object.freeze(['riskChecked', 'pending', 'partiallyFilled'])

export const isActive = (s) => ACTIVE.includes(s)
export const isTerminal = (s) => TERMINAL.includes(s)

/** Version stamp of THIS model contract (D1 — bump when the slice changes). */
export const ORDER_MODEL_VERSION = 'order.v1'

export const cancelReasonIsActive = (s) => (isActive(s) ? null : `order is ${s}`)

/**
 * Build a fresh order from a gate-approved ENTRY intent (D21: the UI NEVER
 * fills — it submits intent; qty comes from the gate decision). Idempotent key
 * `clientOrderId` (D3) is caller-owned; callers upsert on it.
 */
export function createPaperOrder(intent, meta = {}) {
  const now = meta.now ?? Date.now()
  const type = ORDER_TYPES.includes(intent.type) ? intent.type : 'market'
  return {
    orderId: meta.orderId ?? `order_${Math.random().toString(36).slice(2, 10)}`,
    clientOrderId: intent.clientOrderId,
    alertKey: intent.alertKey ?? null,
    accountId: intent.account ?? null,
    source: intent.source ?? 'paper',
    symbol: intent.symbol,
    side: intent.side === 'SELL' ? 'SELL' : 'BUY',
    type,
    qty: intent.qty,
    // limit/stop reference level; market orders carry the signal price for audit.
    price: intent.price ?? null,
    sl: intent.sl ?? null,
    tps: Array.isArray(intent.tps) ? intent.tps.slice() : [],
    tf: intent.tf ?? null,
    status: 'created',
    createdAt: now,
    riskCheckedAt: null,
    submittedAt: null,
    filledAt: null,
    cancelledAt: null,
    expiredAt: null,
    fillPrice: null,
    filledQty: 0,
    fee: null,
    slippageBps: null,
    cancelReason: null,
    cancelBy: null,
    rejectReason: null,
    simulationVersion: ORDER_MODEL_VERSION,
    engineVersion: meta.engineVersion ?? null,
  }
}

/**
 * Legal transitions of the §17.2 machine. Key = source state; value = the set
 * of events allowed from it (each maps to the next state via `APPLY`).
 */
export const EDGES = Object.freeze({
  created: ['risk_approved', 'reject'],
  riskChecked: ['queue', 'cancel', 'expire', 'reject'],
  pending: ['cancel', 'expire', 'partial', 'fill', 'reject'],
  partiallyFilled: ['cancel', 'expire', 'fill'],
})

export const APPLY = Object.freeze({
  risk_approved: { to: 'riskChecked', stamp: 'riskCheckedAt' },
  queue: { to: 'pending', stamp: 'submittedAt' },
  partial: { to: 'partiallyFilled' },
  fill: { to: 'filled', stamp: 'filledAt' },
  cancel: { to: 'cancelled', stamp: 'cancelledAt' },
  expire: { to: 'expired', stamp: 'expiredAt' },
  reject: { to: 'rejected' },
})

function fillFields(order, meta) {
  const f = meta.fill
  if (!f || !(Number.isFinite(f.price) && f.price > 0) || !(Number.isFinite(f.qty) && f.qty > 0)) {
    return null
  }
  return {
    fillPrice: f.price,
    filledQty: Number(order.filledQty) + f.qty,
    fee: Number.isFinite(f.fee) ? f.fee : (order.fee ?? null),
    slippageBps: Number.isFinite(f.slippageBps) ? f.slippageBps : (order.slippageBps ?? null),
  }
}

/**
 * Move `order` across one edge. PURE: returns { ok, order?, code?, reason? }.
 * - idempotent: a terminal order refuses every further event (code TERMINAL)
 * - unknown event / illegal edge -> code ILLEGAL
 * - `partial` means part of qty just filled (remainder stays live), `fill`
 *   means the order is fully consumed. Both require a positive price + qty.
 */
export function transition(order, event, meta = {}) {
  if (!order || typeof order.status !== 'string') return { ok: false, code: 'NO_ORDER' }
  const src = order.status
  if (isTerminal(src)) return { ok: false, code: 'TERMINAL', reason: `order is ${src}` }
  const edge = EDGES[src]
  if (!edge || !edge.includes(event)) return { ok: false, code: 'ILLEGAL', reason: `${event} not allowed from ${src}` }

  const rule = APPLY[event]
  const next = { ...order, status: rule.to, updatedAt: meta.now ?? Date.now() }
  if (rule.stamp) next[rule.stamp] = meta.now ?? Date.now()
  if (event === 'cancel') {
    next.cancelReason = meta.reason ?? 'manual'
    next.cancelBy = meta.by ?? 'unknown'
  }
  if (event === 'reject') next.rejectReason = meta.reason ?? 'rejected'

  if (event === 'partial' || event === 'fill') {
    const fields = fillFields(order, meta)
    if (!fields) return { ok: false, code: 'BAD_FILL', reason: 'fill needs positive price + positive qty' }
    const nextState = event === 'partial' ? 'partiallyFilled' : 'filled'
    if (nextState === 'filled') next.filledAt = meta.now ?? Date.now()
    return { ok: true, order: { ...next, ...fields, status: nextState } }
  }

  return { ok: true, order: next }
}