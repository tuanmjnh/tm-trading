#!/usr/bin/env node
// =============================================================================
//  TM TRADING - RISK GATE (roadmap Phase 6 / D7) — THE single door every order
//  enters the system through (webhook paper, scanner, AI, future MT5).
//
//  Design: PURE core + thin async IO layer.
//   - `evaluate(order, snapshot)`  — no IO at all. All limits + D7a sizing.
//     Golden-tested in exec/test-risk.mjs (D7d) — this module must never be
//     the only one without tests; it protects the whole account.
//   - `checkOrder / recordOpen / recordClose / halt / resume` — load a Mongo
//     snapshot (risk_state + positions), call the pure core, persist results.
//
//  What lives here (D7):
//   D7a  Position sizing inside the gate: fixed-fractional (risk % of equity
//        per trade) or "light Kelly" (quarter-Kelly, capped, needs >= 20 closed
//        trades of stats, otherwise silently falls back to fixed).
//   D7b  Durable daily counters: `risk_state` keyed (account, utcDay) — a
//        restart at 23:50 must not lose the daily loss cap. Breaching the cap
//        auto-halts the day (haltReason 'daily_loss_cap'), a NEW UTC day starts
//        clean. The gate checks BOTH the halted flag and the raw counter.
//   D7c  Kill-switch: halt() blocks every new order until resume(). Policy for
//        open positions (explicit, tested): they STAY OPEN by default — their
//        SL/TP still protect the account; pass { closePositions: true } to
//        force-close them (paper close at mark). Non-daily halts (kill_switch,
//        drift, manual) INHERIT across midnight until resume(); only
//        'daily_loss_cap' expires with the day.
//   Sanity: leverage, max concurrent positions, per-symbol exposure, SL/TP
//        side checks, minimum reward:risk, zero/absurd size.
//
//  CLI:  node exec/risk.mjs status | halt [reason] [--close] | resume [reason]
// =============================================================================
import { appendNdjson } from '../engine/store.mjs'
import { loadEnv, ROOT } from './env.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

loadEnv() // MONGODB_URI + RISK_* from .env; explicit shell env wins

export const RISK_FILE = join(ROOT, 'logs', 'risk.ndjson')

// =============================================================================
//  Config — defaults here, env override (RISK_*), see docs/data-model.md
// =============================================================================
export const RISK_DEFAULTS = Object.freeze({
  account: 'paper',
  equity: 10000, // starting equity (absolute, currency-agnostic) — RISK_EQUITY
  riskPerTradePct: 1, // D7a fixed-fractional: risk 1% of equity per trade
  kellyFraction: 0, // D7a: 0 = off; 0.25 = quarter-Kelly when stats exist
  kellyMaxPct: 3, // hard cap on Kelly-derived risk % per trade
  dailyLossCapPct: 5, // D7b: halt the day after -5% realized — RISK_DAILY_LOSS_CAP_PCT
  maxLeverage: 5, // notional / equity per trade — RISK_MAX_LEVERAGE
  maxOpen: 5, // max concurrent open positions — RISK_MAX_OPEN
  exposurePct: 500, // per-symbol combined notional as % of equity (5x = matches maxLeverage, binds when same-symbol positions stack) — RISK_EXPOSURE_PCT
  minRR: 1.5, // sanity: reward(last TP) / risk(SL) — RISK_MIN_RR
  closeOnHalt: false, // D7c policy: keep open positions (SL/TP protect)
})

export const KELLY_MIN_N = 20 // sample size before Kelly is allowed to act

const ENV_MAP = Object.freeze({
  RISK_ACCOUNT: ['account', String],
  RISK_EQUITY: ['equity', Number],
  RISK_PER_TRADE_PCT: ['riskPerTradePct', Number],
  RISK_KELLY_FRACTION: ['kellyFraction', Number],
  RISK_KELLY_MAX_PCT: ['kellyMaxPct', Number],
  RISK_DAILY_LOSS_CAP_PCT: ['dailyLossCapPct', Number],
  RISK_MAX_LEVERAGE: ['maxLeverage', Number],
  RISK_MAX_OPEN: ['maxOpen', Number],
  RISK_EXPOSURE_PCT: ['exposurePct', Number],
  RISK_MIN_RR: ['minRR', Number],
  RISK_CLOSE_ON_HALT: ['closeOnHalt', String],
})

/** Defaults <- env. Invalid numbers keep the default (never crash the gate). */
export function loadRiskConfig(env = process.env) {
  const cfg = { ...RISK_DEFAULTS }
  for (const [key, [field, type]] of Object.entries(ENV_MAP)) {
    const raw = env[key]
    if (raw === undefined || raw === '') continue
    if (type === Number) {
      const n = Number(raw)
      if (Number.isFinite(n)) cfg[field] = n
    } else if (type === String && field === 'closeOnHalt') {
      cfg.closeOnHalt = /^(1|true|yes|on)$/i.test(raw)
    } else {
      cfg[field] = raw
    }
  }
  return cfg
}

/** D2: business day = 'YYYY-MM-DD' in UTC. String key, no local timezone. */
export const utcDayToday = (d = new Date()) => d.toISOString().slice(0, 10)

// =============================================================================
//  Pure core
// =============================================================================

/**
 * Resolve the effective day-state for the gate (pure, golden-tested).
 * - Row for TODAY exists  -> it is authoritative (its halted flag decides).
 * - No row today          -> inherit a non-daily halt from the latest row so
 *   the kill-switch / drift halt survives midnight; 'daily_loss_cap' expires.
 */
export function resolveDay(today, latest) {
  if (today) {
    return {
      halted: !!today.halted,
      haltReason: today.halted ? today.haltReason || 'unknown' : '',
      realizedPnlPct: Number(today.realizedPnlPct) || 0,
      realizedPnlAbs: Number(today.realizedPnlAbs) || 0,
      tradesOpened: Number(today.tradesOpened) || 0,
      tradesClosed: Number(today.tradesClosed) || 0,
      consecutiveLosses: Number(today.consecutiveLosses) || 0,
    }
  }
  const inherit = !!(latest && latest.halted && latest.haltReason !== 'daily_loss_cap')
  return {
    halted: inherit,
    haltReason: inherit ? latest.haltReason || 'unknown' : '',
    realizedPnlPct: 0,
    realizedPnlAbs: 0,
    tradesOpened: 0,
    tradesClosed: 0,
    consecutiveLosses: 0,
  }
}

/**
 * D7a — risk % per trade. Fixed-fractional by default. "Light Kelly" only with
 * enough samples (>= KELLY_MIN_N) and a meaningful payoff ratio; result is
 * capped by kellyMaxPct. Anything unusable falls back to fixed — sizing must
 * never crash or return garbage.
 */
export function sizingPct(config, winStats) {
  if (config.kellyFraction > 0 && winStats && winStats.n >= KELLY_MIN_N && winStats.b > 0 && winStats.p > 0) {
    const f = (winStats.b * winStats.p - (1 - winStats.p)) / winStats.b // full Kelly, clamped later
    if (f > 0) return Math.min(f * config.kellyFraction * 100, config.kellyMaxPct)
  }
  return config.riskPerTradePct
}

const reject = (code, message) => ({ ok: false, code, message })

/**
 * THE gate — pure. No IO, no Date.now(), no process.env.
 *
 * @param {object} order   { symbol, side:'BUY'|'SELL' (or dir:1|-1), entry, sl, tps[], qty? }
 * @param {object} snap    { config, day, open:[{symbol,dir,qty,entryPrice}], equity, winStats }
 * @returns {{ok:boolean, code?:string, message?:string, qty?:number,
 *            riskAmount?:number, notional?:number, rr?:number, sizingPct?:number}}
 */
export function evaluate(order, snap) {
  const cfg = snap.config
  const day = snap.day || resolveDay(null, null)
  const open = snap.open || []
  const equity = Number(snap.equity)

  // --- D7c: kill-switch / drift / manual halt first, always ---------------
  if (day.halted) {
    // Daily-cap halts get their own code so callers/logs can tell them apart
    // from an operator kill-switch (same effect, different intent).
    if (day.haltReason === 'daily_loss_cap') return reject('DAILY_LOSS_CAP', `daily loss cap hit (${day.realizedPnlPct.toFixed(2)}%) - new orders blocked until next UTC day`)
    return reject('HALTED', `system halted (${day.haltReason}) - resume required`)
  }
  // --- D7b: raw counter check (belt & suspenders if the flag was missed) --
  if (day.realizedPnlPct <= -cfg.dailyLossCapPct) {
    return reject('DAILY_LOSS_CAP', `daily loss ${day.realizedPnlPct.toFixed(2)}% <= -${cfg.dailyLossCapPct}% cap`)
  }

  // --- Normalize direction -------------------------------------------------
  if (!order.symbol) return reject('BAD_PRICE', 'missing symbol')
  const dir = order.dir === 1 || order.dir === -1 ? order.dir : order.side === 'BUY' ? 1 : order.side === 'SELL' ? -1 : NaN
  if (dir !== 1 && dir !== -1) return reject('BAD_PRICE', 'missing/invalid side or dir')
  const entry = Number(order.entry)
  const sl = Number(order.sl)
  const tps = Array.isArray(order.tps) ? order.tps.map(Number).filter(Number.isFinite) : []
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(sl) || sl <= 0) return reject('BAD_PRICE', `entry/sl must be positive numbers (entry=${order.entry}, sl=${order.sl})`)
  // SL must be on the losing side of entry — same rule the webhook validates,
  // re-checked here because the gate is the LAST line of defense.
  if ((dir === 1 && sl >= entry) || (dir === -1 && sl <= entry)) return reject('BAD_PRICE', `SL on wrong side: entry=${entry} sl=${sl} dir=${dir === 1 ? 'LONG' : 'SHORT'}`)
  if (tps.length === 0) return reject('BAD_TPS', 'tps must be a non-empty array')
  for (const t of tps) {
    if ((dir === 1 && t <= entry) || (dir === -1 && t >= entry)) return reject('BAD_TPS', `TP ${t} on wrong side of entry ${entry} (dir=${dir})`)
  }

  const riskDist = Math.abs(entry - sl)
  if (!(riskDist > 0)) return reject('BAD_PRICE', 'SL == entry -> zero risk distance')

  // --- D7a: sizing --------------------------------------------------------
  const pct = sizingPct(cfg, snap.winStats)
  const riskAmount = (equity * pct) / 100
  let qty
  if (Number.isFinite(order.qty) && order.qty > 0) {
    qty = Number(order.qty) // caller pre-sized: still verified against every cap below
  } else {
    qty = riskAmount / riskDist
  }
  if (!(qty > 0) || !Number.isFinite(qty)) return reject('SIZE_ZERO', `computed qty=${qty} (pct=${pct}, equity=${equity}, riskDist=${riskDist})`)
  if (order.qty !== undefined) {
    const providedRisk = qty * riskDist
    if (providedRisk > riskAmount * (1 + 1e-9)) {
      return reject('RISK_BUDGET', `provided qty risks ${providedRisk.toFixed(2)} > budget ${riskAmount.toFixed(2)} (${pct}% of equity)`)
    }
  }

  const notional = qty * entry

  // --- Sanity caps --------------------------------------------------------
  const lev = notional / equity
  if (lev > cfg.maxLeverage) return reject('LEVERAGE', `notional ${notional.toFixed(2)} / equity ${equity.toFixed(2)} = ${lev.toFixed(2)}x > max ${cfg.maxLeverage}x`)

  const sameSymbolNotional = open.filter((p) => p.symbol === order.symbol).reduce((s, p) => s + Math.abs((Number(p.qty) || 0) * (Number(p.entryPrice) || 0)), 0)
  const expoCap = (equity * cfg.exposurePct) / 100
  if (sameSymbolNotional + notional > expoCap * (1 + 1e-9)) {
    return reject('EXPOSURE', `${order.symbol} notional ${(sameSymbolNotional + notional).toFixed(2)} > cap ${expoCap.toFixed(2)} (${cfg.exposurePct}% of equity)`)
  }
  if (open.length >= cfg.maxOpen) return reject('MAX_OPEN', `already ${open.length} open positions (max ${cfg.maxOpen})`)

  // --- Sanity: minimum reward:risk (last TP, same convention as fmtRR) ----
  const rr = (((tps[tps.length - 1] - entry) * dir) / riskDist)
  if (rr < cfg.minRR) return reject('MIN_RR', `RR to last TP = ${rr.toFixed(2)} < min ${cfg.minRR}`)

  return { ok: true, qty, notional, rr, riskAmount, sizingPctUsed: pct }
}

// =============================================================================
//  IO layer (Mongo, fail-soft) — snapshot / persist / halt / resume
// =============================================================================

let models = null
async function getModels() {
  if (models) return models
  const db = await import('../engine/db.mjs')
  const conn = await db.connectMongo() // fail-soft: null when unavailable
  if (!conn) return null
  const { RiskState, Position } = await import('../engine/models/index.mjs')
  try {
    await RiskState.syncIndexes()
  } catch {
    // index already there or not creatable — insert still works
  }
  models = { RiskState, Position }
  return models
}

/**
 * Audit trail: NDJSON always writable (no Mongo needed) — logs/risk.ndjson.
 * Tests pass their own `file` so they never touch (or delete) the real audit.
 */
export function auditLog(event, data = {}, file = RISK_FILE) {
  return appendNdjson(file, { ts: new Date().toISOString(), event, ...data })
}

/** Current equity = starting equity + realized PnL of all closed positions. */
export async function equityNow(config) {
  const m = await getModels()
  if (!m) return config.equity
  const [agg] = await m.Position.aggregate([
    { $match: { account: config.account, status: 'closed' } },
    { $group: { _id: null, sum: { $sum: '$pnlAbs' } } },
  ])
  return config.equity + (agg?.sum || 0)
}

/** Win/loss stats for light Kelly (last 100 closed trades). null = not usable. */
export async function loadWinStats(config) {
  const m = await getModels()
  if (!m) return null
  const rows = await m.Position.aggregate([
    { $match: { account: config.account, status: 'closed', pnlAbs: { $ne: null } } },
    { $sort: { entryTime: -1 } },
    { $limit: 100 },
    { $group: { _id: null, n: { $sum: 1 }, wins: { $sum: { $cond: [{ $gt: ['$pnlAbs', 0] }, 1, 0] } }, winSum: { $sum: { $cond: [{ $gt: ['$pnlAbs', 0] }, '$pnlAbs', 0] } }, lossSum: { $sum: { $cond: [{ $lt: ['$pnlAbs', 0] }, { $abs: '$pnlAbs' }, 0] } }, losses: { $sum: { $cond: [{ $lt: ['$pnlAbs', 0] }, 1, 0] } } } },
  ])
  if (!rows.length) return null
  const r = rows[0]
  if (!r.n) return null
  // Payoff ratio b = avgWin / avgLoss (NOT sum/count — that inflates b and
  // silently over-sizes Kelly).
  const avgWin = r.wins > 0 ? r.winSum / r.wins : 0
  const avgLoss = r.losses > 0 ? r.lossSum / r.losses : 0
  return {
    n: r.n,
    p: r.wins / r.n,
    b: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 100 : 0,
  }
}

/** Snapshot for `evaluate` — today's row + inherited halt + open positions. */
export async function loadSnapshot(config) {
  const m = await getModels()
  const today = utcDayToday()
  if (!m) {
    // Mongo down: fail-soft with a FRESH day (no halt, no counters). The gate
    // still runs its pure checks; D7b counters are unavailable — callers see
    // `mongoDown` and must not pretend the cap is enforced.
    return { config, day: resolveDay(null, null), open: [], equity: config.equity, winStats: null, mongoDown: true }
  }
  const [todayRow, latest] = await Promise.all([
    m.RiskState.findOne({ account: config.account, utcDay: today }).lean(),
    m.RiskState.findOne({ account: config.account }).sort({ utcDay: -1 }).lean(),
  ])
  const [open, equity, winStats] = await Promise.all([
    m.Position.find({ account: config.account, status: 'open' }).lean(),
    equityNow(config),
    loadWinStats(config),
  ])
  return { config, day: resolveDay(todayRow, latest), open, equity, winStats, mongoDown: false }
}

/** Async gate: load snapshot -> pure evaluate. */
export async function checkOrder(order, config = loadRiskConfig()) {
  const snap = await loadSnapshot(config)
  const decision = evaluate(order, snap)
  auditLog(decision.ok ? 'order_allowed' : 'order_rejected', {
    account: config.account,
    symbol: order.symbol,
    side: order.side || (order.dir === 1 ? 'BUY' : 'SELL'),
    code: decision.ok ? 'OK' : decision.code,
    message: decision.ok ? `qty=${decision.qty} notional=${decision.notional?.toFixed(2)} rr=${decision.rr?.toFixed(2)}` : decision.message,
    mongoDown: snap.mongoDown,
  })
  return { ...decision, mongoDown: snap.mongoDown }
}

/**
 * Create-or-get today's row, INHERITING a non-daily halt from the latest row
 * (kill-switch / drift must survive midnight even when the first write of the
 * new day is a position close, not a halt()). Race-safe on the unique key.
 */
export async function ensureTodayRow(account, extra = {}) {
  const m = await getModels()
  if (!m) return null
  const today = utcDayToday()
  const existing = await m.RiskState.findOne({ account, utcDay: today }).lean()
  if (existing) return existing
  const latest = await m.RiskState.findOne({ account }).sort({ utcDay: -1 }).lean()
  const inherit = latest && latest.halted && latest.haltReason !== 'daily_loss_cap'
    ? { halted: true, haltReason: latest.haltReason, haltedAt: latest.haltedAt }
    : {}
  try {
    return await m.RiskState.create({ account, utcDay: today, ...inherit, ...extra })
  } catch (e) {
    if (e?.code === 11000) return m.RiskState.findOne({ account, utcDay: today }).lean() // lost the race, still fine
    throw e
  }
}

/** D7b: count an order open. Call AFTER checkOrder returned ok. */
export async function recordOpen({ config = loadRiskConfig(), symbol, qty, dir, entryPrice, sl, tps, externalId = null, alertKey = null, method = 'vsa' } = {}) {
  const m = await getModels()
  if (!m) return { opened: false, mongoDown: true }
  const pos = await m.Position.create({
    account: config.account,
    source: 'paper',
    externalId,
    symbol,
    dir,
    qty,
    entryPrice,
    entryTime: new Date(),
    sl: sl ?? null,
    tps: tps ?? [],
    status: 'open',
    method,
    paramsHash: null,
    signalKey: alertKey,
  })
  await ensureTodayRow(config.account) // create today's row if missing (inherits kill-switch)
  await m.RiskState.updateOne(
    { account: config.account, utcDay: utcDayToday() },
    { $inc: { tradesOpened: 1 } },
    { upsert: true },
  )
  auditLog('position_opened', { account: config.account, symbol, dir, qty, entryPrice, alertKey, positionId: String(pos._id) })
  return { opened: true, positionId: String(pos._id) }
}

/**
 * D7b: count a close + realized PnL (day counters) and auto-halt the day when
 * the loss cap is breached. `pnlPctOnEquity` is what lands in realizedPnlPct
 * (day-level, % of equity); position.pnlPct stays trade-level (% of notional).
 * NOTE: caller closes the Position doc first, then calls this.
 */
export async function recordClose({ config = loadRiskConfig(), symbol, pnlAbs, pnlPctOnEquity, win, equity, reason = 'unknown' } = {}) {
  const m = await getModels()
  if (!m) return { closed: false, mongoDown: true }
  await ensureTodayRow(config.account)
  const row = await m.RiskState.findOne({ account: config.account, utcDay: utcDayToday() })
  row.realizedPnlAbs += pnlAbs
  row.realizedPnlPct += pnlPctOnEquity
  row.tradesClosed += 1
  row.consecutiveLosses = win ? 0 : row.consecutiveLosses + 1
  // Auto-halt when the cap is breached (visibility + belt & suspenders; the
  // gate also checks the raw counter). A stronger halt reason is never downgraded.
  const alreadyStrong = row.halted && row.haltReason !== 'daily_loss_cap'
  if (!alreadyStrong && row.realizedPnlPct <= -config.dailyLossCapPct) {
    row.halted = true
    row.haltReason = 'daily_loss_cap'
    row.haltedAt = new Date()
  }
  await row.save()
  auditLog('position_closed', { account: config.account, symbol, reason, pnlAbs, pnlPctOnEquity, win, dayPnlPct: row.realizedPnlPct, halted: row.halted, haltReason: row.haltReason })
  return { closed: true, day: resolveDay(row, null), equity }
}

/**
 * D7c: emergency halt. Blocks every new order (incl. paper/scanner/AI) until
 * resume(). Open positions: stay open by default (their SL/TP still protect);
 * { closePositions: true } forces the caller to flatten them (see paper.mjs).
 */
export async function halt(reason = 'manual', { config = loadRiskConfig(), closePositions = false, by = 'cli' } = {}) {
  const m = await getModels()
  if (!m) return { halted: false, mongoDown: true }
  await ensureTodayRow(config.account)
  const row = await m.RiskState.findOne({ account: config.account, utcDay: utcDayToday() })
  row.halted = true
  row.haltReason = reason
  row.haltedAt = new Date()
  await row.save()
  let flattened = 0
  if (closePositions) {
    const open = await m.Position.find({ account: config.account, status: 'open' }).lean()
    flattened = open.length
  }
  auditLog('halt', { account: config.account, reason, by, closePositions, openPositions: flattened })
  return { halted: true, reason, closePositions, openPositions: flattened }
}

/** Resume after kill-switch / drift / manual halt (operator action only). */
export async function resume(reason = 'manual', { config = loadRiskConfig(), by = 'cli' } = {}) {
  const m = await getModels()
  if (!m) return { resumed: false, mongoDown: true }
  const row = await ensureTodayRow(config.account)
  if (!row.halted && !row.haltReason) {
    auditLog('resume_noop', { account: config.account, by })
    return { resumed: true, noop: true }
  }
  const doc = await m.RiskState.findOne({ account: config.account, utcDay: utcDayToday() })
  doc.halted = false
  doc.haltReason = ''
  doc.haltedAt = null
  await doc.save()
  auditLog('resume', { account: config.account, reason, by })
  return { resumed: true, reason }
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [, , cmd, ...rest] = process.argv // [node, script, command, ...args]
  const config = loadRiskConfig()
  const flag = (f) => rest.includes(f)
  const args = rest.filter((a) => !a.startsWith('--'))
  const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))

  try {
    if (cmd === 'status') {
      const snap = await loadSnapshot(config)
      out({ account: config.account, day: snap.day, equity: snap.equity, openPositions: snap.open.length, winStats: snap.winStats, mongoDown: snap.mongoDown })
    } else if (cmd === 'halt') {
      out(await halt(args[0] || 'manual', { config, closePositions: flag('--close') }))
    } else if (cmd === 'resume') {
      out(await resume(args[0] || 'manual', { config }))
    } else {
      console.log('Usage: node exec/risk.mjs status | halt [reason] [--close] | resume [reason]')
      process.exit(cmd ? 1 : 0)
    }
  } catch (e) {
    console.error('[risk] error:', e?.message || e)
    process.exit(1)
  }
  process.exit(0)
}
