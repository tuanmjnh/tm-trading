import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  REPLAY BROKER — the in-memory order/position book a replay session runs
//  (Phase 7R2, roadmap §25: "same fill model / same journal" as live paper).
//
//  ONE cycle per played-bar batch, mirroring exec/paper.mjs's cycle order:
//    A) ENTRIES — working orders priced through simulation/fill.mjs attemptFill
//       against the player's own { last, time } quote. The caller passes
//       now = quote.time (the REPLAY clock, never wall time), so quote age is
//       0 by construction and maxQuoteAgeMs can never reject a fresh bar.
//    B) EXITS   — open positions scanned with exec/paper.mjs findFirstExit over
//       the SAME played candles (full intra-bar OHLC, conservative SL-first,
//       exact same matcher live paper uses).
//
//  Pure + deterministic: no IO, no timers, no wall clock — state lives in the
//  caller's BrokerState and ids come from an internal counter (same bars +
//  same steps -> byte-identical book). Mongo stays OUT of this module on
//  purpose; the two IO seams belong to the session action:
//    - risk gate -> exec/risk checkOrder runs BEFORE an order is queued
//      (replaySessions.placeReplayOrder, D7 — no order without the gate);
//    - journal   -> each CLOSED position is projected through engine/journal
//      syncJournal by the session (test-injectable), same projection paper
//      rows go through.
//
//  Deliberate MVP deviations, documented here so nobody mistakes them for
//  bugs:
//    - ORDERS QUOTE AT BAR CLOSE ONLY: a limit/stop touched intra-bar but
//      closing away does not fill it (live paper quotes the same 1m close on
//      its cycle, so parity holds; the auto-timer steps ONE bar at a time —
//      only a manual step(N>1) batches the entry check).
//    - THE BOOK NEVER TOUCHES Mongo: replay orders/positions live in this
//      state only, so the live paper executor cannot pick them up and the
//      real account's D7b counters stay unpolluted.
//    - TP LADDER: first touch closes the FULL position (legacy close-all —
//      findFirstExit tp1 semantics), same as live paper's data scan.
// =============================================================================

type FillModule = typeof import('../../simulation/fill.mjs')
type SimModule = typeof import('../../simulation/engine.mjs')
type PaperModule = typeof import('../../exec/paper.mjs')
type StampModule = typeof import('../../engine/stamp.mjs')

// cwd-based dynamic imports — same rationale as engineModel(): Nitro bundles
// relative paths OUT of server/ incorrectly (docs/app-inheritance.md).
let fillP: Promise<FillModule> | null = null
function fillModule(): Promise<FillModule> {
  if (!fillP) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'fill.mjs')).href
    fillP = import(/* @vite-ignore */ file) as Promise<FillModule>
  }
  return fillP
}

let simP: Promise<SimModule> | null = null
function simModule(): Promise<SimModule> {
  if (!simP) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'engine.mjs')).href
    simP = import(/* @vite-ignore */ file) as Promise<SimModule>
  }
  return simP
}

let paperP: Promise<PaperModule> | null = null
function paperModule(): Promise<PaperModule> {
  if (!paperP) {
    const file = pathToFileURL(join(process.cwd(), 'exec', 'paper.mjs')).href
    paperP = import(/* @vite-ignore */ file) as Promise<PaperModule>
  }
  return paperP
}

let stampP: Promise<StampModule> | null = null
function stampModule(): Promise<StampModule> {
  if (!stampP) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'stamp.mjs')).href
    stampP = import(/* @vite-ignore */ file) as Promise<StampModule>
  }
  return stampP
}

// -----------------------------------------------------------------------------
//  Book types. Field names mirror simulation/engine.mjs positions so
//  openFromFill/closeFill/fromPosition accept a ReplayPosition as-is.
// -----------------------------------------------------------------------------

export type ReplayOrderStatus = 'working' | 'filled' | 'rejected'
export type ReplayOrderType = 'market' | 'limit' | 'stop'

export interface ReplayOrder {
  id: string
  side: 'BUY' | 'SELL'
  type: ReplayOrderType
  /** Limit/stop level (market orders carry the reference price they were placed at). */
  price: number
  sl: number
  tps: number[]
  /** Risk-gate sized quantity (decision.qty) — the UI never sizes anything (D21). */
  qty: number
  status: ReplayOrderStatus
  rejectReason?: string
  /** Replay-clock ms (never wall time). */
  createdAt: number
  filledAt?: number
  fillPrice?: number
  fee?: number
  positionId?: string
}

export interface ReplayPosition {
  id: string
  orderId: string
  account: string
  source: 'replay'
  symbol: string
  tf: string
  dir: 1 | -1
  qty: number
  entryPrice: number
  sl: number | null
  tps: number[]
  status: 'open' | 'closed'
  fees: number
  orderType: ReplayOrderType
  slippageBps: number | null
  alertKey: null
  /** Journal identity (D3/D4): unique per replay position, stable across reads. */
  externalId: string
  entryTime: number
  exitTime?: number
  exitPrice?: number
  exitReason?: string
  pnlAbs?: number
  pnlPct?: number
  /** Exit-scan cursor: the last replay-clock instant the SL/TP scan covered. */
  lastScanMs: number
}

export interface BrokerState {
  seq: number
  orders: ReplayOrder[]
  positions: ReplayPosition[]
}

export function createBrokerState(): BrokerState {
  return { seq: 0, orders: [], positions: [] }
}

/** A played bar, structurally a subset of marketRest.CandleEvent. */
export interface BrokerCandle {
  openTime: number
  closeTime: number
  eventTime: number
  open: number
  high: number
  low: number
  close: number
}

export interface BrokerQuote {
  last: number
  time: number
}

export interface AdvanceOpts {
  symbol: string
  tf: string
  account: string
  /** Bars played in THIS batch (ascending). Empty = entries-only pass. */
  bars: BrokerCandle[]
  quote: BrokerQuote | null
  /** Replay-clock ms — the caller passes quote.time so fills never go stale. */
  now: number
}

export interface AdvanceResult {
  opened: ReplayPosition[]
  closed: ReplayPosition[]
  errors: string[]
}

export interface ReplayTicket {
  side: 'BUY' | 'SELL'
  type: ReplayOrderType
  price: number
  sl: number
  tps: number[]
}

/**
 * Queue a gate-approved working order. qty comes from the risk gate decision
 * (D7) — this function does not size, validate sides or check budgets; the
 * gate and validateTicket already did.
 */
export function queueOrder(state: BrokerState, ticket: ReplayTicket, qty: number, now: number): ReplayOrder {
  state.seq += 1
  const order: ReplayOrder = {
    id: `rpo_${state.seq}`,
    side: ticket.side,
    type: ticket.type,
    price: ticket.price,
    sl: ticket.sl,
    tps: [...ticket.tps],
    qty,
    status: 'working',
    createdAt: now
  }
  state.orders.push(order)
  return order
}

/**
 * One broker cycle: entries (A) then exits (B), same order as exec/paper.mjs.
 * Async only because the pure engine modules load through cwd dynamic imports;
 * after the awaits the mutation runs synchronously, so concurrent cycles
 * (auto-step timer vs. a place) can never tear the book.
 */
export async function advanceBroker(state: BrokerState, opts: AdvanceOpts): Promise<AdvanceResult> {
  const opened: ReplayPosition[] = []
  const closed: ReplayPosition[] = []
  const errors: string[] = []

  const fill = await fillModule()
  const sim = await simModule()
  const paper = await paperModule()
  const stamp = await stampModule()
  const fillModel = fill.loadFillConfig()

  // --- A) entries ----------------------------------------------------------
  if (opts.quote) {
    for (const o of state.orders) {
      if (o.status !== 'working') continue
      const attempt = fill.attemptFill(
        { type: o.type, side: o.side, qty: o.qty, ...(o.type !== 'market' ? { price: o.price } : {}) },
        opts.quote,
        fillModel,
        opts.now
      )
      if (attempt.status === 'filled' || attempt.status === 'partial') {
        const base = sim.openFromFill(attempt, {
          account: opts.account,
          source: 'replay',
          symbol: opts.symbol,
          dir: o.side === 'BUY' ? 1 : -1,
          sl: o.sl,
          tps: o.tps,
          orderType: o.type,
          tf: opts.tf,
          alertKey: null
        })
        state.seq += 1
        const pos: ReplayPosition = {
          ...base,
          status: 'open',
          id: `rpp_${state.seq}`,
          orderId: o.id,
          externalId: `replay:${o.id}`,
          // Entry instant = the quote bar's close (D16 event time). The exit
          // scan starts AFTER it: the bar that filled us cannot also stop us.
          entryTime: opts.quote.time,
          lastScanMs: opts.quote.time
        }
        state.positions.push(pos)
        opened.push(pos)
        o.status = 'filled'
        o.filledAt = opts.quote.time
        o.fillPrice = attempt.price ?? undefined
        o.fee = attempt.fee
        o.positionId = pos.id
      } else if (attempt.status === 'rejected' || attempt.status === 'stale') {
        o.status = 'rejected'
        o.rejectReason = attempt.reason ?? attempt.status
      }
      // 'working' keeps waiting for a marketable quote (next advance).
    }
  }

  // --- B) exits ------------------------------------------------------------
  if (opts.bars.length) {
    // findFirstExit reads b.time — the engine's bar convention is the bucket
    // OPEN time; it must stay strictly after a position's lastScanMs (the
    // previous bar's CLOSE) for the next bar to be scanned. openTime(N+1) =
    // closeTime(N) + 1 holds for every engine candle shape, so both cursors
    // are comparable milliseconds.
    const exitBars = opts.bars.map((b) => ({
      time: b.openTime,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close
    }))
    const lastBar = opts.bars[opts.bars.length - 1]
    const batchEnd = lastBar ? lastBar.closeTime : opts.now

    for (const p of state.positions) {
      if (p.status !== 'open') continue
      const tp1 = Number(Array.isArray(p.tps) && p.tps.length ? p.tps[0] : NaN)
      const hit = paper.findFirstExit(exitBars, { dir: p.dir, sl: Number(p.sl), tp1 }, p.lastScanMs)
      if (!hit) {
        p.lastScanMs = Math.max(p.lastScanMs, batchEnd)
        continue
      }
      const close = sim.closeFill(p, { kind: hit.kind, price: hit.price }, fillModel)
      if (!close.ok) {
        // Unpriceable position: advance the cursor so the same bar is not
        // retried forever, keep it open and say why — a stuck position is
        // investigated, never guessed at (same rule as paper closePosition).
        errors.push(`${p.id} close refused ${close.code}: ${close.message}`)
        p.lastScanMs = Math.max(p.lastScanMs, batchEnd)
        continue
      }
      p.status = 'closed'
      p.exitPrice = close.exitPrice
      p.exitTime = hit.time
      // 'data:sl' / 'data:tp' — engine/stamp.mjs exitReasonFromHit, the same
      // string the paper data-scan writes, so deriveResult reads a TP/SL.
      p.exitReason = stamp.exitReasonFromHit(hit)
      p.pnlAbs = close.pnlAbs
      p.pnlPct = close.pnlPct
      p.fees = close.feesTotal // measured round trip (entry fee + exit fee)
      closed.push(p)
    }
  }

  return { opened, closed, errors }
}
