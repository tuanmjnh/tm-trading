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
//    node exec/paper.mjs --session <id>  join a trading session (Slice C;
//                                        one-shot or watch — verified live)
//  Env: PAPER_SESSION=off disables session writes; PAPER_SESSION_ID=<id> is
//  the --session equivalent. Watch mode without either auto-starts one
//  live-paper session per boot (restart recovery included).
// =============================================================================
import { fetchKlines, TF_MS } from '../engine/data.mjs'
import { atr } from '../engine/ta.mjs'
import { createFeedHealth, candleGapUnresolved } from './feedHealth.mjs'
import { beat as heartbeatBeat, readHeartbeat as heartbeatRead, HEARTBEAT_FILE } from '../services/heartbeat.mjs'
import { clientOrderId } from '../engine/keys.mjs'
import {
  appendEvent as appendSessionEvent,
  createSession as createSessionDoc,
  deskHalt,
  haltSession,
  transition as transitionSession,
} from '../engine/session.mjs'
import { exitReasonOf, exitReasonFromHit } from '../engine/stamp.mjs'
import { ENGINE_VERSION } from '../engine/version.mjs'
import { buildManifest, riskFingerprint } from '../engine/manifest.mjs'
import { attemptFill, loadFillConfig, ORDER_TYPES, FILL_DEFAULTS } from '../simulation/fill.mjs'
import { applyFill, closeFill } from '../simulation/engine.mjs'
import { createPaperOrder } from '../simulation/order.mjs'
import { buildFillRecord } from '../simulation/fills.mjs'
import { loadEnv, ROOT } from './env.mjs'
import {
loadRiskConfig, checkOrder, loadSnapshot, recordOpen, recordClose, equityNow, auditLog,
} from './risk.mjs'
import { snapshotRecord, recordDecisionSnapshot, SNAPSHOT_KIND } from './snapshot.mjs'
import { tradeContextRecord, recordTradeContext } from './tradeContext.mjs'
import { qualityGates, qualityGateSummary } from './qualityGates.mjs'
import { readWsHealth } from './wsHealth.mjs'
import { resolveFidelity, formatFidelityBanner, fidelityRecord } from '../simulation/fidelity.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

loadEnv()

const PAPER_DEFAULTS = Object.freeze({
  staleMs: Number(process.env.PAPER_STALE_MS || 15 * 60 * 1000),
  intervalSec: Number(process.env.PAPER_INTERVAL || 60),
  market: process.env.PAPER_MARKET || 'fapi',
  batch: 20, // max ENTRY alerts processed per cycle
  // Slice F (§35.1 quote_stale): age of the DATA we price off — measured from
  // the newest 1m bar's exchange timestamp, not from our own fetch clock (that
  // one is always ~0 and blocked nothing). 1.5 bars = 90s: a healthy feed
  // serves a forming 1m bar under 60s old; anything past 90s has missed a bar
  // close. Widening from the module default (60s) avoids flapping on clock
  // skew at the minute boundary. PAPER_QUOTE_STALE_MS overrides per policy.
  quoteStaleMs: Number(process.env.PAPER_QUOTE_STALE_MS || 90 * 1000),
})

// Slice F (D33): per-stream feed health, kept ACROSS cycles in this process so
// consecutive failures accumulate into a connection STATE (ok -> stale ->
// disconnected) instead of each cycle pretending it is the first. Pure — the
// tracking only; every fact fed to it was observed by quoteFor below.
const BAR_MS = TF_MS['1'] ?? 60_000
const feedHealth = createFeedHealth({
  tfMs: BAR_MS,
  staleAfterMs: PAPER_DEFAULTS.quoteStaleMs,
  failThreshold: Number(process.env.PAPER_FEED_FAIL_THRESHOLD || 3),
})
const feedStreamOf = (market, symbol) => `binance:${market}:kline1m:${symbol}`

// G8.2: the realtime plane runs in the NITRO process, this executor in its own.
// Its monitor (connection + sequence gaps + latency) is shared through a small
// atomically-replaced snapshot; see market/healthSnapshot.mjs. Absent file =
// 'unknown', never 'ok' — a plane that is not running must not look healthy.
const WS_HEALTH_FILE = process.env.PAPER_WS_HEALTH_FILE || join(ROOT, 'logs', 'market-plane-health.json')

let models = null
async function getModels() {
  if (models) return models
  const db = await import('../engine/db.mjs')
  const conn = await db.connectMongo()
  if (!conn) return null
const { Alert, Position, PaperOrder, PaperFill, PaperAccount, Snapshot, TradeContext, TradingSession, TradingDomainEvent } = await import('../engine/models/index.mjs')
models = { Alert, Position, PaperOrder, PaperFill, PaperAccount, Snapshot, TradeContext, TradingSession, TradingDomainEvent }
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

// --- §61.17 Phase C outbox ------------------------------------------------
// Publish one durable trading event per committed state change (order / fill /
// position) so every trading view reconciles without a manual refresh. This is
// the C3b writer layer: the pure builders (simulation/order.mjs, fills.mjs)
// stay dependency-free and RETURN the fact; the Mongo-owning executor emits it
// here. Never statically imported (the offline paper suite asserts this module
// pulls in no DB layer), and best-effort — the store re-reads Mongo state, so a
// missed event must never fail a cycle. An ownerless (legacy) desk emits
// nothing: a trading event without an owner is a tenancy bug (§61.3).
let eventStore = null
async function emit(m, input) {
  if (!m?.TradingDomainEvent) return
  try {
    if (!eventStore) eventStore = await import('../services/workspaceStore.mjs')
    await eventStore.emitTradingEvent(input)
  } catch { /* outbox is best-effort */ }
}

const paperFillOf = (a, execution, { intentQty, fillId, quote, decisionTime, account, simulateOnly = false, fidelity = null, sessionId = null, ownerId = null }) =>
  buildFillRecord({
    fillId,
    orderId: clientOrderId(a.alertKey, 0),
    alertKey: a.alertKey,
    accountId: account,
    ownerId,
    sessionId: sessionId ?? null,
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
 * Per-bot dynamic stop management (breakeven + ATR trailing) — PURE.
 *
 * `execution` (from the instance, set at launch):
 *   - slBreakevenOn: once the favorable excursion since entry reaches
 *     `slTriggerR` × initial risk, ratchet SL to the ENTRY price.
 *   - slTrailOn: ratchet SL to `close ∓ slTrailAtrMult × ATR` every cycle,
 *     only ever tightening (never loosening) the stop.
 *
 * The initial risk is |entry − current SL| — valid until the first move; after
 * the SL is at/past breakeven the breakeven rule is inherently satisfied and
 * the ratchet keeps the tightened stop, so both rules stay idempotent.
 *
 * @returns {{ newSl: number } | null} null = nothing to change (disabled,
 *   unusable inputs, or the candidate does not improve the current stop).
 */
export function applyTrailingStop(pos, bars, execution) {
  const ex = execution && typeof execution === 'object' ? execution : {}
  const beOn = ex.slBreakevenOn === true
  const trailOn = ex.slTrailOn === true
  if (!beOn && !trailOn) return null

  const dir = Number(pos?.dir)
  const entry = Number(pos?.entryPrice)
  const sl = Number(pos?.sl)
  if ((dir !== 1 && dir !== -1) || !Number.isFinite(entry) || !Number.isFinite(sl) || sl <= 0) return null

  const list = Array.isArray(bars) ? bars.filter((b) => Number.isFinite(Number(b?.close))) : []
  const close = Number(list.at(-1)?.close)
  if (!Number.isFinite(close) || close > 0 === false) return null

  // Favorable extreme since entry (long: highest high, short: lowest low).
  const entryMs = +new Date(pos.entryTime)
  let extreme = close
  for (const b of list) {
    if (+new Date(b.time) < entryMs) continue
    extreme = dir === 1 ? Math.max(extreme, Number(b.high)) : Math.min(extreme, Number(b.low))
  }

  const sign = dir === 1 ? 1 : -1
  const improves = (candidate) => (dir === 1 ? candidate > sl : candidate < sl)
  let best = sl

  if (beOn) {
    const risk0 = Math.abs(entry - sl)
    if (risk0 > 0) {
      const trigger = entry + sign * Number(ex.slTriggerR ?? 1) * risk0
      const reached = dir === 1 ? extreme >= trigger : extreme <= trigger
      if (reached) best = entry
    }
  }

  if (trailOn) {
    const mult = Number(ex.slTrailAtrMult ?? 1.5)
    if (Number.isFinite(mult) && mult > 0 && list.length >= 15) {
      const atrs = atr(list, Number(ex.slTrailAtrLen) || 14)
      const a = Number(atrs.at(-1))
      if (Number.isFinite(a) && a > 0) {
        const candidate = close - sign * mult * a
        if (dir === 1 ? candidate > best : candidate < best) best = candidate
      }
    }
  }

  return improves(best) ? { newSl: best } : null
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
//  Trading session context (V3.4 Slice C).
//
//  When the executor runs with a session (explicit --session / PAPER_SESSION_ID,
//  or auto-created per watch boot unless PAPER_SESSION=off), every order,
//  position and fill it writes carries that sessionId, and lifecycle activity
//  is appended to the session timeline (activity-only — quiet cycles write
//  nothing). Without a session the cycle behaves EXACTLY as before.
// =============================================================================

const SESSION_TERMINAL = ['completed', 'failed', 'halted']

async function sessionEvent(m, id, kind, message) {
  if (!id || !m?.TradingSession) return
  try {
    const found = await m.TradingSession.findOne({ sessionId: id }).lean()
    if (!found) return
    const next = appendSessionEvent(found, { t: Date.now(), kind, message })
    await m.TradingSession.updateOne(
      { sessionId: id },
      { $set: { timeline: next.timeline, timelineDropped: next.timelineDropped, lastEventAt: next.lastEventAt } }
    )
  } catch (e) {
    console.warn(`[paper] session event failed: ${e?.message || e}`)
  }
}

async function sessionBump(m, id, inc) {
  if (!id || !m?.TradingSession) return
  try {
    const incDoc = {}
    for (const [k, v] of Object.entries(inc || {})) incDoc[`counts.${k}`] = Number(v) || 0
    await m.TradingSession.updateOne({ sessionId: id }, { $inc: incDoc, $set: { lastEventAt: Date.now() } })
  } catch (e) {
    console.warn(`[paper] session bump failed: ${e?.message || e}`)
  }
}

/**
 * §59.15 Slice F — kill-switch integration, state side. A desk-wide halt
 * (kill_switch / drift / manual) freezes new entries in the Risk Gate; this
 * moves the RUNNING session to `halted` too, so `/sessions` cannot show a live
 * session while the desk is frozen. Returns the halt classification plus
 * whether this call is the one that moved the record.
 */
async function enforceDeskHalt(m, id, day) {
  const halt = deskHalt(day)
  if (!halt.deskWide) return { ...halt, sessionHalted: false }
  if (!id || !m?.TradingSession) return { ...halt, sessionHalted: false }
  try {
    const found = await m.TradingSession.findOne({ sessionId: id }).lean()
    if (!found) return { ...halt, sessionHalted: false }
    const res = haltSession(found, { at: Date.now(), reason: halt.reason })
    if (!res.ok) {
      // ALREADY_HALTED / ALREADY_TERMINAL: gate and session already agree.
      return { ...halt, sessionHalted: false, code: res.code }
    }
    await m.TradingSession.updateOne(
      { sessionId: id },
      { $set: { state: res.doc.state, stoppedAt: res.doc.stoppedAt ?? null, lastEventAt: res.doc.lastEventAt, timeline: res.doc.timeline, timelineDropped: res.doc.timelineDropped } }
    )
    return { ...halt, sessionHalted: true }
  } catch (e) {
    console.warn(`[paper] session halt failed: ${e?.message || e}`)
    return { ...halt, sessionHalted: false }
  }
}

async function sessionTransition(m, id, to) {
  if (!id || !m?.TradingSession) return false
  try {
    const found = await m.TradingSession.findOne({ sessionId: id }).lean()
    if (!found) return false
    const res = transitionSession(found, to, { at: Date.now() })
    if (!res.ok) {
      console.warn(`[paper] session move refused: ${res.code}`)
      return false
    }
    await m.TradingSession.updateOne(
      { sessionId: id },
      { $set: { state: res.doc.state, startedAt: res.doc.startedAt ?? null, stoppedAt: res.doc.stoppedAt ?? null, lastEventAt: res.doc.lastEventAt, timeline: res.doc.timeline, timelineDropped: res.doc.timelineDropped } }
    )
    return true
  } catch (e) {
    console.warn(`[paper] session move failed: ${e?.message || e}`)
    return false
  }
}

/**
 * Resolve the session context for this process: explicit id (CLI/env) is
 * adopted when live; otherwise a watch boot recovers stale same-account
 * sessions (failed, superseded — auditable, never silent) and starts fresh.
 * One-shot runs stay sessionless unless named. Returns a sessionId or null.
 */
export async function resolvePaperSession(m, config, opts = {}) {
  if (process.env.PAPER_SESSION === 'off') return null
  if (!m?.TradingSession) return null
  const ownerId = config.ownerId ?? null
  const identity = opts.identity ?? {}
  const explicit = opts.sessionId || process.env.PAPER_SESSION_ID || null
  if (explicit) {
    const found = await m.TradingSession.findOne({
      $or: [{ _id: explicit }, { sessionId: explicit }],
      ownerId,
    }).lean().catch(() => null)
    if (!found) {
      console.warn(`[paper] session ${explicit} not found — running sessionless`)
      return null
    }
    if (SESSION_TERMINAL.includes(found.state)) {
      console.warn(`[paper] session ${explicit} is terminal (${found.state}) — running sessionless`)
      return null
    }
    await sessionEvent(m, found.sessionId, 'attached', 'paper executor attached (explicit session)')
    console.log(`[paper] session attached: ${found.sessionId} (${found.state})`)
    return found.sessionId
  }
  if (!opts.watch) return null
  // Restart recovery: stale actives of this account fail explicitly first —
  // combined with D3 order idempotency, a restart never duplicates anything.
  const stale = await m.TradingSession.find({
    accountId: config.account,
    ownerId,
    kind: 'live-paper',
    state: { $in: ['queued', 'starting', 'running', 'paused', 'stopping'] }
  }).lean().catch(() => [])
  const fresh = createSessionDoc({
    kind: 'live-paper',
    accountId: config.account,
    ownerId,
    createdBy: 'paper-executor',
    // Phase F: the session declares its identity, so evidence can answer which
    // engine/strategy/risk/data produced it without consulting other stores.
    strategyVersionId: identity.strategyVersionId ?? config.strategyVersionId ?? null,
    botProfileId: identity.botProfileId ?? null,
    instruments: identity.instruments ?? [],
    timeframes: identity.timeframes ?? [],
    manifest: buildManifest({
      kind: 'session',
      source: identity.source ?? 'paper',
      purpose: identity.purpose ?? 'paper-executor',
      engineVersion: ENGINE_VERSION,
      methods: identity.methods ?? (config.method ? [config.method] : []),
      strategyVersionId: identity.strategyVersionId ?? config.strategyVersionId ?? null,
      paramsHash: identity.paramsHash ?? config.paramsHash ?? null,
      method: identity.method ?? config.method ?? null,
      riskFingerprint: riskFingerprint(config),
      riskSource: identity.riskSource ?? 'env',
      dataSource: identity.dataSource ?? 'venue-rest',
      qualityState: identity.qualityState ?? null,
      datasetIds: identity.datasetIds ?? [],
      account: config.account,
      instruments: identity.instruments ?? [],
      timeframes: identity.timeframes ?? [],
      botProfileId: identity.botProfileId ?? null,
      instanceId: identity.instanceId ?? null,
      experimentId: identity.experimentId ?? null,
      baselineVersionId: identity.baselineVersionId ?? null,
      evidenceSetId: identity.evidenceSetId ?? null,
      createdAt: Date.now(),
    }),
  })
  await m.TradingSession.create(fresh)
  for (const s of stale) {
    await sessionTransition(m, s.sessionId, 'failed')
    await sessionEvent(m, s.sessionId, 'superseded', `restart recovery — superseded by ${fresh.sessionId}`)
  }
  await sessionEvent(m, fresh.sessionId, 'started', `paper executor watch boot (account ${config.account})`)
  console.log(`[paper] session started: ${fresh.sessionId} (recovered ${stale.length} stale)`)
  return fresh.sessionId
}

/**
 * Leverage intent of an ENTRY alert (v3 §17.1b): the ticket's `leverage`
 * rides the `raw` payload next to qty/riskPct. Integer 1..125 (server
 * validated at intake; the risk gate still caps notional independently).
 * @returns {number|null} null = legacy / absent (account-level model applies)
 */
export function ticketLeverageOf(alert) {
  const raw = alert?.raw
  let o = null
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { o = JSON.parse(raw) } catch { return null }
  } else if (raw && typeof raw === 'object') {
    o = raw
  }
  const lev = Number(o?.leverage)
  return Number.isInteger(lev) && lev >= 1 && lev <= 125 ? lev : null
}

// =============================================================================
//  Cycle
// =============================================================================

export async function runCycle(config = loadRiskConfig(), opts = {}) {
  const cfg = { ...PAPER_DEFAULTS, ...opts }
  // Slice C: every doc this cycle writes carries the active session (null =
  // sessionless, behavior exactly as before).
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId ? opts.sessionId : null
  // Tenancy (roadmap §61.3): every read/write of this cycle is scoped to the
  // owner that owns the account. null = legacy single-desk rows (un-backfilled).
  const ownerId = config.ownerId ?? null
  const stats = { opened: 0, rejected: 0, stale: 0, working: 0, remainder: 0, closed: 0, errors: 0, mongoDown: false, halted: 0, sessionHalted: false }
  const fillModel = loadFillConfig() // SIM_* env overrides of simulation/fill.mjs
  // §34: the active fidelity label for this cycle. Today the paper executor is
  // F1 (quote-aware fill model); depth (F3) and broker sync (F4) are not active.
  const fidelity = fidelityRecord({ mode: 'paper', depthActive: false, tradeStreamActive: false, quoteAware: true, brokerSync: false })
  stats.fidelity = fidelity.code
  console.log(`[paper] fidelity: ${fidelity.banner}`)
  // Test/replay hook (same rule as `opts.quoteFor`): inject the bar source so a
  // full entry→exit cycle can be proven without a live feed. Production never
  // passes it — the REST fetch below stays the only default.
  const fetchBars = typeof opts.fetchKlines === 'function' ? opts.fetchKlines : fetchKlines
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
      { accountId: config.account, ownerId: config.ownerId ?? null },
      { $setOnInsert: { accountId: config.account, ownerId: config.ownerId ?? null, currency: 'USDT', mode: 'LIVE_PAPER', initialBalance } },
      { upsert: true },
    )
  } catch (e) {
    console.warn(`[paper] account seed warning: ${e?.message || e}`)
  }
}

// --- A) OPEN: ENTRY -> risk gate -> paper position -----------------------
  const staleCutoff = new Date(Date.now() - cfg.staleMs)
  const staleRes = await m.Alert.updateMany(
    { action: 'ENTRY', ownerId, status: { $in: ['received', 'working'] }, ts: { $lt: staleCutoff } },
    { $set: { status: 'rejected', rejectReason: `stale: older than ${Math.round(cfg.staleMs / 1000)}s — refusing phantom fills` } },
  )
  stats.stale = staleRes.modifiedCount || 0
  if (stats.stale) console.log(`[paper] stale ENTRY rejected: ${stats.stale}`)

  // Same expiry, mirrored onto the first-class order doc (§17.2 EXPIRED): a
  // pending order whose alert went stale also dies, and it never becomes a
  // position. Order-level sweep keeps one query per cycle.
  const staleOrderFilter = { ownerId, status: 'pending', createdAt: { $lt: staleCutoff } }
  const staleOrderIds = await m.PaperOrder.find(staleOrderFilter, { clientOrderId: 1 }).lean().catch(() => [])
  const staleOrders = await m.PaperOrder.updateMany(
    staleOrderFilter,
    { $set: { status: 'expired', expiredAt: new Date(), updatedAt: new Date() } },
  )
  if (staleOrders?.modifiedCount) console.log(`[paper] expired pending orders: ${staleOrders.modifiedCount}`)
  for (const so of staleOrderIds) {
    await emit(m, { type: 'order.expired', entityId: so.clientOrderId, ownerId, accountId: config.account, at: Date.now() })
  }

  const entries = await m.Alert.find({ action: 'ENTRY', ownerId, status: { $in: ['received', 'working'] }, ts: { $gte: staleCutoff } })
    .sort({ ts: 1 }).limit(cfg.batch).lean()

  // §59.15 Slice F — kill-switch integration. A desk-wide halt (kill_switch /
  // drift / manual, inherited across midnight) freezes NEW ENTRIES; the
  // protective exits below still run, because a halt must never trap an open
  // position. The Risk Gate refuses the same orders — this closes the other
  // half: the session record moves to `halted`, so /sessions and the gate can
  // no longer disagree about whether the desk is frozen.
  const haltDay = await loadSnapshot(config).then((s) => s.day).catch(() => null)
  const halt = await enforceDeskHalt(m, sessionId, haltDay)
  if (halt.deskWide) {
    stats.halted = entries.length
    stats.sessionHalted = halt.sessionHalted
    console.warn(`[paper] desk halted (${halt.reason}) — ${entries.length} entry intent(s) blocked${halt.sessionHalted ? '; session moved to halted' : ''}`)
  }

  // §29: the version this cycle's trades belong to — resolved ONCE per cycle
  // from the active profile. null = no live version declared: honest null all
  // the way to positions/trade_context, never a guessed identity (D1).
  // Lazy-imported: keeps the DB layer out of this module's import graph until
  // a cycle actually runs (the offline paper suite must never pull engine/db).
  const liveVersionId = entries.length
    ? await (await import('../engine/strategyService.mjs')).resolveLiveVersion(ownerId ? { ownerId } : {}).catch(() => null)
    : null

  // One quote per symbol per cycle (fetched lazily). The kline has no book
  // timestamp, so `time` is when WE observed it — the model's latency/staleness
  // logic then judges the age of OUR data, which is the honest measure here.
  const quotes = new Map()
  // Slice F: bar open times of the last fetch per symbol — the raw facts the
  // gap detector (§35.1 candle_gap_unresolved) judges. Separate map so the
  // quote object passed to the fill model keeps its exact old shape.
  const barTimes = new Map()
  // Test/replay hook: a caller may inject `quoteFor(symbol)` so the cycle can be
  // proven end-to-end without a live feed (engine/test-db.mjs Phase E evidence).
  // Production runs never pass it; the REST path below stays the only default.
  const quoteOverride = typeof opts.quoteFor === 'function' ? opts.quoteFor : null
  const quoteFor = async (symbol) => {
    if (quotes.has(symbol)) return quotes.get(symbol)
    let q = null
    let dataAt = null
    if (quoteOverride) {
      try {
        q = (await quoteOverride(symbol, { at: Date.now() })) || null
      } catch {
        q = null
      }
      if (q?.bar?.time != null) {
        dataAt = Number(q.bar.time)
        barTimes.set(symbol, [dataAt])
      }
      feedHealth.record(feedStreamOf(cfg.market, symbol), { ok: Boolean(q), dataAt, at: Date.now() })
      quotes.set(symbol, q)
      return q
    }
    try {
const { bars } = await fetchBars({ symbol: apiSymbol(symbol), tf: '1', market: cfg.market, refresh: true, limit: 2 })
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
      if (q) {
        // The DATA timestamp (bar open, exchange clock) — what "fresh" means.
        dataAt = Number(last.time)
        barTimes.set(symbol, (Array.isArray(bars) ? bars : []).map((b) => Number(b?.time)).filter(Number.isFinite))
      }
    } catch {
      q = null // fetch failed: no quote this cycle, the intent just retries
    }
    if (!q) {
      // Slice F: a failed fetch is an OBSERVED fact — count it toward the
      // stream's connection state (D33). An endpoint that answers with old
      // candles also counts as failing (feedHealth judges data freshness).
      feedHealth.record(feedStreamOf(cfg.market, symbol), { ok: false, at: Date.now() })
    } else {
      feedHealth.record(feedStreamOf(cfg.market, symbol), { ok: true, dataAt, at: Date.now() })
    }
    quotes.set(symbol, q)
    return q
  }

  // One read per cycle, not per alert: the snapshot is a shared fact, and a
  // cycle-level read is what makes "the same conditions for every intent" true.
  const ws = await readWsHealth(WS_HEALTH_FILE, { at: Date.now() })

  for (const a of halt.deskWide ? [] : entries) {
    try {
      const decision = await checkOrder(
        {
          symbol: a.symbol, side: a.side, entry: a.price, sl: a.sl, tps: a.tps,
          ...ticketSizingOf(a), // v3 §16.1: qty or riskPct intent rides the raw payload
        },
        config,
      )
      if (!decision.ok) {
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { status: 'rejected', rejectReason: `${decision.code}: ${decision.message}` } })
        stats.rejected++
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${decision.code}`)
        await emit(m, {
          type: 'order.risk-rejected',
          entityId: clientOrderId(a.alertKey, 0),
          ownerId,
          accountId: config.account,
          at: Date.now(),
          data: { code: decision.code, message: decision.message, symbol: a.symbol, side: a.side },
        })
        continue
      }
      // Fail closed on a defective ladder. The gate already rejects gaps, but a
      // legacy/manually inserted alert doc can still carry one, and this is the
      // function that STORES the array the exit scanner later reads as tps[0].
      const safeTps = sanitizeTps(a.tps)
      if (!safeTps.ok) {
        const reason = `BAD_TPS: ${safeTps.reason} (${JSON.stringify(safeTps.value)}) — refusing to store an unusable TP ladder`
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_reject_tps', { symbol: a.symbol, index: safeTps.index, value: String(safeTps.value) })
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${safeTps.reason}`)
        await emit(m, {
          type: 'order.risk-rejected',
          entityId: clientOrderId(a.alertKey, 0),
          ownerId,
          accountId: config.account,
          at: Date.now(),
          data: { code: 'BAD_TPS', message: safeTps.reason, symbol: a.symbol, side: a.side },
        })
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
      // Slice F: every fact below is now MEASURED, not assumed — the gate used
      // to be fed a hardcoded 'ok'/false that could never fire (D12: a fact we
      // did not measure is not a fact).
      const nowMs = Date.now()
      const feed = feedHealth.state(feedStreamOf(cfg.market, a.symbol), { at: nowMs })
      // Data age: newest bar's OPEN time vs now. A healthy 1m feed serves a
      // forming bar < 60s old; past quoteStaleMs the feed has missed a close.
      const barTime = quote.bar?.time ?? null
      const q = qualityGates({
        streamState: feed.state, // D33 state from observed fetch history (ok/degraded/stale/disconnected/unknown)
        quoteAgeMs: barTime != null ? nowMs - barTime : null,
        candleGapUnresolved: candleGapUnresolved(barTimes.get(a.symbol) ?? [], BAR_MS),
        orderbookSeqInvalid: false, // depth-dependent fills not active
        depthDependentFill: false,
        instrumentState: 'active',
        riskStateAvailable: true, // risk gate already ran; if it were down, checkOrder would have failed
        fundingAgeMs: null, // funding/OI not wired into this cycle yet
        oiAgeMs: null,
        newsAvailable: null,
        secondaryProviderUp: null,
        // G8.2: what the market plane measured, and what THESE fills price off.
        wsState: ws.state,
        wsGapCount: ws.gaps,
        wsLatencyP95Ms: ws.latencyP95Ms,
        priceSource: 'rest', // quoteFor() prices entries off REST klines
        thresholds: { quoteStaleMs: cfg.quoteStaleMs },
      })
      if (feed.reasons?.length && !q.allowed) {
        // Surface WHY the stream state degraded — the reject reason below
        // already carries the block ids; this line is for the operator log.
        console.log(`[paper] feed ${a.symbol}: ${feed.state} — ${feed.reasons.join('; ')}`)
      }
      if (!q.allowed) {
        const reason = `DATA_QUALITY_BLOCK: ${qualityGateSummary(q)}`
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_reject_data_quality', {
          symbol: a.symbol, block: q.block, degraded: q.degraded,
          wsState: ws.state, wsGaps: ws.gaps,
        })
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
        ownerId,
        source: 'paper',
        symbol: a.symbol,
        side: a.side,
        type: orderType,
        qty: decision.qty, // gate-sized (D7) — never the intent, never cleaned up here
        price: a.price,
        sl: a.sl,
        tps: safeTps.tps,
        tf: a.tf ?? null,
        sessionId, // Slice C (null = pre-session behavior)
      })
const orderUpsert = await m.PaperOrder.updateOne(
{ clientOrderId: orderCid, ownerId },
{ $setOnInsert: orderDoc },
{ upsert: true },
)
// Only the FIRST insert is a new order (D3) — a re-entered pending order is a
// no-op upsert and must not re-publish order.created every cycle.
if (orderUpsert?.upsertedId) {
  await emit(m, {
    type: 'order.created',
    entityId: orderCid,
    ownerId,
    accountId: config.account,
    at: Date.now(),
    data: { symbol: a.symbol, side: a.side, type: orderType, qty: decision.qty, alertKey: a.alertKey },
  })
}

// --- §26.3 DECISION SNAPSHOT: the immutable context the GATE approved.
// One row per order/alert (snapshotId = snap:alertKey, D3), $setOnInsert so a
// crash-replay never rewrites the decision that already happened (D4). The
// quote/bar here are OUR observed 1m data (dataQuality.ageMs measures how old
// they were) — never fabricated (D12).
await recordDecisionSnapshot(m.Snapshot, snapshotRecord({
alertKey: a.alertKey,
ownerId,
symbol: a.symbol,
venue: `binance:${cfg.market}`,
timeframe: a.tf ?? null,
clockTime: Date.now(),
bar: quote.bar ?? null,
quote: quote.bar ? { last: quote.last, time: quote.time } : null,
  dataQuality: {
    source: `binance:kline1m`,
    lastSeenMs: quote.bar?.time ?? quote.time,
    qualityGate: q,
    fidelity: fidelity.code,
    // G8.2: the decision records what the WS plane said at that moment — an
    // expired/absent snapshot shows up as 'unknown' here, not as a silent ok.
    marketWs: { state: ws.state, ageMs: ws.ageMs, gaps: ws.gaps, latencyP95Ms: ws.latencyP95Ms },
  },
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
        { clientOrderId: orderCid, ownerId },
        { $set: { status: 'pending', submittedAt: new Date(), updatedAt: new Date() } },
      )
      await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { status: 'working' } })
        stats.working++
        console.log(`[paper] WORKING ${a.symbol} ${a.side} ${orderType} qty=${decision.qty} — ${fill.reason}`)
        continue
      }
      if (fill.status === 'rejected' || !(fill.filledQty > 0)) {
        const reason = `FILL_REJECTED: ${fill.reason || 'no usable fill'}`
        await m.PaperOrder.updateOne(
          { clientOrderId: orderCid, ownerId },
          { $set: { status: 'rejected', rejectReason: reason, updatedAt: new Date() } },
        )
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { status: 'rejected', rejectReason: reason } })
        stats.rejected++
        auditLog('paper_fill_rejected', { symbol: a.symbol, orderType, reason: String(fill.reason) })
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${reason}`)
        await emit(m, {
          type: 'order.risk-rejected',
          entityId: orderCid,
          ownerId,
          accountId: config.account,
          at: Date.now(),
          data: { code: 'FILL_REJECTED', message: String(fill.reason || 'no usable fill'), symbol: a.symbol, side: a.side },
        })
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
          leverage: ticketLeverageOf(a), // v3 §17.1b intent (null = legacy)
          sessionId, // Slice C (null = pre-session behavior)
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
        { clientOrderId: orderCid, ownerId, status: { $in: ['created', 'riskChecked', 'pending', 'partiallyFilled'] } },
        { $set: orderSet },
      )
      // The ALERT flip is the execution CAS: only when it really happened
      // (received|working -> opened) is this a NEW fill — a crash-retried row
      // stays the same execution and never double-records the ledger (§26.5).
      const alertRes = await m.Alert.updateOne(
        { alertKey: a.alertKey, ownerId, status: { $in: ['received', 'working'] } },
        { $set: { status: 'opened', partialRemain: remain } },
      )
      if (alertRes.modifiedCount > 0) {
        stats.opened++
        const fillId = `fill_${a.alertKey}_${Date.now()}`
        await recordPaperFill(m, paperFillOf(a, fill, {
          intentQty: decision.qty,
          fillId,
          quote,
          decisionTime: Date.now(),
          account: config.account,
          ownerId,
          fidelity: fidelity.code,
          sessionId,
        }))
        await sessionBump(m, sessionId, { orders: 1, fills: 1, positions: 1 })
        console.log(`[paper] OPEN ${a.symbol} ${a.side} ${orderType} qty=${fill.filledQty} @ ${fill.price} fee=${fill.fee}${remain ? ` (partial, remain ${remain})` : ''} (risk ${(decision.notional ?? 0).toFixed(0)})`)
        // §61.17 Phase C: the SAME execution the ledger recorded — the order's
        // terminal/partial state, the fill and the opened position — so exactly
        // one refresh reconciles every view.
        const openedAt = Date.now()
        const evBase = { ownerId, accountId: config.account, at: openedAt }
        await emit(m, { type: remain ? 'order.partially-filled' : 'order.filled', entityId: orderCid, ...evBase, data: { symbol: a.symbol, side: a.side, filledQty: fill.filledQty, price: fill.price, remainder: remain } })
        await emit(m, { type: 'fill.recorded', entityId: fillId, ...evBase, data: { orderId: orderCid, symbol: a.symbol, side: a.side, qty: fill.filledQty, price: fill.price, fee: fill.fee } })
        await emit(m, { type: 'position.opened', entityId: orderCid, ...evBase, data: { symbol: a.symbol, dir: a.side === 'BUY' ? 1 : -1, qty: fill.filledQty, entryPrice: fill.price } })
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
  const remainders = await m.Alert.find({ action: 'ENTRY', ownerId, status: 'opened', partialRemain: { $gt: 0 } })
    .sort({ ts: 1 }).limit(cfg.batch).lean()
  for (const a of remainders) {
    try {
      const pos = await m.Position.findOne({
        account: config.account,
        ownerId,
        source: 'paper',
        status: 'open',
        externalId: clientOrderId(a.alertKey, 0),
      }).lean()
      if (!pos) {
        // Position gone (closed meanwhile): nothing left to fill — clear the debt.
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { partialRemain: null } })
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
        { clientOrderId: orderCid, ownerId, status: 'partiallyFilled' },
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
        await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { partialRemain: null } })
        console.log(`[paper] remainder ${a.symbol} skipped — order ${orderCid} not live anymore (debt cleared)`)
        continue
      }
      const merged = applyFill(pos, fill) // weighted-average entry + accumulated fees
      await m.Position.updateOne(
        { _id: pos._id, status: 'open' },
        { $set: { qty: merged.qty, entryPrice: merged.entryPrice, fees: merged.fees } },
      )
      await m.Alert.updateOne({ alertKey: a.alertKey, ownerId }, { $set: { partialRemain: left } })
      stats.remainder++
      const rfId = `fill_${a.alertKey}_r_${Date.now()}`
      await recordPaperFill(m, paperFillOf(a, fill, {
        intentQty: a.partialRemain,
        fillId: rfId,
        quote,
        decisionTime: Date.now(),
        account: config.account,
        ownerId,
        fidelity: fidelity.code,
        sessionId,
      }))
      await sessionBump(m, sessionId, { fills: 1 })
      console.log(`[paper] REMAINDER ${a.symbol} qty=+${fill.filledQty} @ ${fill.price} (remain ${left ?? 0})`)
      // §61.17 Phase C: the remainder completed the SAME order (D3) — the order
      // moves to filled/partially-filled, one more fill, and the position merge.
      const rfAt = Date.now()
      const rfBase = { ownerId, accountId: config.account, at: rfAt }
      await emit(m, { type: left ? 'order.partially-filled' : 'order.filled', entityId: orderCid, ...rfBase, data: { symbol: a.symbol, side: a.side, filledQty: fill.filledQty, price: fill.price, remainder: left } })
      await emit(m, { type: 'fill.recorded', entityId: rfId, ...rfBase, data: { orderId: orderCid, symbol: a.symbol, side: a.side, qty: fill.filledQty, price: fill.price, fee: fill.fee } })
      await emit(m, { type: 'position.updated', entityId: orderCid, ...rfBase, data: { symbol: a.symbol, qty: merged.qty, entryPrice: merged.entryPrice } })
    } catch (e) {
      stats.errors++
      console.error(`[paper] remainder error ${a.symbol}:`, e?.message || e)
      auditLog('paper_remainder_error', { symbol: a.symbol, error: e?.message || String(e) })
    }
  }

  // --- B) EXIT -------------------------------------------------------------
  const open = await m.Position.find({ account: config.account, ownerId, status: 'open', source: 'paper' })
    .sort({ entryTime: 1 }).lean()
  if (open.length) {
    // B1) follow-up alerts (TV events), chronological, oldest position first
    const symbols = [...new Set(open.map((p) => p.symbol))]
    const follows = await m.Alert.find({
      action: { $in: ['TAKE_PROFIT', 'STOP_LOSS', 'TIME_CLOSE'] },
      ownerId,
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
          const { bars } = await fetchBars({ symbol: apiSymbol(pos.symbol), tf: '1', market: cfg.market, refresh: true, limit: 2 })
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
        await m.Alert.updateOne({ alertKey: f.alertKey, ownerId }, { $set: { status: 'closed' } })
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
        const { bars } = await fetchBars({ symbol: apiSymbol(symbol), tf: '1', market: cfg.market, refresh: true, limit: needBars })
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
          // Per-bot dynamic stop (breakeven / ATR trail) BEFORE the exit scan —
          // the tightened SL is persisted and the SAME bars then decide whether
          // it was hit this very cycle (conservative intra-bar ordering holds).
          if (cfg.execution) {
            const trail = applyTrailingStop(pos, bars, cfg.execution)
            if (trail) {
              await m.Position.updateOne({ _id: pos._id }, { $set: { sl: trail.newSl } })
              auditLog('paper_sl_trailed', { symbol: pos.symbol, positionId: String(pos._id), from: Number(pos.sl), to: trail.newSl })
              pos.sl = trail.newSl
            }
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
  // Slice C: activity-only session event (quiet cycles write nothing; the
  // counters above bumped inline where each fill landed).
  if (sessionId && (stats.opened || stats.closed || stats.rejected || stats.errors)) {
    await sessionEvent(m, sessionId, 'cycle',
      `opened=${stats.opened} closed=${stats.closed} rejected=${stats.rejected} errors=${stats.errors}`)
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
      ownerId: pos.ownerId ?? config.ownerId ?? null,
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
  if (pos.signalKey) await m.Alert.updateOne({ alertKey: pos.signalKey, ownerId: pos.ownerId ?? config.ownerId ?? null }, { $set: { status: 'closed' } })
  console.log(`[paper] CLOSE ${pos.symbol} ${pos.dir === 1 ? 'LONG' : 'SHORT'} @ ${close.exitPrice} pnl=${pnlAbs.toFixed(2)} fees=${close.feesTotal.toFixed(6)} (${exitReason})`)
  // §61.17 Phase C: the position CAS above is the authoritative close — publish
  // it so the positions view drops the row on the next reconcile.
  await emit(m, {
    type: 'position.closed',
    entityId: pos.externalId || String(pos._id),
    ownerId: pos.ownerId ?? config.ownerId ?? null,
    accountId: pos.account ?? config.account,
    at: +new Date(exitTime),
    data: { symbol: pos.symbol, exitPrice: close.exitPrice, pnlAbs, pnlPct, exitReason },
  })
  return true
}

// =============================================================================
//  CLI
// =============================================================================
// =============================================================================
//  Multi-tenant orchestration (roadmap §61.3) — one desk per (ownerId, accountId)
//  paper account. Desks are enumerated from Mongo so a single worker executes
//  every owner's book; legacy rows (ownerId null) still run as the single-desk
//  fallback when no account rows exist. See docs/web-app/user-tenancy-plan.md.
// =============================================================================
const deskKey = (ownerId, accountId) => `${ownerId ?? ''}\u0000${accountId ?? ''}`

export async function listPaperDesks(m) {
  if (!m?.PaperAccount) return []
  // Archived accounts (engine/models/account.mjs) keep their history but are
  // never traded: the desk is paused until an operator un-archives it.
  const rows = await m.PaperAccount.find({ archived: { $ne: true } }, { ownerId: 1, accountId: 1 }).lean().catch(() => [])
  const seen = new Map()
  for (const r of rows ?? []) {
    const accountId = r?.accountId == null ? null : String(r.accountId)
    if (!accountId) continue
    const ownerId = r?.ownerId == null ? null : String(r.ownerId)
    seen.set(deskKey(ownerId, accountId), { ownerId, accountId })
  }
  return [...seen.values()]
}

export async function runAllCycles(opts = {}) {
  const { onlyOwner, sessionByDesk, ...cycleOpts } = opts
  const m = await getModels().catch(() => null)
  if (!m) return { mongoDown: true, desks: 0, results: [] }
  const base = loadRiskConfig()
  const found = await listPaperDesks(m)
  const filtered = onlyOwner != null ? found.filter((d) => d.ownerId === onlyOwner) : found
  const list = filtered.length ? filtered : [{ ownerId: base.ownerId ?? null, accountId: base.account }]
  const results = []
  for (const d of list) {
    const cfg = { ...base, account: d.accountId, ownerId: d.ownerId }
    const deskOpts = { ...cycleOpts }
    const sid = sessionByDesk?.[deskKey(d.ownerId, d.accountId)]
    if (sid) deskOpts.sessionId = sid
    const stats = await runCycle(cfg, deskOpts).catch((e) => ({ errors: 1, error: String(e?.message || e) }))
    results.push({ ownerId: d.ownerId, accountId: d.accountId, stats })
  }
  const mongoDown = results.some((r) => r.stats?.mongoDown)
  const errors = results.reduce((n, r) => n + (r.stats?.errors || 0), 0)
  return { mongoDown, desks: list.length, errors, results }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const all = args.includes('--all')
  const ivIdx = args.indexOf('--interval')
  const intervalSec = ivIdx >= 0 && Number.isFinite(Number(args[ivIdx + 1])) ? Number(args[ivIdx + 1]) : PAPER_DEFAULTS.intervalSec
  const oiIdx = args.indexOf('--owner')
  const ownerArg = oiIdx >= 0 && typeof args[oiIdx + 1] === 'string' && args[oiIdx + 1] ? args[oiIdx + 1] : null
  const config = loadRiskConfig()

  // Slice C: --session <id> joins a session in ANY mode (one-shot included);
  // watch mode additionally auto-starts one unless PAPER_SESSION=off.
  const siIdx = args.indexOf('--session')
  const sessionArg = siIdx >= 0 && typeof args[siIdx + 1] === 'string' && args[siIdx + 1] ? args[siIdx + 1] : null

  if (!watch) {
    // One-shot stays sessionless unless explicitly named (no auto-create —
    // cron-style runs must not spam sessions). A bogus id degrades to null.
    ;(async () => {
      try {
        if (all) {
          const res = await runAllCycles({ onlyOwner: ownerArg, sessionId: sessionArg ?? undefined })
          process.exit(res.mongoDown || res.errors ? 1 : 0)
        }
        const m = await getModels().catch(() => null)
        const sid = sessionArg && m ? await resolvePaperSession(m, config, { sessionId: sessionArg }) : null
        const s = await runCycle(config, sid ? { sessionId: sid } : {})
        process.exit(s.errors ? 1 : 0)
      } catch (e) {
        console.error('[paper]', e)
        process.exit(1)
      }
    })()
  } else {
    console.log(`[paper] watch mode${all ? ' (all desks)' : ''} — every ${intervalSec}s (Ctrl+C to stop)`)
    let activeSessionId = null
    const sessionByDesk = {}
    const boot = (async () => {
      try {
        const m = await getModels()
        if (!m) return
        if (all) {
          const found = await listPaperDesks(m)
          const filtered = ownerArg != null ? found.filter((d) => d.ownerId === ownerArg) : found
          const list = filtered.length ? filtered : [{ ownerId: config.ownerId ?? null, accountId: config.account }]
          for (const d of list) {
            const deskCfg = { ...config, account: d.accountId, ownerId: d.ownerId }
            const sid = await resolvePaperSession(m, deskCfg, { watch: true, sessionId: sessionArg })
            if (sid) sessionByDesk[deskKey(d.ownerId, d.accountId)] = sid
          }
          return
        }
        activeSessionId = await resolvePaperSession(m, config, { watch: true, sessionId: sessionArg })
      } catch (e) {
        console.warn(`[paper] session boot failed (sessionless): ${e?.message || e}`)
      }
    })()
    let running = false
    // Slice F (D9): the watch loop beats the SHARED heartbeat file the same way
    // services/run.mjs does — /health and the services orchestrator's overdue
    // alert then see 'paper' too, so a dead paper executor stops looking like
    // "the market is quiet". One-shot runs deliberately do NOT beat (a cron
    // schedule is not a fixed cycle; it would false-alarm between runs).
    let beats = Number(heartbeatRead(HEARTBEAT_FILE).services?.paper?.count) || 0
    const beatPaper = (patch) => {
      try {
        heartbeatBeat('paper', { intervalSec, ...patch })
      } catch (e) {
        console.warn(`[paper] heartbeat write failed: ${e?.message || e}`)
      }
    }
    const tick = async () => {
      if (running) return
      running = true
      beatPaper({ lastRunAt: new Date().toISOString() })
      try {
        await boot
        const stats = all
          ? await runAllCycles({ onlyOwner: ownerArg, sessionByDesk })
          : await runCycle(config, activeSessionId ? { sessionId: activeSessionId } : {})
        const summary = all
          ? (stats.results ?? []).reduce((acc, r) => ({
            opened: acc.opened + (r.stats?.opened ?? 0),
            closed: acc.closed + (r.stats?.closed ?? 0),
            rejected: acc.rejected + (r.stats?.rejected ?? 0),
            stale: acc.stale + (r.stats?.stale ?? 0),
          }), { opened: 0, closed: 0, rejected: 0, stale: 0 })
          : { opened: stats?.opened ?? 0, closed: stats?.closed ?? 0, rejected: stats?.rejected ?? 0, stale: stats?.stale ?? 0 }
        // Mongo down is a FAILED beat, not a quiet OK (D9: "nothing happened"
        // must never look like "the market is calm").
        if (stats?.mongoDown) {
          beatPaper({ lastErrorAt: new Date().toISOString(), lastError: 'mongo unavailable — cycle skipped' })
        } else {
          beats++
          beatPaper({
            lastOkAt: new Date().toISOString(),
            count: beats,
            lastError: null,
            lastSummary: JSON.stringify(summary).slice(0, 500),
          })
        }
      } catch (e) {
        console.error('[paper] cycle error:', e?.message || e)
        beatPaper({ lastErrorAt: new Date().toISOString(), lastError: String(e?.message || e).slice(0, 300) })
      } finally {
        running = false
      }
    }
    tick()
    const timer = setInterval(tick, intervalSec * 1000)
    const shutdown = async (signal) => {
      clearInterval(timer)
      const ids = activeSessionId ? [activeSessionId] : Object.values(sessionByDesk)
      if (ids.length) {
        try {
          const m = await getModels()
          if (m) { for (const id of ids) await sessionTransition(m, id, 'stopping') }
        } catch { /* best effort on the way out */ }
      }
      console.log(`\n[paper] stopped (${signal})`)
      process.exit(0)
    }
    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
  }
}
