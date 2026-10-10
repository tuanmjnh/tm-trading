// =============================================================================
//  TM TRADING — PAPER ACCOUNT (roadmap v3 §20), PURE core.
//
//  The paper account must survive browser refresh / reconnect / backend restart
//  WITHOUT changing historical state. This projection derives every §20 number
//  from what is ALREADY persisted and measured — it is a VIEW, not a second
//  money ledger, so it can never drift from the executed facts (D12):
//
//    initialBalance  — config equity seed, fixed at first activity (base)
//    realizedPnl     — Σ closed position pnlAbs (fee-NET, measured by the executor)
//    balance         — initialBalance + realizedPnl   (exact, no Heisenberg)
//    unrealized      — Σ open-position marks off CURRENT quotes (SAME sim core)
//    equity          — balance + unrealized           (read-time, honest nulls)
//    dailyPnl        — realized realized on the current UTC day (D2)
//    maxDrawdown     — peak-to-trough of the REALIZED equity curve (exact:
//                      historical marks are not reconstructed, D12). Basis is
//                      explicit so no one mistakes it for an account-level dd.
//
//  Pure: no IO, no clock — `now` and every position are passed in. Golden tests
//  in simulation/test.mjs + tests/paperAccount.test.ts lock the arithmetic.
// =============================================================================

import {
  MARGIN_DEFAULTS,
  accountMarginHealth,
  positionNotional,
} from './margin.mjs'
import { markUnrealized } from './engine.mjs'
import { FILL_DEFAULTS } from './fill.mjs'

export const ACCOUNT_MODEL_VERSION = 'paper_account.v1'

const round8 = (n) => Math.round(n * 1e8) / 1e8
const round4 = (n) => Math.round(n * 1e4) / 1e4
const fin = (v) => typeof v === 'number' && Number.isFinite(v)

/** D2: business day = 'YYYY-MM-DD' in UTC. String key, never local time. */
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Accept Date | ISO string | number and normalize to epoch ms (null if unusable). */
export const msOf = (v) => {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * §20 PaperAccount projection from persisted positions (open + closed) + quotes.
 *
 * @param {object} p
 * @param {number} [p.base]          initial (config equity) balance
 * @param {Array}  p.positions       position docs (open + closed)
 * @param {(symbol:string)=>object|null} [p.quoteFor] current quotes (LiveQuote shape)
 * @param {object} [p.model]         margin defaults
 * @param {number} [p.now]           read clock (epoch ms, D2)
 * @param {string} [p.accountId]     'default' etc
 */
export function accountProjection(p) {
  const {
    accountId = 'default',
    base = 0,
    positions = [],
    quoteFor = () => null,
    model = MARGIN_DEFAULTS,
    now = Date.now(),
  } = p

  const initialBalance = fin(base) ? base : 0
  const open = positions.filter((x) => String(x.status) === 'open')
  const closed = positions.filter((x) => String(x.status) === 'closed')

  // --- realized (exact): fee-NET pnlAbs as the executor measured it ----------
  let realized = 0
  let realizedUsable = false
  for (const c of closed) {
    const pnl = Number(c.pnlAbs)
    if (fin(pnl)) { realized += pnl; realizedUsable = true }
  }
  const balance = round8(initialBalance + realized)

  // --- daily + event times (D2) ----------------------------------------------
  const today = utcDay(now)
  let dailyPnl = 0
  let lastEventMs = null
  for (const c of closed) {
    const t = msOf(c.exitTime)
    if (t != null) {
      lastEventMs = lastEventMs == null ? Math.max(t, lastEventMs ?? 0) : Math.max(lastEventMs, t)
      if (utcDay(t) === today) {
        const pnl = Number(c.pnlAbs)
        if (fin(pnl)) dailyPnl += pnl
      }
    }
  }
  for (const o of open) {
    const t = msOf(o.entryTime)
    if (t != null) lastEventMs = lastEventMs == null ? t : Math.max(lastEventMs, t)
  }

  // --- unrealized (read-time, honest): null when open positions exist but no
  //     quote is available for ANY of them (never dressed as zero).
  let unrealized = 0
  let quotedAny = false
  for (const o of open) {
    const quote = quoteFor(String(o.symbol || ''))
    if (!quote) continue
    quotedAny = true
    const mark = markUnrealized(o, quote, FILL_DEFAULTS)
    if (mark.ok) unrealized += Number(mark.net) || 0
  }
  unrealized = quotedAny ? round8(unrealized) : null
  const openCount = open.length
  const unrealizedFinal = unrealized !== null ? unrealized : 0
  const equity = round8(balance + unrealizedFinal)

  // --- margin (cross-style floor over the OPEN book) -------------------------
  const health = accountMarginHealth({ equity, positions: open, model })
  const notional = open.reduce((acc, o) => {
    const n = positionNotional(o)
    return n !== null ? acc + n : acc
  }, 0)

  // --- maxDrawdown: peak-to-trough of the REALIZED curve (exact). ------------
  const realizedCurve = closed
    .filter((c) => fin(Number(c.pnlAbs)))
    .sort((a, b) => (msOf(a.exitTime) || 0) - (msOf(b.exitTime) || 0))
  let bal = initialBalance
  let peak = initialBalance
  let maxDd = 0
  for (const c of realizedCurve) {
    bal += Number(c.pnlAbs)
    if (bal > peak) peak = bal
    const dd = peak - bal
    if (dd > maxDd) maxDd = dd
  }
  maxDd = round8(maxDd)
  const maxDdPct = peak > 0 ? round4((maxDd / peak) * 100) : null

  return {
    accountId,
    mode: 'LIVE_PAPER',
    currency: 'USDT',
    modelVersion: ACCOUNT_MODEL_VERSION,
    initialBalance: round8(initialBalance),
    balance,
    realizedPnl: realizedUsable ? round8(realized) : null,
    unrealized: unrealized, // number | null (honest)
    equity,
    availableBalance: health.ok ? health.freeMargin : 0,
    marginUsed: health.ok ? health.marginUsed : 0,
    utilizationPct: health.ok ? health.utilizationPct : 0,
    maintenance: health.ok ? health.maintenance : 0,
    liquidated: health.ok ? health.liquidated : false,
    notional: openCount ? round8(notional) : null,
    openPositions: openCount,
    dailyPnl: round8(dailyPnl),
    lastActivityDay: lastEventMs != null ? utcDay(lastEventMs) : today,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    drawdownBasis: 'realized',
    updatedAt: lastEventMs != null ? lastEventMs : now,
  }
}

export { markUnrealized, positionNotional, accountMarginHealth, MARGIN_DEFAULTS, FILL_DEFAULTS }