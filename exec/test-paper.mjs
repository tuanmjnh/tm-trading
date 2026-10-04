#!/usr/bin/env node
// =============================================================================
//  TM TRADING — fixtures for the PURE helpers of exec/paper.mjs
//
//  Why this file exists: `findFirstExit` decides at WHAT PRICE a paper position
//  closes, and until 2026-10-04 it had no test at all. The bug it now guards
//  against: with `tp1 = 0` (exactly what `Number(null)` gives for a gap in the
//  stored ladder) the `high >= tp1` test is trivially true, so a long was
//  "closed at TP" at price 0 — a fabricated catastrophic fill that also tripped
//  recordClose's daily-loss auto-halt.
//
//  Pure logic + source guards only: no Mongo, no network, no API key, and no
//  call into runCycle (which needs a database — see the guards at the end).
//
//  Run:  node exec/test-paper.mjs   (wired into `npm test`)
// =============================================================================
import { readFileSync } from 'node:fs'

import { findFirstExit, followExitPrice, sanitizeTps } from './paper.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
// An unexpected throw must NEVER hide the summary line.
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${e?.message || e}`); finish() })

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// Two clean bars, then a bar that gaps below the stop, then a probe bar.
const BARS = [
  { time: 1000, open: 100, high: 103, low: 99, close: 102, volume: 1 }, // quiet for SL 95 / TP 110
  { time: 2000, open: 102, high: 105, low: 98, close: 104, volume: 1 }, // touches TP 104
  { time: 3000, open: 104, high: 111, low: 103, close: 110, volume: 1 }, // touches TP 110
  { time: 4000, open: 90, high: 92, low: 89, close: 91, volume: 1 }, // GAP below SL 95
  { time: 5000, open: 108, high: 109, low: 96, close: 97, volume: 1 },
]

// =============================================================================
section('1. findFirstExit — defective levels must produce NO fill')

// The money path: these are the inputs that used to "close" a long at price 0.
check('tp1 = 0 -> null (the fabricated "TP at price 0" hole)', findFirstExit(BARS, { dir: 1, sl: 95, tp1: 0 }, 0) === null)
check('tp1 < 0 -> null', findFirstExit(BARS, { dir: 1, sl: 95, tp1: -1 }, 0) === null)
check('sl = 0 -> null', findFirstExit(BARS, { dir: 1, sl: 0, tp1: 110 }, 0) === null)
check('sl < 0 -> null', findFirstExit(BARS, { dir: 1, sl: -5, tp1: 110 }, 0) === null)
check('tp1 = NaN -> null', findFirstExit(BARS, { dir: 1, sl: 95, tp1: NaN }, 0) === null)
check('tp1 = null -> null (Number.isFinite(null) is false)', findFirstExit(BARS, { dir: 1, sl: 95, tp1: null }, 0) === null)
check('sl = undefined -> null', findFirstExit(BARS, { dir: 1, sl: undefined, tp1: 110 }, 0) === null)
check('unknown dir (0) -> null, not silently treated as short', findFirstExit(BARS, { dir: 0, sl: 105, tp1: 90 }, 0) === null)
check('empty bar list -> null', findFirstExit([], { dir: 1, sl: 95, tp1: 110 }, 0) === null)

// =============================================================================
section('2. findFirstExit — healthy long / short behaviour (unchanged)')

const longTp = findFirstExit(BARS, { dir: 1, sl: 95, tp1: 110 }, 0)
check('long reaches TP 110 on the third bar', longTp?.kind === 'tp' && longTp.price === 110 && longTp.time === 3000, JSON.stringify(longTp))
const longTpEarly = findFirstExit(BARS, { dir: 1, sl: 95, tp1: 104 }, 0)
check('long TP 104 fills at the TP level (never at the close)', longTpEarly?.price === 104 && longTpEarly.time === 2000, JSON.stringify(longTpEarly))
const bothTouched = findFirstExit(BARS, { dir: 1, sl: 99, tp1: 104 }, 1000)
check('SL and TP in the SAME bar -> SL first (conservative)', bothTouched?.kind === 'sl' && bothTouched.price === 99 && bothTouched.time === 2000, JSON.stringify(bothTouched))
const gapFill = findFirstExit(BARS, { dir: 1, sl: 95, tp1: 110 }, 3500)
check('bar opening beyond the stop fills at the OPEN (worse price)', gapFill?.kind === 'sl' && gapFill.price === 90 && gapFill.time === 4000, JSON.stringify(gapFill))
const afterMid = findFirstExit(BARS, { dir: 1, sl: 95, tp1: 110 }, 2500)
check('afterMs skips earlier bars: first bar considered is 3000 -> TP 110 @3000', afterMid?.kind === 'tp' && afterMid.time === 3000, JSON.stringify(afterMid))
const afterAll = findFirstExit(BARS, { dir: 1, sl: 95, tp1: 110 }, 3000)
check('afterMs = 3000 skips the TP bar -> the gap bar stops out at 90', afterAll?.kind === 'sl' && afterAll.price === 90 && afterAll.time === 4000, JSON.stringify(afterAll))
const shortTp = findFirstExit(BARS, { dir: -1, sl: 105, tp1: 99 }, 0)
check('short reaches TP 99 on the first bar', shortTp?.kind === 'tp' && shortTp.price === 99 && shortTp.time === 1000, JSON.stringify(shortTp))
const shortSl = findFirstExit(BARS, { dir: -1, sl: 105, tp1: 90 }, 0)
check('short stop at 105 fills on the bar that touches it', shortSl?.kind === 'sl' && shortSl.price === 105 && shortSl.time === 2000, JSON.stringify(shortSl))
check('no touch at all -> null', findFirstExit(BARS, { dir: 1, sl: 50, tp1: 200 }, 0) === null)

// =============================================================================
section('3. sanitizeTps — the ladder that may be STORED on a position')

const good = sanitizeTps([110, 120])
check('clean ladder -> ok with numeric levels', good.ok === true && JSON.stringify(good.tps) === JSON.stringify([110, 120]))
check('levels are coerced to numbers (fresh array, no raw pass-through)', sanitizeTps(['90']).ok === true && sanitizeTps(['90']).tps[0] === 90)
check('single level -> ok', sanitizeTps([110]).ok === true && sanitizeTps([110]).tps.length === 1)

check('[null,110] -> defect at index 0 (the doc that used to be stored)', sanitizeTps([null, 110]).ok === false && sanitizeTps([null, 110]).index === 0)
check('[110,null] -> defect at index 1', sanitizeTps([110, null]).ok === false && sanitizeTps([110, null]).index === 1)
check('["",110] -> defect at index 0', sanitizeTps(['', 110]).index === 0)
check('["  ",110] -> defect at index 0 (Number(" ") === 0 trap)', sanitizeTps(['  ', 110]).index === 0)
check('[0] -> rejected (zero is not a price)', sanitizeTps([0]).ok === false && sanitizeTps([0]).index === 0)
check('[-5] -> rejected (negative is not a price)', sanitizeTps([-5]).ok === false && sanitizeTps([-5]).index === 0)
check('[NaN] -> rejected', sanitizeTps([NaN]).ok === false)
check('[true] -> rejected (Number(true) === 1)', sanitizeTps([true]).ok === false)
check('[110,"abc"] -> defect at index 1', sanitizeTps([110, 'abc']).index === 1)
check('defect reason names the index', /tps\[1\]/.test(sanitizeTps([110, 'abc']).reason || ''))
check('empty array -> rejected (index null)', sanitizeTps([]).ok === false && sanitizeTps([]).index === null)
check('not an array -> rejected', sanitizeTps(null).ok === false && sanitizeTps(undefined).ok === false && sanitizeTps('110').ok === false)

// =============================================================================
section('4. followExitPrice — follow-up alerts (existing behaviour, locked)')

check('STOP_LOSS fills at the alert price', followExitPrice({ action: 'STOP_LOSS', price: 99 }) === 99)
check('TAKE_PROFIT level 2 uses tps[1]', followExitPrice({ action: 'TAKE_PROFIT', level: 2, price: 100, tps: [105, 110] }) === 110)
check('TAKE_PROFIT level 1 uses tps[0]', followExitPrice({ action: 'TAKE_PROFIT', level: 1, price: 100, tps: [105, 110] }) === 105)
check('TAKE_PROFIT with a level outside the array falls back to the alert price', followExitPrice({ action: 'TAKE_PROFIT', level: 5, price: 100, tps: [105] }) === 100)
check('TIME_CLOSE -> null (caller resolves the market price)', followExitPrice({ action: 'TIME_CLOSE', price: 100 }) === null)
check('unknown action -> null', followExitPrice({ action: 'WHATEVER', price: 100 }) === null)
// A defective level must never look like a usable TP price: 0 is what Number(null)
// gives, and runCycle's `price > 0` guard is what rejects it there. Locked so it
// cannot start looking "valid" without that guard noticing.
const defective = followExitPrice({ action: 'TAKE_PROFIT', level: 1, price: 100, tps: [null, 110] })
check('TAKE_PROFIT on a null level -> not a usable positive price (runCycle skips it)', !(Number.isFinite(defective) && defective > 0), String(defective))

// =============================================================================
section('5. Hand-off + exit-scan guards (source level)')

// runCycle cannot be unit-tested without Mongo (it returns early on `mongoDown`),
// so the two wiring points that turn a defective ladder into money are guarded at
// the SOURCE level here. They are narrow on purpose: they fail if someone reverts
// to handing/storing the raw alert array or drops the TP1 guard.
const src = readFileSync(new URL('./paper.mjs', import.meta.url), 'utf8')
const start = src.indexOf('recordOpen({')
const handoff = start >= 0 ? src.slice(start, src.indexOf('})', start) + 2) : ''

check('the recordOpen() hand-off is present in the source', handoff.length > 0)
check('runCycle never hands the RAW alert tps array to recordOpen', !/tps:\s*a\.tps/.test(handoff), handoff.slice(0, 200))
check('recordOpen receives the SANITISED ladder, not the raw array', /tps:\s*(?!a\.tps)[A-Za-z_$][\w$]*\.tps/.test(handoff))
check('the gate still gets the RAW array (it must SEE the defect in order to reject it)', /checkOrder\([\s\S]{0,240}?tps:\s*a\.tps/.test(src))
check('a defective ladder is rejected, with an audit entry (fail closed)', /paper_reject_tps/.test(src) && /status:\s*'rejected'/.test(src))
check('the data exit scan refuses an unusable TP1 before findFirstExit', /Number\.isFinite\(tp1\)\s*&&\s*tp1\s*>\s*0/.test(src) && /paper_bad_tps1/.test(src))
check('this suite never pulled the DB layer in (globalThis.__tmMongo undefined)', globalThis.__tmMongo === undefined)

finish()
