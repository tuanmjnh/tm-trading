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
import { evaluate, evaluateModify, evaluatePartialClose, resolveDay, sizingPct, loadRiskConfig, RISK_DEFAULTS, KELLY_MIN_N, auditLog, resolvedBalance } from './risk.mjs'
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
// An unexpected throw must NEVER hide the summary line (same guard as the other
// hand-rolled suites).
process.on('uncaughtException', (e) => {
  fail++
  console.log(`  FAIL (unexpected throw) — ${e && e.message}`)
  console.log(`\nFAIL — ${pass} pass, ${fail} fail\n`)
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  fail++
  console.log(`  FAIL (unhandled rejection) — ${(e && e.message) || e}`)
  console.log(`\nFAIL — ${pass} pass, ${fail} fail\n`)
  process.exit(1)
})

// --- fixtures ---------------------------------------------------------------
const cfg = { ...RISK_DEFAULTS } // defaults: equity 10000, 1%/trade, cap 5%, lev 5x, maxOpen 5, expo 500%, minRR 1.5
const FRESH = { halted: false, haltReason: '', realizedPnlPct: 0, realizedPnlAbs: 0, tradesOpened: 0, tradesClosed: 0, consecutiveLosses: 0 }
const snap = (over = {}) => ({
  config: over.config || cfg,
  day: { ...FRESH, ...(over.day || {}) },
  open: over.open || [],
  equity: over.equity !== undefined ? over.equity : 10000,
  balance: over.balance !== undefined ? over.balance : 10000, // §20 realized balance
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
section('4b. TP ladder with defective levels — REJECT, never coerce or drop')

// DECISION (fail-closed, 2026-10-04). An element that is not a finite number is
// REJECTED with its index. Coercion FABRICATES a level (Number(null) === Number('')
// === Number([]) === 0, Number(true) === 1) and silently dropping the gap shortens
// a ladder the alert contract indexes (`tps[level-1]`) while destroying the only
// evidence of the defect. A stored `tps[0] = 0` then made findFirstExit's
// `high >= tp1` test trivially true — a long "closed at TP" at price 0.
const TPS_SELL = (tps) => evaluate({ symbol: 'X', side: 'SELL', entry: 100, sl: 105, tps }, snap())
const TPS_BUY = (tps) => evaluate({ symbol: 'X', side: 'BUY', entry: 100, sl: 95, tps }, snap())
const namesIndex = (r, i) => new RegExp(`tps\\[${i}\\]`).test(r.message || '')

check('SELL tps=[null] -> BAD_TPS naming index 0', TPS_SELL([null]).code === 'BAD_TPS' && namesIndex(TPS_SELL([null]), 0), JSON.stringify(TPS_SELL([null])))
check('SELL tps=[""] -> BAD_TPS naming index 0', TPS_SELL(['']).code === 'BAD_TPS' && namesIndex(TPS_SELL(['']), 0))
check('SELL tps=["  "] (blank, not empty) -> BAD_TPS (Number(" ") === 0 trap)', TPS_SELL(['  ']).code === 'BAD_TPS')
check('SELL tps=[void 0] -> BAD_TPS naming index 0', TPS_SELL([undefined]).code === 'BAD_TPS' && namesIndex(TPS_SELL([undefined]), 0))
check('SELL tps=[NaN] -> BAD_TPS', TPS_SELL([NaN]).code === 'BAD_TPS')
check('SELL tps=["abc"] -> BAD_TPS (garbage is not silently dropped either)', TPS_SELL(['abc']).code === 'BAD_TPS')
check('BUY tps=[null] -> BAD_TPS', TPS_BUY([null]).code === 'BAD_TPS')
check('BUY tps=[true] -> BAD_TPS (Number(true) === 1 would invent a level)', TPS_BUY([true]).code === 'BAD_TPS')
check('BUY tps=[[]] -> BAD_TPS (Number([]) === 0 would invent a level)', TPS_BUY([[]]).code === 'BAD_TPS')

// The index must point at the DEFECTIVE element (not always 0), and a defect
// anywhere in the ladder must reject the whole order.
check('BUY tps=[null,110] -> BAD_TPS naming index 0 (the doc that used to be stored)', namesIndex(TPS_BUY([null, 110]), 0), JSON.stringify(TPS_BUY([null, 110])))
check('SELL tps=[90,null] -> BAD_TPS naming index 1', TPS_SELL([90, null]).code === 'BAD_TPS' && namesIndex(TPS_SELL([90, null]), 1), JSON.stringify(TPS_SELL([90, null])))
check('SELL tps=[null,80] -> BAD_TPS naming index 0 (gap NOT dropped)', TPS_SELL([null, 80]).code === 'BAD_TPS' && namesIndex(TPS_SELL([null, 80]), 0), JSON.stringify(TPS_SELL([null, 80])))
check('SELL tps=[90,"",80] -> BAD_TPS naming index 1', namesIndex(TPS_SELL([90, '', 80]), 1))
check('SELL tps=[null,""] -> BAD_TPS naming the FIRST defect (index 0)', namesIndex(TPS_SELL([null, '']), 0))
// A level must be a POSITIVE price: on a SHORT the side check (t >= entry) does not
// catch 0 or a negative level, so `tps:[0]` used to be approved with rr computed
// against price 0 (probe: {ok:true, rr:20}).
check('SELL tps=[0] -> BAD_TPS naming index 0 (a zero level is not a price)', TPS_SELL([0]).code === 'BAD_TPS' && namesIndex(TPS_SELL([0]), 0), JSON.stringify(TPS_SELL([0])))
check('SELL tps=[-5] -> BAD_TPS naming index 0 (negative level)', TPS_SELL([-5]).code === 'BAD_TPS' && namesIndex(TPS_SELL([-5]), 0), JSON.stringify(TPS_SELL([-5])))
check('SELL tps=[90,0] -> BAD_TPS naming index 1 (zero is not a usable last TP)', TPS_SELL([90, 0]).code === 'BAD_TPS' && namesIndex(TPS_SELL([90, 0]), 1), JSON.stringify(TPS_SELL([90, 0])))
check('BUY tps=[0] -> BAD_TPS', TPS_BUY([0]).code === 'BAD_TPS')

// Valid ladders must keep working (no over-blocking).
check('clean SELL tps=[90] -> allowed, rr 2', TPS_SELL([90]).ok === true && close(TPS_SELL([90]).rr, 2))
check('clean BUY tps=[110] -> allowed, rr 2', TPS_BUY([110]).ok === true && close(TPS_BUY([110]).rr, 2))
check('numeric strings still accepted (["90"]) -> rr 2', TPS_SELL(['90']).ok === true && close(TPS_SELL(['90']).rr, 2))
check('multi-level clean ladder [110,120] -> allowed, rr from the LAST level (4)', TPS_BUY([110, 120]).ok === true && close(TPS_BUY([110, 120]).rr, 4))
check('tps not an array -> BAD_TPS (still becomes [])', TPS_BUY(undefined).code === 'BAD_TPS' && TPS_SELL(null).code === 'BAD_TPS' && TPS_BUY('nope').code === 'BAD_TPS')

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
section('10. evaluateModify — SL/TP changes through the gate (Phase 7P D7e)')

// qty 10, entry 100, sl 95: current risk 50, budget 1% of 10000 = 100.
const MP = { symbol: 'BTCUSDT', dir: 1, entryPrice: 100, sl: 95, tps: [110, 120], qty: 10, status: 'open' }
const mod = (pos, patch, over = {}) => evaluateModify(pos, patch, snap(over))

const m1 = mod(MP, { sl: 97 })
check('tighten SL -> ok, result carries sl/tps/rr/budget', m1.ok === true && m1.sl === 97 && m1.tps[0] === 110 && close(m1.rr, 20 / 3) && close(m1.riskAmount, 30) && close(m1.budget, 100), JSON.stringify(m1))
const m2 = mod(MP, { tps: [115, 130] })
check('tps-only patch keeps the current SL', m2.ok === true && m2.sl === 95 && m2.tps[0] === 115 && close(m2.rr, 30 / 5))
check('sl + tps together', (() => { const r = mod(MP, { sl: 96, tps: [112] }); return r.ok && r.sl === 96 && close(r.rr, 12 / 4) })())

check('halted (kill_switch) -> HALTED', mod(MP, { sl: 97 }, { day: { halted: true, haltReason: 'kill_switch' } }).code === 'HALTED')
check('halted (daily_loss_cap) -> DAILY_LOSS_CAP', mod(MP, { sl: 97 }, { day: { halted: true, haltReason: 'daily_loss_cap', realizedPnlPct: -5.2 } }).code === 'DAILY_LOSS_CAP')
check('raw cap breach (flag missed) -> DAILY_LOSS_CAP', mod(MP, { sl: 97 }, { day: { realizedPnlPct: -5.5 } }).code === 'DAILY_LOSS_CAP')

check('SL past entry (long) -> BAD_SL (simulation side rule)', mod(MP, { sl: 105 }).code === 'BAD_SL')
check('SL == entry -> BAD_SL', mod(MP, { sl: 100 }).code === 'BAD_SL')
check('TP below entry -> BAD_TPS', mod(MP, { tps: [90] }).code === 'BAD_TPS')
check('defective TP level -> BAD_TPS naming its index', /tps\[1\]/.test(mod(MP, { tps: [110, null] }).message || ''))
check('empty patch -> EMPTY_PATCH', mod(MP, {}).code === 'EMPTY_PATCH')
check('position qty <= 0 -> BAD_QTY', mod({ ...MP, qty: 0 }, { sl: 97 }).code === 'BAD_QTY')

const noSl = { ...MP, sl: null }
check('no-SL position + tps-only patch -> BAD_SL (scanner needs a stop)', mod(noSl, { tps: [115] }).code === 'BAD_SL')
check('no-SL position + sl patch -> ok (gives it one)', mod(noSl, { sl: 97 }).ok === true)
check('no-SL position: fresh SL must fit the budget', mod(noSl, { sl: 88 }).code === 'RISK_BUDGET') // 10 * 12 = 120 > 100

check('widen within budget -> ok', mod(MP, { sl: 93 }).ok === true) // risk 70 <= 100
check('widen exactly TO the budget -> ok (boundary)', mod(MP, { sl: 90 }).ok === true) // risk 100
check('widen past the budget -> RISK_BUDGET', mod(MP, { sl: 88 }).code === 'RISK_BUDGET') // risk 120 > 100 and > current 50
const over = { ...MP, qty: 30 } // current risk 150 > budget 100 (drifted)
check('over-budget position: TIGHTENING below current risk -> ok', mod(over, { sl: 96 }).ok === true) // 120 <= current 150
check('over-budget position: widening further -> RISK_BUDGET', mod(over, { sl: 94 }).code === 'RISK_BUDGET') // 180 > 100 and > 150

check('resulting RR below min -> MIN_RR', mod(MP, { tps: [104] }).code === 'MIN_RR') // rr 4/5 = 0.8
check('resulting RR exactly min -> ok (boundary)', mod(MP, { tps: [107.5] }).ok === true) // rr 1.5
const SHORT = { symbol: 'X', dir: -1, entryPrice: 100, sl: 105, tps: [90, 80], qty: 10, status: 'open' }
check('short: tighten SL -> ok', mod(SHORT, { sl: 103 }).ok === true)
check('short: widen SL past budget -> RISK_BUDGET', mod(SHORT, { sl: 112 }).code === 'RISK_BUDGET') // 10 * 12 = 120
check('short: SL below entry -> BAD_SL', mod(SHORT, { sl: 95 }).code === 'BAD_SL')

// =============================================================================
section('11b. evaluate — manual ticket riskPct override (v3 §16.1-16.2)')

// riskDist 238.4 (LONG): config sizing = 1% of 10000 = 100. An explicit riskPct
// overrides the config/kelly sizing while every cap still binds.
const pct2 = evaluate({ ...WIDE, pct: 2 }, snap({ config: { ...cfg, riskPerTradePct: 1 } })) // riskDist 5 -> qty 40
check('happy pct override: qty sized to 2% equity', pct2.ok === true && close(pct2.qty, 40) && close(pct2.sizingPctUsed, 2), JSON.stringify(pct2))
check('absent pct keeps config sizing', (() => {
  const r = evaluate(WIDE, snap({ config: { ...cfg, riskPerTradePct: 1 } }))
  return r.ok === true && close(r.qty, 20) && close(r.sizingPctUsed, 1)
})())
check('aggressive pct still hits the leverage cap', evaluate({ ...WIDE, pct: 50 }, snap({ equity: 10000 })).code === 'LEVERAGE') // qty 1000 -> 10x
check('provided qty + pct: qty wins, budget uses the override pct', (() => {
  const r = evaluate({ ...WIDE, qty: 10, pct: 1 }, snap({ equity: 10000 }))
  return r.ok === true && close(r.qty, 10) && close(r.riskAmount, 100)
})())
check('pre-sized qty over the override budget -> RISK_BUDGET', evaluate({ ...WIDE, qty: 30, pct: 1 }, snap({ equity: 10000 })).code === 'RISK_BUDGET') // 30*5=150 > 100
check('invalid pct (0 / 101) falls back to config sizing', (() => {
  const r = evaluate({ ...WIDE, pct: 150 }, snap({ config: { ...cfg, riskPerTradePct: 4 }, equity: 10000 }))
  return r.ok === true && close(r.sizingPctUsed, 4)
})())

// =============================================================================
section('11. evaluatePartialClose — close/partial close through the gate (Phase 7P D7e)')

const CP = { symbol: 'BTCUSDT', qty: 2, entryPrice: 100, status: 'open' }
const pclose = (pos, target, over = {}) => evaluatePartialClose(pos, target, snap(over))

const p1 = pclose(CP, { pct: 50 })
check('pct 50 of qty 2 -> closeQty 1, remaining 1', p1.ok === true && close(p1.closeQty, 1) && close(p1.remainingQty, 1), JSON.stringify(p1))
check('abs qty accepted', (() => { const r = pclose(CP, { qty: 0.75 }); return r.ok && close(r.closeQty, 0.75) && close(r.remainingQty, 1.25) })())
check('qty == position qty -> full close (remaining 0)', (() => { const r = pclose(CP, { qty: 2 }); return r.ok && r.closeQty === 2 && r.remainingQty === 0 })())
check('pct 100 -> full close', pclose(CP, { pct: 100 }).ok === true && pclose(CP, { pct: 100 }).remainingQty === 0)

check('qty > position -> TOO_LARGE', pclose(CP, { qty: 3 }).code === 'TOO_LARGE')
check('pct 150 -> BAD_PCT', pclose(CP, { pct: 150 }).code === 'BAD_PCT')
check('pct 0 -> BAD_PCT', pclose(CP, { pct: 0 }).code === 'BAD_PCT')
check('neither qty nor pct -> MISSING', pclose(CP, {}).code === 'MISSING')
check('qty AND pct -> AMBIGUOUS', pclose(CP, { qty: 1, pct: 50 }).code === 'AMBIGUOUS')
check('position qty 0 -> BAD_QTY', pclose({ ...CP, qty: 0 }, { pct: 50 }).code === 'BAD_QTY')
check('qty <= 0 -> BAD_QTY', pclose(CP, { qty: -1 }).code === 'BAD_QTY')

check('halted (kill_switch) -> HALTED (frozen desk, closes too)', pclose(CP, { pct: 50 }, { day: { halted: true, haltReason: 'kill_switch' } }).code === 'HALTED')
check('raw daily-cap breach -> DAILY_LOSS_CAP', pclose(CP, { pct: 50 }, { day: { realizedPnlPct: -6 } }).code === 'DAILY_LOSS_CAP')
check('entryPrice 0 -> BAD_PRICE', pclose({ ...CP, entryPrice: 0 }, { pct: 50 }).code === 'BAD_PRICE')
check('entryPrice garbage -> BAD_PRICE', pclose({ ...CP, entryPrice: 'x' }, { pct: 50 }).code === 'BAD_PRICE')

// =============================================================================
section('12. §20/§21 paper account state — spent balance blocks NEW opens only')

check('balance <= 0 -> ACCOUNT_INSOLVENT', evaluate(LONG, snap({ balance: -5 })).code === 'ACCOUNT_INSOLVENT')
check('balance == 0 -> ACCOUNT_INSOLVENT', evaluate(LONG, snap({ balance: 0 })).code === 'ACCOUNT_INSOLVENT')
check('positive balance -> allowed (default snap has 10000)', evaluate(LONG, snap()).ok === true)
check('insolvency beats sizing (even a zero-risk order)', evaluate({ ...WIDE, qty: 0.001 }, snap({ balance: -1 })).code === 'ACCOUNT_INSOLVENT')
check('balance missing in snap -> fail-open (never guessed, D12)', evaluate(LONG, { config: cfg, day: FRESH, open: [], equity: 10000, winStats: null }).ok === true)
check('closed desk freezes nothing — evaluateModify still routes to halt, not balance', (() => {
  // modify never re-checks balance (protective); a spent account may still de-risk
  const r = evaluateModify({ symbol: 'X', dir: 1, entryPrice: 100, sl: 95, tps: [110], qty: 2 }, { sl: 94 }, snap({ balance: -1 }))
  return r.ok === true
})())

section('12b. resolvedBalance — frozen paper seed wins over env, env over default')
check('frozen initialBalance wins over a later config change', resolvedBalance(12000, 10000) === 12000)
check('no seed -> config equity', resolvedBalance(null, 15000) === 15000)
check('garbage seed -> config equity', resolvedBalance('x', 15000) === 15000)
check('no seed no equity -> 10000 default', resolvedBalance(null, null) === 10000)

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
