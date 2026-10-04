#!/usr/bin/env node
// =============================================================================
//  TM TRADING — fixtures for engine/preset-drift.mjs (roadmap Phase 13, item 3)
//
//  Pure comparison logic + the file IO path with tmp files: no Mongo, no
//  network. The D1 refusal (never pool two generations), the D12 sample-size
//  gate and the honest "cannot compare" verdicts are the point of this suite.
//
//  Run: node engine/test-preset-drift.mjs   (wired into `npm test`)
// =============================================================================
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  generationOf, isComparableGeneration, windowStartOf, metricRow,
  pickFrozenPreset, stampLiveEntries, comparePresetDrift, formatPresetDrift,
  frozenEntriesFromTrades, loadFrozenEntries, loadLiveEntries, runPresetDrift,
  PRESET_DRIFT_DEFAULTS,
} from './preset-drift.mjs'
import { UNKNOWN, normalizeEntry, writeJournalNdjson } from './journal.mjs'

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
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${e?.message || e}`); finish() })

const tmp = mkdtempSync(join(tmpdir(), 'tm-preset-drift-'))
const DAY = 86400000

// Nothing in this suite may reach a database: every IO call uses `mongo:false`
// and the comparison itself is pure. Proven before anything can import db.mjs.
check('pure comparison + mongo:false IO never import the DB layer', globalThis.__tmMongo === undefined)

/**
 * A closed metric row. `win` -> +2R, loss -> -1R; everything is deterministic so
 * every expected number in this file can be checked by hand.
 */
const mk = (i, win, { hash = 'aaa', time = '2026-10-01T00:00:00Z', source = 'paper', method = 'vsa', engineVersion = '0.5.0', regime = 'alt' } = {}) => ({
  engineVersion, paramsHash: hash, symbol: 'BTCUSDT', tf: '15', dir: 1, method, regime, source,
  result: win ? 'TP' : 'SL', rMultiple: win ? 2 : -1,
  entryTime: new Date(Date.parse(time) + i * 60000).toISOString(),
})
/** n rows, `wins` of which win. */
const mkmany = (n, wins, opts = {}) => Array.from({ length: n }, (_, i) => mk(i, i < wins, opts))

// =============================================================================
section('1. generationOf / isComparableGeneration — the D1 bucket key')

check('both halves known -> v#hash', generationOf({ engineVersion: '0.5.0', paramsHash: 'aaa' }) === '0.5.0#aaa')
check('missing engineVersion -> unknown#hash', generationOf({ paramsHash: 'aaa' }) === 'unknown#aaa')
check('missing paramsHash -> v#unknown', generationOf({ engineVersion: '0.5.0' }) === '0.5.0#unknown')
check('nothing -> unknown#unknown', generationOf({}) === 'unknown#unknown')
check('null row is not a crash', generationOf(null) === 'unknown#unknown')
check('comparable only when BOTH halves are known',
  isComparableGeneration('0.5.0#aaa') === true
  && isComparableGeneration('0.5.0#unknown') === false
  && isComparableGeneration('unknown#aaa') === false
  && isComparableGeneration('unknown#unknown') === false)

// =============================================================================
section('2. windowStartOf — UTC, epoch-aligned, timezone-free')

const t = Date.parse('2026-10-01T00:00:00Z')
check('epoch-aligned 7-day window', windowStartOf(t, 7) === Math.floor(t / (7 * DAY)) * DAY * 7)
check('two instants one day apart share the window', windowStartOf(t, 7) === windowStartOf(t + DAY, 7))
check('eight days apart -> different windows', windowStartOf(t, 7) !== windowStartOf(t + 8 * DAY, 7))
check('windowDays changes the bucket size', windowStartOf(t, 1) === Math.floor(t / DAY) * DAY)
check('default window is 7 days', PRESET_DRIFT_DEFAULTS.windowDays === 7 && windowStartOf(t) === windowStartOf(t, 7))
check('unusable instant -> null (cannot be placed on the axis)', windowStartOf('nope', 7) === null && windowStartOf(null, 7) === null)

// =============================================================================
section('3. metricRow — one shape for both sides of the comparison')

const derived = metricRow({ dir: 1, entryPrice: 100, sl: 95, exitPrice: 110, result: 'TP', entryTime: '2026-10-01T00:00:00Z', paramsHash: 'aaa', engineVersion: '0.5.0' })
check('R derived from the levels when the source did not store it (+2R)', derived.rMultiple === 2)
check('provided R is trusted (fees already inside it)', metricRow({ rMultiple: 1.7, result: 'TP' }).rMultiple === 1.7)
check('missing stamp -> unknown', metricRow({ result: 'TP' }).engineVersion === UNKNOWN && metricRow({ result: 'TP' }).paramsHash === UNKNOWN)
check('result outside the known set -> unknown', metricRow({ result: 'weird' }).result === UNKNOWN)
check('result is upper-cased', metricRow({ result: 'tp' }).result === 'TP')
check('entryTime normalised to UTC ms', metricRow({ entryTime: '2026-10-01T00:00:00Z' }).entryTime === t)
check('no R distance -> R stays null (never 0)', metricRow({ dir: 1, entryPrice: 100, sl: 100, exitPrice: 110 }).rMultiple === null)

// =============================================================================
section('4. pickFrozenPreset — never a silent substitution')

const frozenA = mkmany(30, 24, { hash: 'aaa', time: '2026-09-01T00:00:00Z' }).map(metricRow)
const frozenB = mkmany(25, 12, { hash: 'bbb', time: '2026-09-01T00:00:00Z' }).map(metricRow)
const pick = pickFrozenPreset([...frozenA, ...frozenB])
check('busiest frozen preset is chosen', pick.chosen.generation === '0.5.0#aaa' && pick.chosen.n === 30, pick.chosen?.generation)
check('several presets -> ambiguous flag + full candidate list', pick.ambiguous === true && pick.candidates.length === 2)
const pickExplicit = pickFrozenPreset([...frozenA, ...frozenB], { generation: '0.5.0#bbb' })
check('explicit generation is honoured', pickExplicit.chosen.generation === '0.5.0#bbb')
const pickMissing = pickFrozenPreset([...frozenA], { generation: '0.5.0#zzz' })
check('requested-but-absent generation is reported, not substituted', pickMissing.missing === true && pickMissing.chosen === null)
check('empty dataset -> no chosen preset', pickFrozenPreset([]).chosen === null)

// =============================================================================
section('5. comparePresetDrift — matched preset, sample gate, D1 refusal')

const frozenMatch = mkmany(20, 16, { hash: 'aaa', time: '2026-09-01T00:00:00Z' }).map(metricRow) // 1.4R, WR 80%

// --- 5a) enough samples, same distribution -> within tolerance ---------------
const liveSame = mkmany(25, 20, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }).map(metricRow)
const repSame = comparePresetDrift({ live: liveSame, backtest: frozenMatch })
check('matched generation is recognised as comparable', repSame.frozen.chosen === '0.5.0#aaa' && repSame.frozen.comparable === true)
check('one time bucket produced', repSame.buckets.length === 1, JSON.stringify(repSame.buckets.map((b) => b.windowStart)))
check('enough samples -> NOT marked insufficient', repSame.buckets[0].live.insufficient === false && repSame.buckets[0].frozen.insufficient === false)
check('same distribution -> within tolerance', repSame.buckets[0].verdict === 'within tolerance', repSame.buckets[0].verdict)
check('delta printed for a confident bucket', repSame.buckets[0].deltaExpectancyR === 0 && repSame.buckets[0].deltaWinRate === 0)
check('overall verdict follows the bucket', repSame.overallVerdict === 'within tolerance')
check('no D1 refusal when there is one generation', repSame.refused === false && repSame.warnings.length === 0, JSON.stringify(repSame.warnings))

// --- 5b) drift beyond the tolerance ----------------------------------------
const liveWorse = mkmany(25, 16, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }).map(metricRow) // 0.92R, WR 64%
const repWorse = comparePresetDrift({ live: liveWorse, backtest: frozenMatch })
check('live expectancy well below the frozen preset -> DRIFT', repWorse.buckets[0].verdict === 'DRIFT' && repWorse.buckets[0].confident === true)
check('delta is negative and printed', repWorse.buckets[0].deltaExpectancyR < -0.4 && repWorse.buckets[0].deltaWinRate < -0.1, JSON.stringify({ r: repWorse.buckets[0].deltaExpectancyR, w: repWorse.buckets[0].deltaWinRate }))
check('overall verdict is DRIFT too', repWorse.overallVerdict === 'DRIFT')

// --- 5c) D12: too few trades -> insufficient evidence ----------------------
const liveFew = mkmany(5, 4, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }).map(metricRow)
const repFew = comparePresetDrift({ live: liveFew, backtest: frozenMatch })
check('small live sample -> insufficient evidence', repFew.buckets[0].verdict === 'insufficient evidence', repFew.buckets[0].verdict)
check('no confident delta is printed for a small bucket', repFew.buckets[0].deltaExpectancyR === null && repFew.buckets[0].confident === false)
check('the observed numbers are still there, clearly labelled', repFew.buckets[0].live.rSamples === 5 && repFew.buckets[0].live.winRate === 0.8)
check('insufficient reason names the sample size', /5\/20/.test(repFew.buckets[0].live.insufficientReason))
check('minTrades is configurable', comparePresetDrift({ live: liveFew, backtest: frozenMatch, minTrades: 5 }).buckets[0].verdict === 'within tolerance')
// Number(null) === 0: a MISSING threshold must fall back to the default, never
// silently become 0 (which would mark every empty bucket "confident").
check('minTrades: null falls back to the default, NOT to 0', comparePresetDrift({ live: liveFew, backtest: frozenMatch, minTrades: null }).minTrades === 20)
check('minTrades: "" falls back to the default, NOT to 0', comparePresetDrift({ live: liveFew, backtest: frozenMatch, minTrades: '' }).minTrades === 20)
check('windowDays: null/"" fall back to 7', comparePresetDrift({ live: liveFew, backtest: frozenMatch, windowDays: null }).windowDays === 7 && comparePresetDrift({ live: liveFew, backtest: frozenMatch, windowDays: '' }).windowDays === 7)
check('toleranceR: null falls back to the default', comparePresetDrift({ live: liveFew, backtest: frozenMatch, toleranceR: null }).toleranceR === 0.25)

// --- 5d) live rows with no stamp at all ------------------------------------
const liveUnstamped = mkmany(25, 16, { hash: null, engineVersion: null, time: '2026-10-01T00:00:00Z' }).map(metricRow)
const repUnstamped = comparePresetDrift({ live: liveUnstamped, backtest: frozenMatch })
check('unstamped live rows -> explicit "cannot compare" (no invented comparison)',
  repUnstamped.buckets[0].verdict === 'cannot compare: live trades carry no engineVersion+paramsHash', repUnstamped.buckets[0].verdict)
check('unstamped live generation is reported as unknown#unknown', repUnstamped.liveGenerations[0] === 'unknown#unknown')
check('a single unstamped generation is not a D1 refusal', repUnstamped.refused === false)

// --- 5e) live preset different from the frozen baseline --------------------
const liveOther = mkmany(25, 16, { hash: 'bbb', time: '2026-10-01T00:00:00Z' }).map(metricRow)
const repOther = comparePresetDrift({ live: liveOther, backtest: frozenMatch })
check('a different live preset is NOT compared against the frozen one',
  repOther.buckets[0].verdict === 'cannot compare: live preset 0.5.0#bbb is not the frozen baseline 0.5.0#aaa', repOther.buckets[0].verdict)
check('different-preset bucket has no frozen stats attached', repOther.buckets[0].frozen === null)

// --- 5f) D1: two generations in the live dataset -> REFUSED to pool --------
const liveMixed = [...mkmany(25, 16, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }), ...mkmany(25, 10, { hash: 'bbb', time: '2026-10-01T00:00:00Z' })].map(metricRow)
const repMixed = comparePresetDrift({ live: liveMixed, backtest: frozenMatch })
check('mixed live generations -> refused', repMixed.refused === true)
check('NO pooled number is produced (overall is null)', repMixed.overall === null)
check('overall verdict says the pool was refused', /refused/.test(repMixed.overallVerdict), repMixed.overallVerdict)
check('one bucket per generation (nothing averaged together)', repMixed.buckets.length === 2 && new Set(repMixed.buckets.map((b) => b.generation)).size === 2)
check('the refusal is announced as a warning (D1)', repMixed.warnings.some((w) => /REFUSED|NOT pooled|span 2 generations/.test(w)), JSON.stringify(repMixed.warnings))
check('the matched generation is still compared honestly', repMixed.buckets.some((b) => b.generation === '0.5.0#aaa' && b.frozen !== null))
check('the unmatched generation is flagged separately', repMixed.buckets.some((b) => b.generation === '0.5.0#bbb' && /not the frozen baseline/.test(b.verdict)))

// --- 5g) trend over time --------------------------------------------------
const liveW1 = mkmany(25, 16, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }) // -0.48R
const liveW2 = mkmany(25, 12, { hash: 'aaa', time: '2026-10-09T00:00:00Z' }) // -0.96R
const repTrend = comparePresetDrift({ live: [...liveW1, ...liveW2].map(metricRow), backtest: frozenMatch })
check('two time windows are separate buckets', repTrend.buckets.length === 2, JSON.stringify(repTrend.buckets.map((b) => b.windowStart)))
check('buckets are ordered oldest first', repTrend.buckets[0].windowStart < repTrend.buckets[1].windowStart)
check('both buckets confident here', repTrend.buckets.every((b) => b.confident))
check('trend detected as worsening (the gap widens)', repTrend.trend.direction === 'worsening' && repTrend.trend.points === 2, JSON.stringify(repTrend.trend))
check('trend values are the per-window deltas', repTrend.trend.values[1] < repTrend.trend.values[0])
const repFlat = comparePresetDrift({ live: [...mkmany(25, 20, { hash: 'aaa', time: '2026-10-01T00:00:00Z' }), ...mkmany(25, 20, { hash: 'aaa', time: '2026-10-09T00:00:00Z' })].map(metricRow), backtest: frozenMatch })
check('stable when the deltas do not move', repFlat.trend.direction === 'stable')

// --- 5h) empty inputs ----------------------------------------------------
const repEmpty = comparePresetDrift({ live: [], backtest: frozenMatch })
check('no live rows -> "no live trades"', repEmpty.overallVerdict === 'no live trades')
const repNoFrozen = comparePresetDrift({ live: liveWorse, backtest: [] })
check('no frozen preset -> cannot compare (never a made-up baseline)', /no frozen backtest preset/.test(repNoFrozen.buckets[0].verdict), repNoFrozen.buckets[0].verdict)
check('the missing baseline is announced', repNoFrozen.warnings.some((w) => /no frozen preset/.test(w)), JSON.stringify(repNoFrozen.warnings))
const repRequested = comparePresetDrift({ live: [...frozenA.slice(0, 0), ...liveWorse], backtest: [...frozenA, ...frozenB].map(metricRow), generation: '0.5.0#bbb' })
check('explicit frozen generation carries through the report', repRequested.frozen.chosen === '0.5.0#bbb')
check('other frozen presets are listed as candidates, not pooled', repRequested.frozen.candidates.length === 2 && repRequested.warnings.some((w) => /NOT pooled/.test(w)))

// =============================================================================
section('6. stampLiveEntries — a declaration fills gaps, never relabels')

const unstampedRow = { engineVersion: UNKNOWN, paramsHash: UNKNOWN, unknown: ['engineVersion', 'paramsHash', 'fees'], rMultiple: 1, result: 'TP' }
const stamped = stampLiveEntries([unstampedRow], { engineVersion: '0.5.0', paramsHash: 'aaa' })
check('missing stamps filled from the declaration', stamped.entries[0].engineVersion === '0.5.0' && stamped.entries[0].paramsHash === 'aaa')
check('the unknown list is pruned accordingly', JSON.stringify(stamped.entries[0].unknown) === JSON.stringify(['fees']))
check('declared count reported', stamped.stamped === 1)
const keep = stampLiveEntries([{ engineVersion: '9.9.9', paramsHash: 'zzz', unknown: [] }], { engineVersion: '0.5.0', paramsHash: 'aaa' })
check('an existing stamp is never overwritten', keep.entries[0].engineVersion === '9.9.9' && keep.entries[0].paramsHash === 'zzz' && keep.stamped === 0)
check('no declaration -> no change', stampLiveEntries([unstampedRow], {}).stamped === 0)

// =============================================================================
section('7. formatPresetDrift — prints n, never a confident guess, never D8')

const text = formatPresetDrift(repWorse)
check('sample sizes are printed', /n=25/.test(text) && /R-samples=20/.test(text))
check('the frozen baseline is named with its sample size', /0\.5\.0#aaa/.test(text) && /R samples 20/.test(text))
check('a small-sample bucket is labelled insufficient', /insufficient evidence/.test(formatPresetDrift(repFew)))
check('the report says it is NOT D8 (no halt)', /NOT D8/.test(text) && /exec\/drift\.mjs/.test(text))
check('a refused pool is printed as refused', /REFUSED/.test(formatPresetDrift(repMixed)))
check('missing R samples per bucket are surfaced', /R missing on/.test(formatPresetDrift(comparePresetDrift({ live: [metricRow({ result: 'SL', dir: 1, entryPrice: 100, sl: 100, exitPrice: 95, entryTime: '2026-10-01T00:00:00Z' })], backtest: frozenMatch }))))

// =============================================================================
section('8. runPresetDrift — file IO path (tmp files, no Mongo)')

const btFile = join(tmp, 'trades.ndjson')
const liveFile = join(tmp, 'journal.ndjson')
const btRaw = mkmany(20, 16, { hash: 'aaa', time: '2026-09-01T00:00:00Z' }).map((r) => ({ ...r, entryPrice: 100, sl: 95, exitPrice: r.result === 'TP' ? 110 : 95, tp: 110 }))
writeFileSync(btFile, btRaw.map((r) => JSON.stringify(r)).join('\n') + '\n')
const liveEntries = mkmany(25, 16, { hash: null, engineVersion: null, time: '2026-10-01T00:00:00Z' }).map((r) => normalizeEntry({ ...r, source: 'paper', account: 'paper', id: `l${r.entryTime}` }))
writeJournalNdjson(liveEntries, liveFile)

const frozenLoaded = loadFrozenEntries({ file: btFile })
check('frozen rows read from reports-style NDJSON', frozenLoaded.entries.length === 20 && frozenLoaded.skipped === 0)
check('frozenEntriesFromTrades keeps the stamp', frozenEntriesFromTrades(btRaw)[0].paramsHash === 'aaa')

const liveLoaded = await loadLiveEntries({ file: liveFile, mongo: false, engineVersion: '0.5.0', paramsHash: 'aaa' })
check('live rows read from the journal mirror without Mongo', liveLoaded.source === 'ndjson' && liveLoaded.entries.length === 25)
check('the declared stamp is applied and counted', liveLoaded.declaredStamps === 25)

const report = await runPresetDrift({ liveFile, backtestFile: btFile, mongo: false, livePreset: 'aaa', liveEngineVersion: '0.5.0' })
check('sources reported (nothing hidden about what was read)', report.sources.live === 'ndjson' && report.sources.frozen === btFile && report.sources.liveRows === 25 && report.sources.frozenRows === 20, JSON.stringify(report.sources))
check('the comparison runs end to end on files', report.overallVerdict === 'DRIFT', report.overallVerdict)
check('declaration is announced in the warnings', report.warnings.some((w) => /declared live preset/.test(w)), JSON.stringify(report.warnings))
check('report is JSON-serialisable (dashboard/Telegram safe)', typeof JSON.stringify(report) === 'string')

const empty = await runPresetDrift({ liveFile: join(tmp, 'missing.ndjson'), backtestFile: join(tmp, 'missing2.ndjson'), mongo: false })
check('missing files -> no crash, both sides empty', empty.sources.liveRows === 0 && empty.sources.frozenRows === 0 && empty.overallVerdict === 'no live trades')
check('malformed backtest lines are counted, not fatal', (() => {
  const f = join(tmp, 'bad.ndjson')
  writeFileSync(f, '{ not json }\n' + JSON.stringify(btRaw[0]) + '\n')
  const l = loadFrozenEntries({ file: f })
  return l.skipped === 1 && l.entries.length === 1
})())

rmSync(tmp, { recursive: true, force: true })
finish()
