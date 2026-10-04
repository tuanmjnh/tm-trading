#!/usr/bin/env node
// =============================================================================
//  TM TRADING — PRESET DRIFT: live/paper preset vs the FROZEN backtest preset
//  (roadmap Phase 13, item 3)
//
//  THIS IS NOT D8. `exec/drift.mjs` (D8) compares the NUMBER of TradingView
//  ENTRY alerts against the number of setups the engine sees on the same
//  symbol/TF inside a 24h window, and HALTS new orders when they diverge — it
//  guards the Pine <-> engine parity of the SIGNAL SOURCE ("risk #1").
//
//  This module answers a different question: the trades that were actually
//  EXECUTED with preset P (engineVersion+paramsHash) — does the realized
//  distribution still look like what the FROZEN backtest of that same preset
//  promised, and does the gap widen over time? It measures the PRESET, not the
//  signal parity, and it takes NO action: a measurement may complain, only an
//  operator may change the system. Nothing here can halt or place anything.
//
//  D1 is ENFORCED, not assumed:
//    - live rows and frozen rows are bucketed by `engineVersion#paramsHash`;
//    - a live dataset spanning more than one generation is REFUSED: buckets stay
//      separate and no pooled number is produced (a warning says so);
//    - live rows without a matching frozen preset have NO baseline: the report
//      says "cannot compare" instead of silently measuring against another preset;
//    - live rows with no stamp at all are reported as such. Today positions are
//      written with `paramsHash: null` (exec/risk.mjs recordOpen), so this is the
//      normal outcome until the live path stamps its trades — the report refuses
//      to invent the missing half of the comparison.
//
//  D12 (measurement honesty): every bucket prints its sample size; below
//  `minTrades` R samples the verdict is "insufficient evidence" — observed
//  numbers are still shown, clearly labelled as observations, never as a result.
//
//  CLI:
//    node engine/preset-drift.mjs [--generation v#hash] [--window 7]
//      [--min-trades 20] [--live <file>] [--backtest <file>]
//      [--live-preset <paramsHash>] [--live-engine-version <v>] [--json]
// =============================================================================
import { pathToFileURL } from 'node:url'

import { readNdjson, TRADES_FILE } from './store.mjs'
import {
  UNKNOWN, EXECUTED_RESULTS, JOURNAL_FILE, MIN_TRADES_FOR_EVIDENCE,
  journalStats, rMultipleOf, timeOf, loadJournal,
} from './journal.mjs'

const DAY_MS = 86_400_000

export const PRESET_DRIFT_DEFAULTS = Object.freeze({
  windowDays: 7,
  minTrades: MIN_TRADES_FOR_EVIDENCE,
  toleranceR: 0.25, // |Δ expectancy R| beyond this = drift (only with enough samples)
  toleranceWinRate: 0.10, // |Δ win rate| beyond this (10 percentage points)
})

const num = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null)

/**
 * Threshold options: `null`/`''`/undefined mean "not provided" and must fall back
 * to the default. `Number(null) === 0` would otherwise turn a missing threshold
 * into 0, i.e. an empty sample would be reported as a confident result.
 */
const threshold = (x, fallback) => {
  const n = num(x)
  return n === null ? fallback : n
}

// =============================================================================
//  Version stamp (D1) — the bucket key for both sides of the comparison
// =============================================================================

/** `engineVersion#paramsHash` with `unknown` when a half is missing (never guessed). */
export function generationOf(row) {
  const v = row?.engineVersion ? String(row.engineVersion) : UNKNOWN
  const h = row?.paramsHash ? String(row.paramsHash) : UNKNOWN
  return `${v}#${h}`
}

/**
 * A generation is comparable only when BOTH halves are known: "0.5.0#unknown"
 * cannot be matched against a frozen preset, so it must not be presented as one.
 */
export function isComparableGeneration(key) {
  const [v, h] = String(key ?? '').split('#')
  return !!v && !!h && v !== UNKNOWN && h !== UNKNOWN
}

/** Deterministic UTC window index (epoch-aligned: no local timezone involved). */
export function windowStartOf(ts, windowDays = PRESET_DRIFT_DEFAULTS.windowDays) {
  const t = timeOf(ts)
  if (t === null) return null
  const size = Math.max(1, Number(windowDays) || PRESET_DRIFT_DEFAULTS.windowDays) * DAY_MS
  return Math.floor(t / size) * size
}

/**
 * Reduce any row (journal entry or backtest trade) to the fields the comparison
 * needs. `rMultiple` is derived from the levels when the source did not compute
 * it (the paper executor does not store R at all).
 */
export function metricRow(raw = {}) {
  const dir = raw.dir === 1 || raw.dir === -1 ? raw.dir : null
  const direct = raw.rMultiple !== undefined && raw.rMultiple !== null && Number.isFinite(Number(raw.rMultiple))
    ? Number(raw.rMultiple)
    : null
  const rawResult = String(raw.result ?? '').toUpperCase()
  return {
    engineVersion: raw.engineVersion ? String(raw.engineVersion) : UNKNOWN,
    paramsHash: raw.paramsHash ? String(raw.paramsHash) : UNKNOWN,
    result: EXECUTED_RESULTS.includes(rawResult) ? rawResult : UNKNOWN,
    rMultiple: direct !== null ? direct : rMultipleOf({ dir, entryPrice: raw.entryPrice, sl: raw.sl, exitPrice: raw.exitPrice }),
    entryTime: timeOf(raw.entryTime),
    symbol: raw.symbol ? String(raw.symbol) : UNKNOWN,
    tf: raw.tf ? String(raw.tf) : UNKNOWN,
    method: raw.method ? String(raw.method) : UNKNOWN,
    source: raw.source ? String(raw.source) : UNKNOWN,
    unknown: Array.isArray(raw.unknown) ? raw.unknown : [],
  }
}

/**
 * Fill MISSING preset stamps on the live rows from an operator/sync declaration.
 * A stamp that is already present is never overwritten — declaring a preset must
 * not be able to relabel trades that already carried their own identity.
 */
export function stampLiveEntries(entries = [], { engineVersion = null, paramsHash = null } = {}) {
  let stamped = 0
  const out = (entries ?? []).map((e) => {
    const next = { ...e }
    let changed = false
    if (engineVersion && (!next.engineVersion || next.engineVersion === UNKNOWN)) {
      next.engineVersion = String(engineVersion)
      changed = true
    }
    if (paramsHash && (!next.paramsHash || next.paramsHash === UNKNOWN)) {
      next.paramsHash = String(paramsHash)
      changed = true
    }
    if (changed) {
      stamped++
      next.unknown = (next.unknown ?? []).filter(
        (f) => !(f === 'engineVersion' && next.engineVersion !== UNKNOWN)
          && !(f === 'paramsHash' && next.paramsHash !== UNKNOWN),
      )
    }
    return next
  })
  return { entries: out, stamped }
}

// =============================================================================
//  Frozen baseline selection
// =============================================================================

/**
 * The "frozen backtest preset" of the dataset. When several generations exist,
 * the busiest one is used and the rest are listed — they are NEVER pooled (D1).
 * `--generation` picks one explicitly; an absent one is reported, not substituted.
 */
export function pickFrozenPreset(backtestEntries = [], { generation = null } = {}) {
  const byGen = new Map()
  for (const e of backtestEntries ?? []) {
    const g = generationOf(e)
    if (!byGen.has(g)) byGen.set(g, [])
    byGen.get(g).push(e)
  }
  const candidates = [...byGen.entries()]
    .map(([gen, entries]) => ({ generation: gen, entries, n: journalStats(entries, { minTrades: 0 }).rSamples }))
    .sort((a, b) => b.n - a.n || (a.generation < b.generation ? -1 : 1))
  if (generation) {
    const found = candidates.find((c) => c.generation === generation) ?? null
    return { chosen: found, candidates, requested: generation, missing: found === null, ambiguous: candidates.length > 1 }
  }
  return { chosen: candidates[0] ?? null, candidates, requested: null, missing: false, ambiguous: candidates.length > 1 }
}

// =============================================================================
//  The comparison (pure)
// =============================================================================

function verdictOf({ gen, chosenGen, comparable, liveStats, frozenStats, toleranceR, toleranceWinRate }) {
  if (!liveStats.n) return 'no live trades'
  if (!isComparableGeneration(gen)) return 'cannot compare: live trades carry no engineVersion+paramsHash'
  if (chosenGen === null) return 'cannot compare: no frozen backtest preset'
  if (!comparable) return `cannot compare: live preset ${gen} is not the frozen baseline ${chosenGen}`
  if (liveStats.insufficient || !frozenStats || frozenStats.insufficient) return 'insufficient evidence'
  const dR = liveStats.expectancyR - frozenStats.expectancyR
  const dW = liveStats.winRate - frozenStats.winRate
  if (Math.abs(dR) > toleranceR || Math.abs(dW) > toleranceWinRate) return 'DRIFT'
  return 'within tolerance'
}

/**
 * Live/paper rows vs frozen backtest rows, per generation and per time window.
 *
 * @param {object} input
 * @param {object[]} input.live       executed rows (journal entries or positions)
 * @param {object[]} input.backtest   frozen backtest rows (reports/trades.ndjson)
 * @param {number} [input.windowDays] time bucket size (the "over time" axis)
 * @param {number} [input.minTrades]  R samples required for a confident verdict (D12)
 * @param {string} [input.generation] explicit frozen preset to compare against
 * @returns {object} report (see keys below)
 */
export function comparePresetDrift(input = {}) {
  const windowDays = threshold(input.windowDays, PRESET_DRIFT_DEFAULTS.windowDays)
  const minTrades = threshold(input.minTrades, PRESET_DRIFT_DEFAULTS.minTrades)
  const toleranceR = threshold(input.toleranceR, PRESET_DRIFT_DEFAULTS.toleranceR)
  const toleranceWinRate = threshold(input.toleranceWinRate, PRESET_DRIFT_DEFAULTS.toleranceWinRate)
  const generation = input.generation ?? null

  const live = (input.live ?? []).map(metricRow)
  const backtest = (input.backtest ?? []).map(metricRow)
  const warnings = []

  const frozen = pickFrozenPreset(backtest, { generation })
  if (frozen.requested && frozen.missing) {
    warnings.push(
      `requested frozen preset "${frozen.requested}" is not in the backtest dataset `
      + `(found: ${frozen.candidates.map((c) => c.generation).join(', ') || 'none'}) — nothing substituted`,
    )
  }
  if (frozen.ambiguous) {
    warnings.push(
      `${frozen.candidates.length} frozen presets present (${frozen.candidates.map((c) => `${c.generation}:${c.n}`).join(', ')}) — `
      + `using "${frozen.chosen?.generation}" only; they are NOT pooled (D1)`,
    )
  }

  const liveGenerations = [...new Set(live.map(generationOf))].sort()
  const mixed = liveGenerations.length > 1
  if (mixed) {
    warnings.push(
      `live/paper trades span ${liveGenerations.length} generations (${liveGenerations.join(', ')}) — `
      + 'buckets stay separate and NO pooled number is produced (D1)',
    )
  }
  const chosenGen = frozen.chosen?.generation ?? null
  if (live.length && chosenGen === null) warnings.push('backtest dataset is empty — there is no frozen preset to compare against')

  const buckets = []
  for (const gen of liveGenerations) {
    const genRows = live.filter((e) => generationOf(e) === gen)
    const comparable = isComparableGeneration(gen) && chosenGen !== null && gen === chosenGen
    const frozenStats = comparable ? journalStats(frozen.chosen.entries, { minTrades }) : null
    const byWindow = new Map()
    for (const e of genRows) {
      const w = windowStartOf(e.entryTime, windowDays)
      if (w === null) continue // no instant -> cannot place it on the time axis
      if (!byWindow.has(w)) byWindow.set(w, [])
      byWindow.get(w).push(e)
    }
    for (const [w, rows] of [...byWindow.entries()].sort((a, b) => a[0] - b[0])) {
      const liveStats = journalStats(rows, { minTrades })
      const verdict = verdictOf({ gen, chosenGen, comparable, liveStats, frozenStats, toleranceR, toleranceWinRate })
      const confident = verdict === 'DRIFT' || verdict === 'within tolerance'
      buckets.push({
        generation: gen,
        comparable,
        windowStart: new Date(w).toISOString(),
        windowEnd: new Date(w + windowDays * DAY_MS).toISOString(),
        live: liveStats,
        frozen: frozenStats,
        deltaExpectancyR: confident ? liveStats.expectancyR - frozenStats.expectancyR : null,
        deltaWinRate: confident ? liveStats.winRate - frozenStats.winRate : null,
        confident,
        verdict,
      })
    }
  }
  buckets.sort((a, b) => (a.windowStart < b.windowStart ? -1 : a.windowStart > b.windowStart ? 1 : a.generation < b.generation ? -1 : 1))

  const overall = live.length && !mixed ? journalStats(live, { minTrades }) : null
  const overallFrozen = !mixed && isComparableGeneration(liveGenerations[0] ?? '') && chosenGen === liveGenerations[0]
    ? journalStats(frozen.chosen.entries, { minTrades })
    : null
  const overallVerdict = live.length === 0
    ? 'no live trades'
    : mixed
      ? 'refused: live dataset mixes generations (D1)'
      : verdictOf({
        gen: liveGenerations[0],
        chosenGen,
        comparable: chosenGen === liveGenerations[0],
        liveStats: overall,
        frozenStats: overallFrozen,
        toleranceR,
        toleranceWinRate,
      })

  // Trend over time: only confident buckets of the compared generation count.
  const points = buckets.filter((b) => b.confident).map((b) => b.deltaExpectancyR)
  let direction = 'unknown'
  if (points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    direction = last < first - toleranceR ? 'worsening' : last > first + toleranceR ? 'improving' : 'stable'
  }

  return {
    windowDays,
    minTrades,
    toleranceR,
    toleranceWinRate,
    liveGenerations,
    refused: mixed,
    frozen: {
      chosen: chosenGen,
      n: frozen.chosen ? journalStats(frozen.chosen.entries, { minTrades }).rSamples : 0,
      comparable: chosenGen !== null && isComparableGeneration(chosenGen),
      candidates: frozen.candidates.map((c) => ({ generation: c.generation, n: c.n })),
    },
    overall,
    overallVerdict,
    trend: { direction, points: points.length, values: points.map((p) => Number(p.toFixed(4))) },
    buckets,
    warnings,
  }
}

/** Human-readable report. Sample sizes always printed; small buckets never "confident". */
export function formatPresetDrift(report) {
  const lines = []
  const f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : Number.isFinite(x) ? x.toFixed(d) : String(x))
  lines.push('--- preset drift: live/paper vs FROZEN backtest preset (Phase 13 item 3 — NOT D8) ---')
  lines.push(`window            : ${report.windowDays} day(s), UTC-aligned`)
  lines.push(`min trades (D12)  : ${report.minTrades} closed trades with a derivable R`)
  lines.push(`frozen preset     : ${report.frozen.chosen ?? 'none'}${report.frozen.comparable ? '' : '  [no comparable stamp]'} (R samples ${report.frozen.n})`)
  if (report.frozen.candidates.length > 1) {
    lines.push(`  other presets   : ${report.frozen.candidates.filter((c) => c.generation !== report.frozen.chosen).map((c) => `${c.generation}(${c.n})`).join(', ')} — not pooled`)
  }
  lines.push(`live generations  : ${report.liveGenerations.join(', ') || 'none'}${report.refused ? '  [REFUSED to pool — D1]' : ''}`)
  for (const w of report.warnings) lines.push(`  !! ${w}`)

  if (!report.buckets.length) {
    lines.push('buckets           : none (no live trades in the journal)')
  }
  for (const b of report.buckets) {
    const l = b.live
    lines.push(`${b.windowStart.slice(0, 10)} → ${b.windowEnd.slice(0, 10)}  ${b.generation}`)
    lines.push(`  live   : n=${l.n} closed=${l.closed} R-samples=${l.rSamples}${l.rMissing ? ` (R missing on ${l.rMissing})` : ''} WR=${l.winRate === null ? 'n/a' : f(l.winRate * 100, 1) + '%'} expectancy=${f(l.expectancyR)}R`)
    if (b.frozen) {
      lines.push(`  frozen : R-samples=${b.frozen.rSamples} WR=${b.frozen.winRate === null ? 'n/a' : f(b.frozen.winRate * 100, 1) + '%'} expectancy=${f(b.frozen.expectancyR)}R`)
    }
    if (b.confident) lines.push(`  delta  : ${f(b.deltaExpectancyR)}R expectancy, ${f(b.deltaWinRate * 100, 1)}pp win rate`)
    lines.push(`  verdict: ${b.verdict}${b.verdict === 'insufficient evidence' ? ` — ${l.insufficientReason}` : ''}`)
  }

  lines.push(`overall           : ${report.overallVerdict}`)
  if (report.overall) {
    lines.push(`  live R-samples=${report.overall.rSamples} WR=${report.overall.winRate === null ? 'n/a' : f(report.overall.winRate * 100, 1) + '%'} expectancy=${f(report.overall.expectancyR)}R`)
  }
  lines.push(`trend over time   : ${report.trend.direction} (${report.trend.points} confident bucket(s)${report.trend.points ? `: ${report.trend.values.join(', ')}R` : ''})`)
  lines.push('note              : this is a MEASUREMENT (no halt, no order). Signal parity + auto-halt is D8 = exec/drift.mjs.')
  return lines.join('\n')
}

// =============================================================================
//  IO — frozen side from reports/, live side from the journal
// =============================================================================

/** reports/trades.ndjson rows (store.saveRun) -> metric rows. */
export function frozenEntriesFromTrades(rows = []) {
  return (rows ?? []).map(metricRow)
}

export function loadFrozenEntries({ file = TRADES_FILE } = {}) {
  const { rows, skipped } = readNdjson(file)
  return { source: file, entries: frozenEntriesFromTrades(rows), skipped }
}

/**
 * Live rows from the journal (Mongo when present, else the NDJSON mirror).
 * `engineVersion`/`paramsHash` here are an explicit DECLARATION used only where
 * the row itself has no stamp; existing stamps are never overwritten.
 */
export async function loadLiveEntries({
  filters = {}, file = JOURNAL_FILE, mongo = 'auto', engineVersion = null, paramsHash = null, limit = 5000,
} = {}) {
  const loaded = await loadJournal({ filters, file, mongo, limit })
  const { entries, stamped } = stampLiveEntries(loaded.entries, { engineVersion, paramsHash })
  return { source: loaded.source, entries, declaredStamps: stamped, warnings: loaded.warnings }
}

/** Full pipeline: load both sides -> compare. Never throws for a missing DB. */
export async function runPresetDrift(opts = {}) {
  const frozen = loadFrozenEntries({ file: opts.backtestFile ?? TRADES_FILE })
  const live = await loadLiveEntries({
    filters: opts.filters ?? {},
    file: opts.liveFile ?? JOURNAL_FILE,
    mongo: opts.mongo ?? 'auto',
    engineVersion: opts.liveEngineVersion ?? null,
    paramsHash: opts.livePreset ?? null,
    limit: opts.limit ?? 5000,
  })
  const report = comparePresetDrift({
    live: live.entries,
    backtest: frozen.entries,
    windowDays: opts.windowDays,
    minTrades: opts.minTrades,
    toleranceR: opts.toleranceR,
    toleranceWinRate: opts.toleranceWinRate,
    generation: opts.generation ?? null,
  })
  report.sources = {
    live: live.source,
    liveRows: live.entries.length,
    frozen: frozen.source,
    frozenRows: frozen.entries.length,
    declaredStamps: live.declaredStamps,
    malformedLines: (live.warnings?.length ?? 0) + (frozen.skipped ?? 0),
  }
  if (live.declaredStamps) report.warnings.push(`${live.declaredStamps} live row(s) stamped from the declared live preset (their own stamp was missing)`)
  if (frozen.skipped) report.warnings.push(`${frozen.skipped} malformed line(s) skipped in ${frozen.source}`)
  return report
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const val = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  try {
    const report = await runPresetDrift({
      generation: val('--generation') ?? null,
      windowDays: val('--window') !== undefined ? Number(val('--window')) : undefined,
      minTrades: val('--min-trades') !== undefined ? Number(val('--min-trades')) : undefined,
      liveFile: val('--live') ?? JOURNAL_FILE,
      backtestFile: val('--backtest') ?? TRADES_FILE,
      livePreset: val('--live-preset') ?? null,
      liveEngineVersion: val('--live-engine-version') ?? null,
    })
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatPresetDrift(report))
    // Exit 0 even when drift is flagged: this is a measurement, not a gate.
    // The only failure exit is an unusable dataset (nothing on either side).
    process.exit(report.sources.liveRows === 0 && report.sources.frozenRows === 0 ? 2 : 0)
  } catch (e) {
    console.error('[preset-drift] error:', e?.message || e)
    process.exit(1)
  }
}
