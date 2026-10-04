#!/usr/bin/env node
// =============================================================================
//  TM TRADING - D7d GOLDEN FIXTURES for exec/risk.mjs (roadmap Phase 6, lock)
//
//  "This is the safest module of the whole system — it must not be the only
//  one without tests." Pure core only (evaluate / resolveDay / sizingPct /
//  loadRiskConfig) — no Mongo, no network, runs everywhere like engine/test.mjs.
//  Cases required by the roadmap: over the cap, at the boundary, absurd SL/TP,
//  size = 0, stacked exposure, kill-switch on. Plus leverage / max-open / min-RR
//  / provided-qty budget / halt inheritance across midnight / config parsing.
//
//  Run:  node exec/test-risk.mjs   (wired into `npm test`)
// =============================================================================
import { evaluate, resolveDay, sizingPct, loadRiskConfig, RISK_DEFAULTS, KELLY_MIN_N, auditLog } from './risk.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// --- fixtures ---------------------------------------------------------------
const cfg = { ...RISK_DEFAULTS } // defaults: equity 10000, 1%/trade, cap 5%, lev 5x, maxOpen 5, expo 500%, minRR 1.5
const FRESH = { halted: false, haltReason: '', realizedPnlPct: 0, realizedPnlAbs: 0, tradesOpened: 0, tradesClosed: 0, consecutiveLosses: 0 }
const snap = (over = {}) => ({
  config: over.config || cfg,
  day: { ...FRESH, ...(over.day || {}) },
  open: over.open || [],
  equity: over.equity !== undefined ? over.equity : 10000,
  winStats: over.winStats || null,
})
// BUY 63250.5, SL 63012.1 -> riskDist 238.4 (0.377%); last TP 64000 -> RR 3.14
const LONG = { symbol: 'BTCUSDT', side: 'BUY', entry: 63250.5, sl: 63012.1, tps: [63655, 64000] }
// Wider-stop order (5% dist) so Kelly-size quantities stay under the leverage cap
const WIDE = { symbol: 'ETHUSDT', side: 'BUY', entry: 100, sl: 95, tps: [105, 110] }

// =============================================================================
section('1. Happy path + D7a sizing (fixed-fractional)')

const ok = evaluate(LONG, snap())
check('default order passes every check', ok.ok === true, JSON.stringify(ok))
check('qty = riskAmount / riskDist (1% of 10000 / 238.4)', ok.ok && close(ok.qty, 100 / 238.4), `qty=${ok?.qty}`)
check('riskAmount = 1% equity', ok.ok && close(ok.riskAmount, 100), `risk=${ok?.riskAmount}`)
check('rr = reward/risk to LAST TP', ok.ok && close(ok.rr, (64000 - 63250.5) / 238.4), `rr=${ok?.rr}`)
check('notional = qty * entry', ok.ok && close(ok.notional, ok.qty * 63250.5))

const sized = evaluate(WIDE, snap({ config: { ...cfg, riskPerTradePct: 3 } }))
check('riskPerTradePct=3 -> qty scales (300/5)', sized.ok && close(sized.qty, 60), `qty=${sized?.qty}`)

// =============================================================================
section('2. D7b — daily loss cap: over the line, at the boundary')

check('breach (-6%) -> DAILY_LOSS_CAP', evaluate(LONG, snap({ day: { realizedPnlPct: -6 } })).code === 'DAILY_LOSS_CAP')
check('exactly at cap (-5%) -> DAILY_LOSS_CAP (<= is a breach)', evaluate(LONG, snap({ day: { realizedPnlPct: -5 } })).code === 'DAILY_LOSS_CAP')
check('just under cap (-4.999%) -> allowed', evaluate(LONG, snap({ day: { realizedPnlPct: -4.999 } })).ok === true)

// =============================================================================
section('3. D7c — kill-switch / halt inheritance across midnight')

check('halted flag (kill_switch) -> HALTED', evaluate(LONG, snap({ day: { halted: true, haltReason: 'kill_switch' } })).code === 'HALTED')
check('halted flag (drift) -> HALTED', evaluate(LONG, snap({ day: { halted: true, haltReason: 'drift' } })).code === 'HALTED')
check('halted flag (daily_loss_cap) -> DAILY_LOSS_CAP code', evaluate(LONG, snap({ day: { halted: true, haltReason: 'daily_loss_cap', realizedPnlPct: -5.2 } })).code === 'DAILY_LOSS_CAP')

const latestKill = { halted: true, haltReason: 'kill_switch', realizedPnlPct: -1 }
check('no row today + latest kill_switch -> INHERITED halt', resolveDay(null, latestKill).halted === true && resolveDay(null, latestKill).haltReason === 'kill_switch')
check('no row today + latest daily_loss_cap -> does NOT inherit (new day is clean)', resolveDay(null, { halted: true, haltReason: 'daily_loss_cap' }).halted === false)
check('today row exists (clean) -> authoritative, latest halt ignored', resolveDay({ halted: false, haltReason: '', realizedPnlPct: -0.2 }, latestKill).halted === false)
check('today row exists (halted) -> authoritative', resolveDay({ halted: true, haltReason: 'drift', realizedPnlPct: 0 }, { halted: false }).halted === true)
check('resolveDay carries counters', resolveDay({ halted: false, haltReason: '', realizedPnlPct: -1.5, tradesClosed: 3, consecutiveLosses: 2 }, null).tradesClosed === 3)
check('resolveDay(null, null) -> fresh clean day', resolveDay(null, null).halted === false && resolveDay(null, null).realizedPnlPct === 0)

// =============================================================================
section('4. Absurd SL/TP + zero size')

check('BUY with SL above entry -> BAD_PRICE', evaluate({ ...LONG, sl: 63300 }, snap()).code === 'BAD_PRICE')
check('SELL with SL below entry -> BAD_PRICE', evaluate({ symbol: 'X', side: 'SELL', entry: 100, sl: 95, tps: [90] }, snap()).code === 'BAD_PRICE')
check('SL == entry -> BAD_PRICE (zero distance)', evaluate({ ...LONG, sl: 63250.5 }, snap()).code === 'BAD_PRICE')
check('entry <= 0 -> BAD_PRICE', evaluate({ ...LONG, entry: 0 }, snap()).code === 'BAD_PRICE')
check('missing side/dir -> BAD_PRICE', evaluate({ symbol: 'X', entry: 1, sl: 0.5, tps: [2] }, snap()).code === 'BAD_PRICE')
check('missing symbol -> BAD_PRICE (exposure would be meaningless)', evaluate({ ...LONG, symbol: null }, snap()).code === 'BAD_PRICE')
check('empty tps -> BAD_TPS', evaluate({ ...LONG, tps: [] }, snap()).code === 'BAD_TPS')
check('BUY with TP <= entry -> BAD_TPS', evaluate({ ...LONG, tps: [63000] }, snap()).code === 'BAD_TPS')
check('SELL with TP >= entry -> BAD_TPS', evaluate({ symbol: 'X', side: 'SELL', entry: 100, sl: 105, tps: [110] }, snap()).code === 'BAD_TPS')
check('riskPerTradePct=0 -> SIZE_ZERO', evaluate(LONG, snap({ config: { ...cfg, riskPerTradePct: 0 } })).code === 'SIZE_ZERO')
check('equity=0 -> SIZE_ZERO', evaluate(LONG, snap({ equity: 0 })).code === 'SIZE_ZERO')

// =============================================================================
section('5. Stacked exposure / max open / leverage / min RR')

// Default order notional ~26.5k; stack a same-symbol position of ~24k -> 50.5k > 50k cap (500%)
const stacked = [{ symbol: 'BTCUSDT', dir: 1, qty: 0.38, entryPrice: 63250.5 }] // notional ~24035
check('same-symbol stack over cap -> EXPOSURE', evaluate(LONG, snap({ open: stacked })).code === 'EXPOSURE')
const underStack = [{ symbol: 'BTCUSDT', dir: 1, qty: 0.1, entryPrice: 63250.5 }] // notional ~6325
check('same-symbol stack under cap -> allowed', evaluate(LONG, snap({ open: underStack })).ok === true)
check('5 open positions (other symbols) -> MAX_OPEN', evaluate(LONG, snap({ open: Array.from({ length: 5 }, (_, i) => ({ symbol: `ALT${i}USDT`, dir: 1, qty: 1, entryPrice: 10 })) })).code === 'MAX_OPEN')
check('4 open -> still allowed', evaluate(LONG, snap({ open: Array.from({ length: 4 }, (_, i) => ({ symbol: `ALT${i}USDT`, dir: 1, qty: 1, entryPrice: 10 })) })).ok === true)

check('tight stop computes >5x notional -> LEVERAGE', evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 99.99, tps: [101] }, snap()).code === 'LEVERAGE')
check('leverage exactly 5x -> allowed (boundary)', evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 95, tps: [110] }, snap({ config: { ...cfg, riskPerTradePct: 25 } })).ok === true)
check('leverage 5.00002x -> LEVERAGE (boundary+)', evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 95, tps: [110] }, snap({ config: { ...cfg, riskPerTradePct: 25.0001 } })).code === 'LEVERAGE')

check('RR below min -> MIN_RR', evaluate({ ...LONG, tps: [63300] }, snap()).code === 'MIN_RR')
check('RR exactly 1.5 -> allowed (boundary)', evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 95, tps: [107.5] }, snap()).ok === true)
check('RR 1.4999 -> MIN_RR (boundary-)', evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 95, tps: [107.4999] }, snap()).code === 'MIN_RR')

// =============================================================================
section('6. D7a — provided qty must fit the risk budget')

check('qty within budget -> accepted as-is', evaluate({ ...LONG, qty: 0.1 }, snap()).ok === true && close(evaluate({ ...LONG, qty: 0.1 }, snap()).qty, 0.1))
check('qty risking 2384 > budget 100 -> RISK_BUDGET', evaluate({ ...LONG, qty: 10 }, snap()).code === 'RISK_BUDGET')
check('negative qty -> SIZE_ZERO (falls through to computed size)', evaluate({ ...LONG, qty: -1 }, snap()).ok === true)

// =============================================================================
section('7. D7a — light Kelly (sizingPct)')

const kellyCfg = { ...cfg, kellyFraction: 0.25, kellyMaxPct: 3 }
const goodStats = { n: 25, p: 0.6, b: 2 } // full Kelly = (2*0.6 - 0.4)/2 = 0.4
check('quarter-Kelly = 10% but capped by kellyMaxPct=3 -> 3', close(sizingPct(kellyCfg, goodStats), 3), `pct=${sizingPct(kellyCfg, goodStats)}`)
check('kellyMaxPct raised -> 10% (0.4 * 0.25 * 100)', close(sizingPct({ ...kellyCfg, kellyMaxPct: 99 }, goodStats), 10))
check(`n < ${KELLY_MIN_N} -> falls back to fixed`, close(sizingPct(kellyCfg, { ...goodStats, n: 10 }), 1))
check('kelly off (fraction 0) -> fixed', close(sizingPct({ ...kellyCfg, kellyFraction: 0 }, goodStats), 1))
check('negative edge (p=0.3) -> fixed', close(sizingPct(kellyCfg, { n: 30, p: 0.3, b: 1 }), 1))
check('no stats -> fixed', close(sizingPct(kellyCfg, null), 1))
const kellyEval = evaluate(WIDE, snap({ config: { ...kellyCfg, kellyMaxPct: 99 } , winStats: goodStats }))
check('evaluate uses Kelly qty (1000 / 5)', kellyEval.ok && close(kellyEval.qty, 200), JSON.stringify(kellyEval))

// =============================================================================
section('8. Config parsing (env overrides, invalid ignored)')

const c1 = loadRiskConfig({ RISK_MAX_OPEN: '9', RISK_EQUITY: '25000.5', RISK_CLOSE_ON_HALT: 'true', RISK_MIN_RR: 'abc' })
check('valid env overrides', c1.maxOpen === 9 && c1.equity === 25000.5 && c1.closeOnHalt === true)
check('invalid number keeps default', c1.minRR === RISK_DEFAULTS.minRR)
const c2 = loadRiskConfig({ RISK_CLOSE_ON_HALT: '0' })
check('closeOnHalt=0 -> false', c2.closeOnHalt === false)
check('no env -> pure defaults', JSON.stringify(loadRiskConfig({})) === JSON.stringify(RISK_DEFAULTS))

// =============================================================================
section('9. Audit NDJSON (always writable, no Mongo)')

// Own tmp file — the test must NEVER touch/delete the real logs/risk.ndjson
// (it holds live drift/halt records the dashboard reads).
const auditDir = mkdtempSync(join(tmpdir(), 'tm-risk-audit-'))
const auditFile = join(auditDir, 'risk.ndjson')
const pth = auditLog('d7d_selftest', { hello: true }, auditFile)
const lines = readFileSync(pth, 'utf8').trim().split('\n')
check('auditLog appends one JSON line', lines.length === 1 && JSON.parse(lines[0]).event === 'd7d_selftest')
check('audit entry carries ISO ts', typeof JSON.parse(lines[0]).ts === 'string' && JSON.parse(lines[0]).ts.endsWith('Z'))
auditLog('second', {}, pth)
check('auditLog appends (2nd line, not overwrite)', readFileSync(pth, 'utf8').trim().split('\n').length === 2)
rmSync(auditDir, { recursive: true, force: true }) // tmp only — real audit untouched

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
