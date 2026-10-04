#!/usr/bin/env node
// =============================================================================
//  TM TRADING - fixtures for the D8 drift verdict (exec/drift.mjs)
//  Pure logic only (evaluateDrift / engineTf) — no Mongo, no network.
//  Run: node exec/test-drift.mjs   (wired into `npm test`)
// =============================================================================
import { evaluateDrift, engineTf, loadDriftConfig, DRIFT_DEFAULTS } from './drift.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const TH = { windowH: 24, maxDiff: 3, maxPct: 50, minTotal: 4 }

// =============================================================================
section('1. engineTf — TV tf -> engine tf')

check("'15' -> '15'", engineTf('15') === '15')
check("'1h' -> '60'", engineTf('1h') === '60')
check("'4h' -> '240'", engineTf('4h') === '240')
check("'15m' -> '15'", engineTf('15m') === '15')
check("'1D' -> 'D'", engineTf('1D') === 'D')
check("'D' -> 'D'", engineTf('D') === 'D')
check('junk -> null', engineTf('xlm') === null && engineTf('') === null && engineTf(null) === null)
check("'W' -> null (khong ho tro)", engineTf('W') === null)

// =============================================================================
section('2. evaluateDrift — abs diff, pct, noise floor')

check('equal counts -> OK', evaluateDrift([{ symbol: 'A', tf: '15', tv: 5, engine: 5 }], TH).breach === false)
check('diff 4 (>3) -> breach', evaluateDrift([{ symbol: 'A', tf: '15', tv: 5, engine: 1 }], TH).breach === true)
check('diff exactly 3 -> OK (boundary)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 3, engine: 0 }], TH).breach === false)
check('1 vs 0 -> OK (below minTotal, pct noise floor)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 1, engine: 0 }], TH).breach === false)
check('6 vs 0 -> breach (abs)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 6, engine: 0 }], TH).breach === true)
check('5 vs 2 -> breach via PCT (60% > 50%, diff 3 not > 3)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 5, engine: 2 }], TH).breach === true)
check('4 vs 2 -> OK (pct exactly 50 is not > 50, diff 2)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 4, engine: 2 }], TH).breach === false)
check('engine MORE than TV also counts (drift is any divergence)', evaluateDrift([{ symbol: 'A', tf: '15', tv: 0, engine: 6 }], TH).breach === true)

// =============================================================================
section('3. flagged details + skipped rows + multi-pair')

const v = evaluateDrift([
  { symbol: 'BTCUSDT', tf: '15', tv: 8, engine: 1 },
  { symbol: 'ETHUSDT', tf: '15', tv: 3, engine: 3 },
  { symbol: 'XRPUSDT', tf: '15', tv: NaN, engine: 2 },
], TH)
check('breach when one pair flagged', v.breach === true)
check('only the bad pair is flagged', v.flagged.length === 1 && v.flagged[0].symbol === 'BTCUSDT')
check('flagged carries diff + pct', v.flagged[0].diff === 7 && v.flagged[0].pct === 88, JSON.stringify(v.flagged[0]))
check('NaN row lands in skipped, not flagged', v.skipped.length === 1 && v.skipped[0].symbol === 'XRPUSDT')
check('checked counts only evaluable rows', v.checked === 2)
check('all-OK rows -> breach false', evaluateDrift([{ symbol: 'A', tf: '15', tv: 2, engine: 2 }, { symbol: 'B', tf: '15', tv: 1, engine: 1 }], TH).breach === false)

// =============================================================================
section('4. config parsing')

const c = loadDriftConfig({ DRIFT_MAX_DIFF: '5', DRIFT_WINDOW_H: '12', DRIFT_MAX_PCT: 'oops' })
check('valid env overrides', c.maxDiff === 5 && c.windowH === 12)
check('invalid keeps default', c.maxPct === DRIFT_DEFAULTS.maxPct)
check('empty env -> defaults', JSON.stringify(loadDriftConfig({})) === JSON.stringify(DRIFT_DEFAULTS))

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
