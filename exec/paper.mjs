#!/usr/bin/env node
// =============================================================================
//  TM TRADING - PAPER EXECUTOR (roadmap Phase 6, fill model Phase 7P)
//
//  Every order (webhook / scanner / AI) runs PAPER first. One cycle:
//
//    A) OPEN    — ENTRY alerts (status 'received', not stale) go through the
//                 risk gate (exec/risk.mjs — sizing + all limits) FIRST (D7),
//                 then the gate-approved qty is PRICED through the simulation
//                 fill model (simulation/fill.mjs): BUY fills at ask + slip,
//                 SELL at bid - slip, fees measured, never at a phantom
//                 signal price. A limit that is not marketable stays
//                 'received' and retries next cycle (it expires through the
//                 stale sweep); a partial fill opens what filled and keeps
//                 the remainder on the book (alert.partialRemain, retried
//                 against the SAME approved order — D3 externalId).
//                 Idempotent at the ORDER layer (D3): externalId =
//                 clientOrderId(alertKey) hits the unique sparse index, so a
//                 re-run / crash-replay never opens the same alert twice.
//    B) EXIT    — exits come from two sources, both matched against "the
//                 latest data" for live PnL:
//                   1. follow-up alerts from TV (STOP_LOSS / TAKE_PROFIT /
//                      TIME_CLOSE) — the event TradingView already saw;
//                   2. 1m klines scan (SL/TP cross) for everything else.
//                 Conservative intra-bar rule (same as backtest): if both SL
//                 and TP could be touched, SL is assumed first; a bar that
//                 OPENS beyond the stop fills at the open (worse); TP always
//                 fills at the TP level (never optimistic). The decided price
//                 is then costed through simulation/engine.mjs closeFill:
//                 SL / market exits pay taker slippage + taker fee, TP fills
//                 exactly at the level with a maker fee.
//    C) CLOSE   — PnL (fee-NET) -> position doc + risk_state day counters
//                 (recordClose, which auto-halts the day at the loss cap).
//                 Closes are logged through the gate module too (roadmap
//                 acceptance).
//
//  Known simplifications (documented on purpose):
//   - entry intent is the alert price (limit-at-signal); the FILL is whatever
//     the real quote gives — a level the market never reaches simply does not
//     fill and ages out via PAPER_STALE_MS (default 15 min);
//   - multiple open positions on one symbol: follow-up alerts close the
//     OLDEST one first;
//   - TAKE_PROFIT closes the full position (a tpPcts ladder is supported by
//     simulation/engine.mjs tpPortion but not yet plumbed by paper alerts);
//   - the quote for a fill is the latest 1m kline close observed NOW (klines
//     carry no book timestamp) — spread/size are modelled, not displayed.
//
//  FAIL-CLOSED ON A DEFECTIVE TP LADDER: a level that is not a positive finite
//  number (null/''/0 — what `Number(null)` produces) is never stored on a
//  position and never used by the exit scanner. `findFirstExit` refuses such a
//  level, and the ENTRY path rejects the alert instead, because a stored
//  `tps[0] = 0` would make its `high >= tp1` test trivially true — a long would
//  be "closed at TP" at price 0 (fabricated PnL + a spurious daily-loss halt).
//
//  CLI:
//    node exec/paper.mjs                 one cycle, then exit
//    node exec/paper.mjs --watch         loop (PAPER_INTERVAL sec, default 60)
//    node exec/paper.mjs --interval 30   loop with custom interval (seconds)
// =============================================================================
import { fetchKlines } from '../engine/data.mjs'
import { clientOrderId } from '../engine/keys.mjs'
import { exitReasonOf, exitReasonFromHit } from '../engine/stamp.mjs'
import { attemptFill, loadFillConfig, ORDER_TYPES, FILL_DEFAULTS } from '../simulation/fill.mjs'
import { applyFill, closeFill } from '../simulation/engine.mjs'
import { createPaperOrder } from '../simulation/order.mjs'
import { buildFillRecord } from '../simulation/fills.mjs'
import { loadEnv } from './env.mjs'
import {
loadRiskConfig, checkOrder, recordOpen, recordClose, equityNow, auditLog,
} from './risk.mjs'
import { snapshotRecord, recordDecisionSnapshot, SNAPSHOT_KIND } from './snapshot.mjs'
import { tradeContextRecord, recordTradeContext } from './tradeContext.mjs'
import { qualityGates, qualityGateSummary } from './qualityGates.mjs'
import { resolveFidelity, formatFidelityBanner, fidelityRecord } from '../simulation/fidelity.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

loadEnv()

const PAPER_DEFAULTS = Object.freeze({
  staleMs: Number(process.env.PAPER_STALE_MS || 15 * 60 * 1000),
  intervalSec: Number(process.env.PAPER_INTERVAL || 60),
  market: process.env.PAPER_MARKET || 'fapi',
  batch: 20, // max ENTRY alerts processed per cycle
})

let models = null
async function getModels() {
  if (models) return models
  const db = await import('../engine/db.mjs')
  const conn = await db.connectMongo()
  if (!conn) return null
const { Alert, Position, PaperOrder, PaperFill, PaperAccount, Snapshot, TradeContext } = await import('../engine/models/index.mjs')
models = { Alert, Position, PaperOrder, PaperFill, PaperAccount, Snapshot, TradeContext }
  return models
}

// --- §26.5 paper_fills ledger helpers -------------------------------------
// A fill row is a FACT recorded only when the alert/order state CAS matched
// (modifiedCount>0) — a crash-retried cycle can NEVER double-write a row for
// the same execution. Append-only, fail-soft: a ledger miss logs, never breaks
// the cycle (D12: the ledger is evidence, not the choke point).

const signalTimeOf = (a) => {
  const ts = a?.ts
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.getTime()
  const n = Number(ts)
  return Number.isFinite(n) && n > 0 ? n : null
}

const spreadOf = (quote) => {
  const bid = Number(quote?.bid); const ask = Number(quote?.ask)
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 ? ask - bid : null
}

async function recordPaperFill(m, doc) {
  if (!m.PaperFill) return
  try {
    await m.PaperFill.create(doc)
  } catch (e) {
    if (e?.code === 11000) return // duplicate fillId — already recorded (dedupe)
    console.warn(`[paper] fill ledger error: ${e?.message || e}`)
  }
}

const paperFillOf = (a, execution, { intentQty, fillId, quote, decisionTime, account, simulateOnly = false, fidelity = null }) =>
  buildFillRecord({
    fillId,
    orderId: clientOrderId(a.alertKey, 0),
    alertKey: a.alertKey,
    accountId: account,
    source: 'paper',
    symbol: a.symbol,
    side: a.side,
    type: execution.orderType ?? orderTypeOf(a),
    qty: intentQty,
    fillPrice: execution.price,
    fillQty: execution.filledQty,
    feeRateBps: execution.feeRateBps,
    feeAmount: execution.fee,
    spreadAbs: spreadOf(quote),
    slippageBps: execution.slippageBps,
    latencyMs: execution.latencyMs,
    signalTime: signalTimeOf(a),
    decisionTime,
    eventTime: execution.eventTime,
    simulateOnly,
    fidelity,
  })

// 'BTCUSDT.P' (TradingView display) -> 'BTCUSDT' (Binance API)
const apiSymbol = (s) => (s.endsWith('.P') ? s.slice(0, -2) : s)

// =============================================================================
//  EXIT matching (pure over bars — easy to reason about, reviewed by eye)
// =============================================================================

/**
 * First SL/TP1 touch AFTER `afterMs`, conservative intra-bar ordering.
 * Refuses to scan when a level is not a POSITIVE price: `tp1 = 0` makes the
 * `high >= tp1` test trivially true, so a long would be "closed at TP" at price
 * 0 (fabricated PnL), and a non-positive stop is equally meaningless.
 * @returns {{price:number, time:number, kind:'sl'|'tp'} | null}
 */
export function findFirstExit(bars, { dir, sl, tp1 }, afterMs) {
  if (!Number.isFinite(sl) || !Number.isFinite(tp1)) return null
  if (sl <= 0 || tp1 <= 0) return null
  if (dir !== 1 && dir !== -1) return null // an unknown direction must not be treated as a short
  for (const b of bars) {
    if (b.time <= afterMs) continue
    if (dir === 1) {
      // SL first: gap open below stop fills at open (worse); else level.
      if (b.open < sl) return { price: b.open, time: b.time, kind: 'sl' }
      if (b.low <= sl) return { price: sl, time: b.time, kind: 'sl' }
      if (b.high >= tp1) return { price: tp1, time: b.time, kind: 'tp' }
    } else {
      if (b.open > sl) return { price: b.open, time: b.time, kind: 'sl' }
      if (b.high >= sl) return { price: sl, time: b.time, kind: 'sl' }
      if (b.low <= tp1) return { price: tp1, time: b.time, kind: 'tp' }
    }
  }
  return null
}

/** Exit price implied by a follow-up alert (TV already saw the event). */
export function followExitPrice(alert) {
  if (alert.action === 'STOP_LOSS') return Number(alert.price) // actual stop price
  if (alert.action === 'TAKE_PROFIT') {
    const lvl = Number(alert.level)
    const tp = Number.isFinite(lvl) && alert.tps?.[lvl - 1] !== undefined ? Number(alert.tps[lvl - 1]) : NaN
    return Number.isFinite(tp) ? tp : Number(alert.price)
  }
  return null // TIME_CLOSE -> market (resolved by caller from latest data)
}

/**
 * The TP ladder that is safe to STORE on a position, or a defect report.
 *
 * The exit scanner reads `tps[0]`, so a 0 there (exactly what `Number(null)`
 * gives) would "close" a long at price 0. Returns `{ok:true, tps}` with coerced
 * POSITIVE levels, or `{ok:false, index, value, reason}` — the caller must then
 * fail closed (reject the alert) instead of storing the raw array.
 */
export function sanitizeTps(tps) {
  if (!Array.isArray(tps) || tps.length === 0) {
    return { ok: false, index: null, value: tps, reason: 'tps must be a non-empty array' }
  }
  const out = []
  for (let i = 0; i < tps.length; i++) {
    const v = tps[i]
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, index: i, value: v, reason: `tps[${i}] is not a positive finite number` }
    }
    out.push(n)
  }
  return { ok: true, tps: out }
}

/**
 * Order type of an ENTRY alert (Phase 7P): the ticket's `type` travels inside
 * the `raw` payload (JSON from webhook / server ticket). Anything missing or
 * invalid defaults to 'limit' — the legacy limit-at-signal intent, so old
 * alerts keep their original semantics.
 * @returns {'market'|'limit'|'stop'}
 */
export function orderTypeOf(alert) {
  const raw = alert?.raw
  let type = null
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const o = JSON.parse(raw)
      type = typeof o === 'string' ? o : o?.type
    } catch {
      type = raw // legacy bare value ('market' / 'limit' / ...)
    }
  } else if (raw && typeof raw === 'object') {
    type = raw.type
  }
  return ORDER_TYPES.includes(type) ? type : 'limit'
}

/**
 * Sizing intent of an ENTRY alert (v3 §16.1-16.2): the ticket's `qty` XOR
 * `riskPct` rides the `raw` payload. Absent = the gate sizes from config/kelly
 * (D7a); present = the gate verifies the intent against every cap before a
 * fill. The server already validated the shape — here we only extract.
 * @returns {{qty?:number, pct?:number}} at most one key, both numbers
 */
export function ticketSizingOf(alert) {
  const raw = alert?.raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { return sizingFrom(JSON.parse(raw)) } catch { return {} }
  }
  if (raw && typeof raw === 'object') return sizingFrom(raw)
  return {}
}

function sizingFrom(o) {
  const out = {}
  const qty = Number(o?.qty)
  const pct = Number(o?.riskPct)
  if (Number.isFinite(qty) && qty > 0) out.qty = qty
  else if (Number.isFinite(pct) && pct > 0 && pct <= 100) out.pct = pct
  return out
}

// =============================================================================
//  Cycle
// =============================================================================

export async function runCycle(config = loadRiskConfig(), opts = {}) {
  const cfg = { ...PAPER_DEFAULTS, ...opts }
  const stats = { opened: 0, rejected: 0, stale: 0, working: 0, remainder: 0, closed: 0, errors: 0, mongoDown: false }
  const fillModel = loadFillConfig() // SIM_* env overrides of simulation/fill.mjs
  // §34: the active fidelity label for this cycle. Today the paper executor is
  // F1 (quote-aware fill model); depth (F3) and broker sync (F4) are not active.
  const fidelity = fidelityRecord({ mode: 'paper', depthActive: false, tradeStreamActive: false, quoteAware: true, brokerSync: false })
  stats.fidelity = fidelity.code
  console.log(`[paper] fidelity: ${fidelity.banner}`)
  const m = await getModels()
  if (!m) {
    stats.mongoDown = true
    console.warn('[paper] Mongo unavailable — cycle skipped (fail-soft)')
    return stats
  }

  await ensureAccountRow(m, config)

  // ============================================================================
//  §20 account seed: the executor roots the account baseline ONCE so historical
//  accounting can never be rewritten by a later config change. The projection
//  (server + test) derives balance/realized/daily/drawdown from positions.
// ============================================================================
async function ensureAccountRow(m, config) {
  if (!m.PaperAccount) return
  const baseline = Number(config.equity)
  const initialBalance = Number.isFinite(baseline) && baseline > 0 ? baseline : 10000
  try {
    await m.PaperAccount.updateOne(
      { accountId: config.account },
      { $setOnInsert: { accountId: config.account, currency: 'USDT', mode: 'LIVE_PAPER', initialBalance } },
      { upsert: true },
    )
  } catch (e) {
    console.warn(`[paper] account seed warning: ${e?.message || e}`)
  }
}

// --- A) OPEN: ENTRY -> risk gate -> paper position -----------------------
  const staleCutoff = new Date(Date.now() - cfg.staleMs)
  const staleRes = await m.Alert.updateMany(
    { action: 'ENTRY', status: { $in: ['received', 'working'] }, ts: { $lt: staleCutoff } },
    { $set: { status: 'rejected', rejectReason: `stale: older than ${Math.round(cfg.staleMs / 1000)}s — refusing phantom fills` } },
  )
  stats.stale = staleRes.modifiedCount || 0
  if (stats.stale) console.log(`[paper] stale ENTRY rejected: ${stats.stale}`)

  // Same expiry, mirrored onto the first-class order doc (§17.2 EXPIRED): a
  // pending order whose alert went stale also dies, and it never becomes a
  // position. Order-level sweep keeps one query per cycle.
  const staleOrders = await m.PaperOrder.updateMany(
    { status: 'pending', createdAt: { $lt: staleCutoff } },
    { $set: { status: 'expired', expiredAt: new Date(), updatedAt: new Date() } },
  )
  if (staleOrders?.modifiedCount) console.log(`[paper] expired pending orders: ${staleOrders.modifiedCount}`)

  const entries = await m.Alert.find({ action: 'ENTRY', status: { $in: ['received', 'working'] }, ts: { $gte: staleCutoff } })
    .sort({ ts: 1 }).limit(cfg.batch).lean()

  // §29: the version this cycle's trades belong to — resolved ONCE per cycle
  // from the active profile. null = no live version declared: honest null all
  // the way to positions/trade_context, never a guessed identity (D1).
  // Lazy-imported: keeps the DB layer out of this module's import graph until
  // a cycle actually runs (the offline paper suite must never pull engine/db).
  const liveVersionId = entries.length
    ? await (await import('../engine/strategyService.mjs')).resolveLiveVersion({}).catch(() => null)
    : null

  // One quote per symbol per cycle (fetched lazily). The kline has no book
  // timestamp, so `time` is when WE observed it — the model's latency/staleness
  // logic then judges the age of OUR data, which is the honest measure here.
  const quotes = new Map()
  const quoteFor = async (symbol) => {
    if (quotes.has(symbol)) return quotes.get(symbol)
    let q = null
    try {
const { bars } = await fetchKlines({ symbol: apiSymbol(symbol), tf: '1', market: cfg.market, refresh: true, limit: 2 })
const last = bars?.length ? bars[bars.length - 1] : null
if (last && Number.isFinite(last.close) && last.close > 0) q = {
last: last.close,
time: Date.now(),
// §26.3 decision snapshots need the CLOSED bar the decision saw, not just
// the last price — carry the whole kline alongside the quote.
bar: {
open: Number(last.open) || last.close,
high: Number(last.high) || last.close,
low: Number(last.low) || last.close,
close: Number(last.close),
volume: Number(last.volume) ?? 0,
time: Number(last.time),
},
}
    } catch {
      q = null // fetch failed: no quote this cycle, the intent just retries
    }
    quotes.set(symbol, q)
    return q
  }

  for (const a of entries) {
    try {
      const decision = await checkOrder(
        {
          symbol: a.symbol, side: a.side, entry: a.price, sl: a.sl, tps: a.tps,
          ...ticketSizingOf(a), // v3 §16.1: qty or riskPct intent rides the raw payload
        },
        config,
      )
      if (!decision.ok) {
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'rejected', rejectReason: `${decision.code}: ${decision.message}` } })
        stats.rejected++
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${decision.code}`)
        continue
      }
      // Fail closed on a defective ladder. The gate already rejects gaps, but a
      // legacy/manually inserted alert doc can still carry one, and this is the
      // function that STORES the array the exit scanner later reads as tps[0].
      const safeTps = sanitizeTps(a.tps)
      if (!safeTps.ok) {
        const reason = `BAD_TPS: ${safeTps.reason} (${JSON.stringify(safeTps.value)}) — refusing to store an unusable TP ladder`
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_reject_tps', { symbol: a.symbol, index: safeTps.index, value: String(safeTps.value) })
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${safeTps.reason}`)
        continue
      }
      const dir = a.side === 'BUY' ? 1 : -1

      // --- PRICING (Phase 7P): the gate approved the qty; the fill model
      // decides the price/fee against the real quote. Never fill at the signal
      // price: that was a phantom fill whenever the market moved.
      const orderType = orderTypeOf(a)
      const quote = await quoteFor(a.symbol)
      if (!quote) {
        console.log(`[paper] no quote for ${a.symbol} this cycle — ${a.side} kept as received (retry)`)
        continue
      }

      // --- §35 DATA QUALITY GATES: block new entries on stream/quote/risk gaps
      // (fail-closed), degrade gracefully on secondary feeds (shown in snapshot).
      // Facts are measured here; the pure gate returns the full picture.
      const q = qualityGates({
        streamState: 'ok', // monitor.status() not wired yet — honest 'ok' until §35 monitor feed
        quoteAgeMs: Date.now() - (quote.time ?? 0),
        candleGapUnresolved: false, // no gap detector wired yet
        orderbookSeqInvalid: false, // depth-dependent fills not active
        depthDependentFill: false,
        instrumentState: 'active',
        riskStateAvailable: true, // risk gate already ran; if it were down, checkOrder would have failed
        fundingAgeMs: null, // funding/OI not wired into this cycle yet
        oiAgeMs: null,
        newsAvailable: null,
        secondaryProviderUp: null,
      })
      if (!q.allowed) {
        const reason = `DATA_QUALITY_BLOCK: ${qualityGateSummary(q)}`
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_reject_data_quality', { symbol: a.symbol, block: q.block, degraded: q.degraded })
        console.log(`[paper] BLOCK ${a.symbol} ${a.side} — ${reason}`)
        continue
      }

      // --- ORDER DOC (§17.2, D3): one first-class order per approved intent,
      // upserted on clientOrderId so a crash can never duplicate it. Starts
      // 'created'; the states below move it through the machine.
      const orderCid = clientOrderId(a.alertKey, 0)
      const orderDoc = createPaperOrder({
        clientOrderId: orderCid,
        alertKey: a.alertKey,
        account: config.account,
        source: 'paper',
        symbol: a.symbol,
        side: a.side,
        type: orderType,
        qty: decision.qty, // gate-sized (D7) — never the intent, never cleaned up here
        price: a.price,
        sl: a.sl,
        tps: safeTps.tps,
        tf: a.tf ?? null,
      })
await m.PaperOrder.updateOne(
{ clientOrderId: orderCid },
{ $setOnInsert: orderDoc },
{ upsert: true },
)

// --- §26.3 DECISION SNAPSHOT: the immutable context the GATE approved.
// One row per order/alert (snapshotId = snap:alertKey, D3), $setOnInsert so a
// crash-replay never rewrites the decision that already happened (D4). The
// quote/bar here are OUR observed 1m data (dataQuality.ageMs measures how old
// they were) — never fabricated (D12).
await recordDecisionSnapshot(m.Snapshot, snapshotRecord({
alertKey: a.alertKey,
symbol: a.symbol,
venue: `binance:${cfg.market}`,
timeframe: a.tf ?? null,
clockTime: Date.now(),
bar: quote.bar ?? null,
quote: quote.bar ? { last: quote.last, time: quote.time } : null,
  dataQuality: { source: `binance:kline1m`, lastSeenMs: quote.bar?.time ?? quote.time, qualityGate: q, fidelity: fidelity.code },
decision: { ok: true, code: 'APPROVED', message: 'gate approved entry', side: a.side, qty: decision.qty, notional: decision.notional },
}))

      const fill = attemptFill(
        { type: orderType, side: a.side, qty: decision.qty, ...(orderType !== 'market' ? { price: a.price } : {}) },
        quote,
        fillModel,
        Date.now(),
      )
      if (fill.status === 'working' || fill.status === 'stale') {
        // Not marketable yet (limit above ask / stop not reached): the intent
        // becomes PENDING (state machine), the alert flips to 'working' and
        // retries next cycle; the stale sweep expires it if never reached —
        // no phantom fill either way. The user can cancel it from the terminal.
await m.PaperOrder.updateOne(
        { clientOrderId: orderCid },
        { $set: { status: 'pending', submittedAt: new Date(), updatedAt: new Date() } },
      )
      await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'working' } })
        stats.working++
        console.log(`[paper] WORKING ${a.symbol} ${a.side} ${orderType} qty=${decision.qty} — ${fill.reason}`)
        continue
      }
      if (fill.status === 'rejected' || !(fill.filledQty > 0)) {
        const reason = `FILL_REJECTED: ${fill.reason || 'no usable fill'}`
        await m.PaperOrder.updateOne(
          { clientOrderId: orderCid },
          { $set: { status: 'rejected', rejectReason: reason, updatedAt: new Date() } },
        )
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_fill_rejected', { symbol: a.symbol, orderType, reason: String(fill.reason) })
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${reason}`)
        continue
      }
      try {
        await recordOpen({
          config,
          symbol: a.symbol,
          dir,
          qty: fill.filledQty, // what ACTUALLY filled, never the intent
          entryPrice: fill.price, // modelled fill price, never the signal price
          sl: a.sl,
          tps: safeTps.tps, // sanitised ladder — never the raw alert array
          externalId: clientOrderId(a.alertKey, 0), // D3 order-layer idempotency
          alertKey: a.alertKey,
          tf: a.tf ?? null, // D1/Phase 13: positions now carry their timeframe
          source: 'paper',
          strategyVersionId: liveVersionId, // §29 live version (null = not declared)
          notes: fill.reason ?? null,
          fees: fill.fee, // MEASURED entry fee (Phase 7P) — null only = unknown
          orderType,
          slippage: fill.slippageBps,
          fidelity: fidelity.code,
        })
      } catch (e) {
        if (e?.code === 11000) {
          // Same alert already opened before a crash — order layer blocked it.
          console.log(`[paper] duplicate order (11000) for ${a.symbol} — already open`)
        } else throw e
      }
      const remain = fill.remainderQty > 0 ? fill.remainderQty : null
      // §17.2: full consumption -> FILLED; a buyer/seller remainder -> the
      // order stays live as PARTIALLY_FILLED until A2 completes it (same key).
      const orderStatus = remain ? 'partiallyFilled' : 'filled'
      const orderSet = {
        status: orderStatus,
        fillPrice: fill.price,
        filledQty: fill.filledQty,
        fee: Number.isFinite(fill.fee) ? fill.fee : null,
        slippageBps: Number.isFinite(fill.slippageBps) ? fill.slippageBps : null,
        filledAt: new Date(),
        updatedAt: new Date(),
      }
      if (!remain) orderSet.submittedAt = new Date()
      await m.PaperOrder.updateOne(
        { clientOrderId: orderCid, status: { $in: ['created', 'riskChecked', 'pending', 'partiallyFilled'] } },
        { $set: orderSet },
      )
      // The ALERT flip is the execution CAS: only when it really happened
      // (received|working -> opened) is this a NEW fill — a crash-retried row
      // stays the same execution and never double-records the ledger (§26.5).
      const alertRes = await m.Alert.updateOne(
        { alertKey: a.alertKey, status: { $in: ['received', 'working'] } },
        { $set: { status: 'opened', partialRemain: remain } },
      )
      if (alertRes.modifiedCount > 0) {
        stats.opened++
        await recordPaperFill(m, paperFillOf(a, fill, {
          intentQty: decision.qty,
          fillId: `fill_${a.alertKey}_${Date.now()}`,
          quote,
          decisionTime: Date.now(),
          account: config.account,
          fidelity: fidelity.code,
        }))
        console.log(`[paper] OPEN ${a.symbol} ${a.side} ${orderType} qty=${fill.filledQty} @ ${fill.price} fee=${fill.fee}${remain ? ` (partial, remain ${remain})` : ''} (risk ${(decision.notional ?? 0).toFixed(0)})`)
      }
    } catch (e) {
      stats.errors++
      console.error(`[paper] open error ${a.symbol}:`, e?.message || e)
      auditLog('paper_open_error', { symbol: a.symbol, error: e?.message || String(e) })
    }
  }

  // --- A2) PARTIAL FILL REMAINDERS: finish the SAME approved order (D3) -----
  // The gate approved the FULL qty when the entry first passed; this only
  // completes what the book could not absorb then — it never re-sizes, never
  // bypasses the gate, and shares the entry's externalId (clientOrderId).
  const remainders = await m.Alert.find({ action: 'ENTRY', status: 'opened', partialRemain: { $gt: 0 } })
    .sort({ ts: 1 }).limit(cfg.batch).lean()
  for (const a of remainders) {
    try {
      const pos = await m.Position.findOne({
        account: config.account,
        source: 'paper',
        status: 'open',
        externalId: clientOrderId(a.alertKey, 0),
      }).lean()
      if (!pos) {
        // Position gone (closed meanwhile): nothing left to fill — clear the debt.
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { partialRemain: null } })
        continue
      }
      const quote = await quoteFor(a.symbol)
      if (!quote) continue
      const orderType = orderTypeOf(a)
      const fill = attemptFill(
        { type: orderType, side: a.side, qty: a.partialRemain, ...(orderType !== 'market' ? { price: a.price } : {}) },
        quote,
        fillModel,
        Date.now(),
      )
      if (fill.status !== 'filled' && fill.status !== 'partial') {
        if (fill.status === 'rejected') console.warn(`[paper] remainder ${a.symbol} rejected: ${fill.reason} — debt kept for inspection`)
        continue // working / stale: retry next cycle
      }
      const left = fill.remainderQty > 0 ? fill.remainderQty : null
      // The ORDER status CAS gates the WHOLE A2 execution (position merge,
      // ledger row, remainder). First success moves the order to FILLED (or
      // stays live as PARTIALLY_FILLED for a new remainder); a crash-retried
      // cycle then finds status 'filled' and no-ops — it can never re-apply
      // the same remainder to the position or double-count the order.
      const orderCid = clientOrderId(a.alertKey, 0)
      const orderRes = await m.PaperOrder.updateOne(
        { clientOrderId: orderCid, status: 'partiallyFilled' },
        {
          $set: {
            status: left ? 'partiallyFilled' : 'filled',
            fillPrice: fill.price,
            fee: Number.isFinite(fill.fee) ? fill.fee : null,
            slippageBps: Number.isFinite(fill.slippageBps) ? fill.slippageBps : null,
            filledAt: new Date(),
            updatedAt: new Date(),
          },
          $inc: { filledQty: fill.filledQty },
        },
      )
      if (!(orderRes.modifiedCount > 0)) {
        // Order already consumed (filled) or externally terminal — clear the
        // leftover debt so the alert stops retrying a dead execution.
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { partialRemain: null } })
        console.log(`[paper] remainder ${a.symbol} skipped — order ${orderCid} not live anymore (debt cleared)`)
        continue
      }
      const merged = applyFill(pos, fill) // weighted-average entry + accumulated fees
      await m.Position.updateOne(
        { _id: pos._id, status: 'open' },
        { $set: { qty: merged.qty, entryPrice: merged.entryPrice, fees: merged.fees } },
      )
      await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { partialRemain: left } })
      stats.remainder++
      await recordPaperFill(m, paperFillOf(a, fill, {
        intentQty: a.partialRemain,
        fillId: `fill_${a.alertKey}_r_${Date.now()}`,
        quote,
        decisionTime: Date.now(),
        account: config.account,
        fidelity: fidelity.code,
      }))
      console.log(`[paper] REMAINDER ${a.symbol} qty=+${fill.filledQty} @ ${fill.price} (remain ${left ?? 0})`)
    } catch (e) {
      stats.errors++
      console.error(`[paper] remainder error ${a.symbol}:`, e?.message || e)
      auditLog('paper_remainder_error', { symbol: a.symbol, error: e?.message || String(e) })
    }
  }

  // --- B) EXIT -------------------------------------------------------------
  const open = await m.Position.find({ account: config.account, status: 'open', source: 'paper' })
    .sort({ entryTime: 1 }).lean()
  if (open.length) {
    // B1) follow-up alerts (TV events), chronological, oldest position first
    const symbols = [...new Set(open.map((p) => p.symbol))]
    const follows = await m.Alert.find({
      action: { $in: ['TAKE_PROFIT', 'STOP_LOSS', 'TIME_CLOSE'] },
      status: 'received',
      symbol: { $in: symbols },
    }).sort({ ts: 1 }).lean()
    const stillOpen = [...open]
    for (const f of follows) {
      const idx = stillOpen.findIndex((p) => p.symbol === f.symbol && f.ts > p.entryTime)
      if (idx === -1) continue // no position (leftover history) or already closed
      const pos = stillOpen[idx]
      let price = followExitPrice(f)
      if (price === null) {
        // TIME_CLOSE: fill at the latest market close
        try {
          const { bars } = await fetchKlines({ symbol: apiSymbol(pos.symbol), tf: '1', market: cfg.market, refresh: true, limit: 2 })
          price = bars?.length ? bars[bars.length - 1].close : Number(f.price)
        } catch {
          price = Number(f.price)
        }
      }
      if (!(Number.isFinite(price) && price > 0)) {
        console.warn(`[paper] follow-up ${f.action} ${f.symbol} has no usable price — skipped`)
        continue
      }
      // Exit KIND for the fill model: TP lands exactly on the level (maker),
      // SL/time-close are taker events (slippage + taker fee).
      const kind = f.action === 'TAKE_PROFIT' ? 'tp' : f.action === 'STOP_LOSS' ? 'sl' : 'market'
      const closed = await closePosition(m, config, pos, price, exitReasonOf('alert', f.action), f.ts, kind, fillModel, `binance:${cfg.market}`)
      if (closed) {
        await m.Alert.updateOne({ alertKey: f.alertKey }, { $set: { status: 'closed' } })
        stillOpen.splice(idx, 1)
        stats.closed++
      }
    }

    // B2) data-driven SL/TP scan for whatever is still open (one fetch per symbol)
    const bySymbol = new Map()
    for (const p of stillOpen) {
      if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, [])
      bySymbol.get(p.symbol).push(p)
    }
    for (const [symbol, positions] of bySymbol) {
      try {
        const oldest = Math.min(...positions.map((p) => +new Date(p.entryTime)))
        const needBars = Math.min(30000, Math.ceil((Date.now() - oldest) / 60000) + 10)
        const { bars } = await fetchKlines({ symbol: apiSymbol(symbol), tf: '1', market: cfg.market, refresh: true, limit: needBars })
        for (const pos of positions) {
          const tp1 = Array.isArray(pos.tps) && pos.tps.length ? Number(pos.tps[0]) : NaN
          if (!(Number.isFinite(tp1) && tp1 > 0)) {
            // Legacy/manual position whose ladder is unusable (e.g. a null level
            // cast to 0 by Mongoose). Do NOT let the scanner "hit" it: a 0 would
            // close the position at price 0. Skip LOUDLY so it gets noticed.
            console.warn(`[paper] position ${pos._id} ${pos.symbol} has no usable TP1 (${JSON.stringify(pos.tps)}) — data exit scan skipped, close it manually or via a follow-up alert`)
            auditLog('paper_bad_tps1', { symbol: pos.symbol, positionId: String(pos._id), tps: pos.tps })
            continue
          }
          const hit = findFirstExit(bars, { dir: pos.dir, sl: Number(pos.sl), tp1 }, +new Date(pos.entryTime))
          if (!hit) continue
          // `hit.kind` is what the exit scan actually decided ('tp'/'sl') — the
          // only place in the system that knows it. Recorded, never re-derived.
          const closed = await closePosition(m, config, pos, hit.price, exitReasonFromHit(hit), new Date(hit.time), hit.kind, fillModel, `binance:${cfg.market}`)
          if (closed) stats.closed++
        }
      } catch (e) {
        stats.errors++
        console.error(`[paper] data scan error ${symbol}:`, e?.message || e)
        auditLog('paper_scan_error', { symbol, error: e?.message || String(e) })
      }
    }
  }

  if (stats.opened || stats.closed || stats.rejected || stats.stale || stats.working || stats.remainder || stats.errors) {
    console.log(`[paper] cycle: opened=${stats.opened} closed=${stats.closed} rejected=${stats.rejected} stale=${stats.stale} working=${stats.working} remainder=${stats.remainder} errors=${stats.errors}`)
  }
  return stats
}

/**
 * Close a paper position at `exitPrice` and push counters through the gate
 * module (recordClose -> risk_state + auto daily-cap halt). Idempotent: the
 * update only matches status 'open'.
 *
 * `exitReason` comes from the exit path that decided (engine/stamp.mjs
 * `exitReasonOf` / `exitReasonFromHit`) and is PERSISTED on the position, because
 * a later reader cannot tell a TP from a gap fill by looking at prices. It
 * defaults to 'unknown' — the honest value for "this path does not know".
 *
 * Phase 7P: the decided price is COSTED through simulation/engine.mjs
 * closeFill — 'tp' lands exactly at the level (maker fee), 'sl'/'market' pay
 * taker slippage on top (a gap already fills at the worse bar open, this makes
 * it worse still — conservative). `pnlAbs` is fee-NET and `fees` on the
 * position becomes the MEASURED round-trip total (entry fee + exit fee).
 * An unpriceable position (bad dir/qty/price) is refused + audited — a stuck
 * position is investigated, never guessed at.
 */
async function closePosition(m, config, pos, exitPrice, exitReason = 'unknown', exitTime = new Date(), kind = 'sl', fillModel = FILL_DEFAULTS, venue = null) {
  const equityBefore = await equityNow(config)
  const close = closeFill(pos, { kind, price: exitPrice }, fillModel)
  if (!close.ok) {
    auditLog('paper_close_unpriceable', { positionId: String(pos._id), symbol: pos.symbol, code: close.code, message: close.message })
    console.error(`[paper] CLOSE refused ${pos.symbol}: ${close.code} — ${close.message}`)
    return false
  }
  const pnlAbs = close.net // gross - open fees - exit fee (fee-NET)
  const pnlPct = close.pnlPct
  const pnlPctOnEquity = equityBefore > 0 ? (pnlAbs / equityBefore) * 100 : 0
  // fees: only a MEASURED round trip may be claimed. A legacy position whose
  // entry fee is unknown (null) keeps null after close — writing just the exit
  // fee would understate the total and pass it off as measured.
  const entryFeesKnown = pos.fees !== null && pos.fees !== undefined && Number.isFinite(Number(pos.fees))
  const res = await m.Position.updateOne(
    { _id: pos._id, status: 'open' },
    { $set: { status: 'closed', exitPrice: close.exitPrice, exitTime, pnlAbs, pnlPct, fees: entryFeesKnown ? close.feesTotal : null, exitReason } },
  )
  if (!res.modifiedCount) return false // someone else closed it first
  await recordClose({ config, symbol: pos.symbol, pnlAbs, pnlPctOnEquity, win: pnlAbs > 0, equity: equityBefore, reason: exitReason })

  // §26.3 EXIT SNAPSHOT — the context at the moment of the close decision.
  // alertKey `${signalKey}#exit` keeps it a deterministic sibling of the entry
  // snapshot (D3); $setOnInsert keeps the first close honest across replays.
  // Only a signal-rooted position can anchor one — manual legs say nothing
  // it could fingerprint, so they record none (D12).
  if (pos.signalKey && venue) {
    const exitMs = +new Date(exitTime)
    await recordDecisionSnapshot(m.Snapshot, snapshotRecord({
      alertKey: `${pos.signalKey}#exit`,
      kind: SNAPSHOT_KIND.exitDecision,
      symbol: pos.symbol,
      venue,
      timeframe: pos.tf ?? null,
      clockTime: exitMs,
      bar: null, // exits fill off alert events or SL/TP levels, not a fresh bar
      quote: { last: close.exitPrice, time: exitMs },
      dataQuality: { source: `paper:exit:${kind}` },
      decision: {
        ok: true, code: `EXIT_${String(exitReason).toUpperCase()}`, message: `closed @ ${close.exitPrice} (${exitReason})`,
        side: pos.dir === 1 ? 'SELL' : 'BUY', qty: pos.qty,
        notional: Number.isFinite(Number(close.exitPrice)) && Number.isFinite(Number(pos.qty)) ? Number(close.exitPrice) * Number(pos.qty) : null,
      },
    }))
  }

  // §26.6 TRADE CONTEXT — join position facts + close result + snapshot ids into
  // the AI-dataset dataset. Fail-soft: a context miss must never block the
  // executor (the position/risk counters above are the authoritative writes).
  await recordTradeContext(m.TradeContext, tradeContextRecord({
    position: { ...pos, status: 'closed', exitPrice: close.exitPrice, exitTime, exitReason },
    close: {
      exitPrice: close.exitPrice, exitTime, exitReason, pnlAbs, pnlPct,
      fees: entryFeesKnown ? close.feesTotal : null, // honest null when partial
    },
    venue,
    now: Date.now(),
  }))
  // Follow the ENTRY alert to 'closed' so the dashboard/accounting sees the
  // full journey received -> opened -> closed (signalKey = alertKey).
  if (pos.signalKey) await m.Alert.updateOne({ alertKey: pos.signalKey }, { $set: { status: 'closed' } })
  console.log(`[paper] CLOSE ${pos.symbol} ${pos.dir === 1 ? 'LONG' : 'SHORT'} @ ${close.exitPrice} pnl=${pnlAbs.toFixed(2)} fees=${close.feesTotal.toFixed(6)} (${exitReason})`)
  return true
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const ivIdx = args.indexOf('--interval')
  const intervalSec = ivIdx >= 0 && Number.isFinite(Number(args[ivIdx + 1])) ? Number(args[ivIdx + 1]) : PAPER_DEFAULTS.intervalSec
  const config = loadRiskConfig()

  if (!watch) {
    runCycle(config).then((s) => process.exit(s.errors ? 1 : 0)).catch((e) => { console.error('[paper]', e); process.exit(1) })
  } else {
    console.log(`[paper] watch mode — every ${intervalSec}s (Ctrl+C to stop)`)
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        await runCycle(config)
      } catch (e) {
        console.error('[paper] cycle error:', e?.message || e)
      } finally {
        running = false
      }
    }
    tick()
    const timer = setInterval(tick, intervalSec * 1000)
    process.on('SIGINT', () => { clearInterval(timer); console.log('\n[paper] stopped'); process.exit(0) })
    process.on('SIGTERM', () => { clearInterval(timer); process.exit(0) })
  }
}
