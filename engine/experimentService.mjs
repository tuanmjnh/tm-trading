// =============================================================================
//  TM TRADING — EXPERIMENT ENGINE IO LAYER (roadmap §28)
//
//  Thin Mongo glue over the pure core (engine/experiment.mjs). Every function
//  is fail-soft (D33): Mongo down returns a `null`-bearing result, it never
//  throws and never mutates the in-memory state. The pure core owns the rules;
//  this layer only persists and hydrates.
//
//  `runExperimentArms` wires the experiment lifecycle to the engine's own
//  backtest (`engine/run.mjs runOne`) so every arm's metrics come from the
//  SAME summarizeRuns() block — no second, subtly different scorer.
// =============================================================================

import * as core from './experiment.mjs'
import { getExperiment, getExperimentRun, getAiProposal } from '../services/store.mjs'

const {
  experimentFromProposal, transition, withArm, acceptanceReport,
  experimentIdFor, armMetrics, EXPERIMENT_STATES,
} = core

/**
 * Record a validated AI proposal in `ai_proposals` ($setOnInsert, D4).
 * Proposals are DATA (D7) — this write changes no preset and no risk state.
 */
export async function persistAiProposal(proposal, { generation = null } = {}) {
  const AiProposal = await getAiProposal()
  if (!AiProposal || !proposal) return { ok: false, code: 'MONGO_DOWN' }
  const doc = {
    _id: proposal.proposalId,
    proposalId: proposal.proposalId,
    strategyVersionId: proposal.strategyVersionId ?? null,
    hypothesis: proposal.hypothesis,
    changes: proposal.changes ?? [],
    evidence: proposal.evidence ?? [],
    risks: proposal.risks ?? [],
    recommendedTest: proposal.recommendedTest ?? {},
    generation,
    status: 'new',
  }
  try {
    await AiProposal.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
    return { ok: true, code: 'OK', doc }
  } catch (e) {
    return { ok: false, code: `EXP_WRITE:${e?.message ?? 'err'}` }
  }
}

/** Persist a fresh proposal as a `proposed` experiment ($setOnInsert, D4). */
export async function persistProposal(proposal, { now = Date.now() } = {}) {
  const Experiment = await getExperiment()
  if (!Experiment) return { ok: false, code: 'MONGO_DOWN', exp: null }
  const doc = experimentFromProposal(proposal, { now })
  if (!doc) return { ok: false, code: 'EXP_NOT_A_DOC', exp: null }
  try {
    await Experiment.updateOne(
      { _id: doc._id },
      { $setOnInsert: doc },
      { upsert: true },
    )
    return { ok: true, code: 'OK', exp: doc }
  } catch (e) {
    return { ok: false, code: `EXP_WRITE:${e?.message ?? 'err'}`, exp: null }
  }
}

/** Read an experiment by id. null = Mongo down or not found. */
export async function getExperimentById(id) {
  const Experiment = await getExperiment()
  if (!Experiment) return null
  try {
    return await Experiment.findOne({ _id: id }).lean()
  } catch {
    return null
  }
}

/**
 * Move an experiment to a new state, persisting the doc atomically with the
 * transition. `at` defaults to now.
 */
export async function moveExperiment(id, to, { at = Date.now(), data = null } = {}) {
  const current = await getExperimentById(id)
  if (!current) return { ok: false, code: 'EXP_NOT_FOUND', exp: null }
  const res = transition(current, to, { at, data })
  if (!res.ok) return res
  const Experiment = await getExperiment()
  if (!Experiment) return { ok: false, code: 'MONGO_DOWN', exp: null }
  try {
    await Experiment.updateOne({ _id: id }, { $set: { status: to, arms: res.exp.arms, history: res.exp.history } })
    return { ok: true, code: 'OK', exp: res.exp }
  } catch (e) {
    return { ok: false, code: `EXP_WRITE:${e?.message ?? 'err'}`, exp: null }
  }
}

/**
 * Run one arm of an experiment through the engine backtest and record it.
 * `role` is one of ARM_NAMES. The run is re-scoped to the experiment's
 * recommendedTest symbols/timeframes when present (the candidate's own test
 * plan), falling back to the supplied defaults.
 */
export async function runArm({ experimentId, role, params, method = 'vsa', symbols, timeframes, market = 'fapi', runOne, now = Date.now() }) {
  const Experiment = await getExperiment()
  const ExpRun = await getExperimentRun()
  if (!Experiment || !ExpRun) return { ok: false, code: 'MONGO_DOWN' }
  const exp = await getExperimentById(experimentId)
  if (!exp) return { ok: false, code: 'EXP_NOT_FOUND' }

  const rec = exp.recommendedTest ?? {}
  const syms = Array.isArray(symbols) && symbols.length ? symbols : (Array.isArray(rec.symbols) ? rec.symbols : ['BTCUSDT'])
  const tfs = Array.isArray(timeframes) && timeframes.length ? timeframes : (Array.isArray(rec.timeframes) ? rec.timeframes : ['15m'])

  // The caller supplies runOne (engine/run.mjs) so tests stay offline. Each
  // (symbol, tf) is one backtest; the arm summary is the multi-run summary.
  const runs = []
  for (const sym of syms) for (const tf of tfs) {
    const r = await runOne({
      api: sym, display: sym, tf, market, method, params,
      mongo: false, runsFile: null, tradesFile: null,
    })
    if (!r || r.excluded) continue
    runs.push({ ...r, trades: r.trades, engineVersion: r.summary?.engineVersion, paramsHash: r.summary?.paramsHash })
  }

  // Reuse summarizeRuns over the collected runs (D1: single generator). All
  // runs of one arm share the same params, so a single generation is valid;
  // the rep-stamp comes from the first run (paramsHash/engineVersion ride on
  // the run doc, not the summary).
  let summary = null
  const stampOf = runs[0] || null
  try {
    const { summarizeRuns } = await import('./store.mjs')
    summary = summarizeRuns(runs.map((r) => ({ ...r, engineVersion: r.summary?.engineVersion, paramsHash: r.summary?.paramsHash })), { label: `exp:${experimentId}:${role}` })
  } catch {
    summary = null
  }
  if (summary) {
    if (stampOf) {
      summary.paramsHash = stampOf.summary?.paramsHash ?? null
      summary.engineVersion = stampOf.summary?.engineVersion ?? null
    }
    summary = { ...summary, paramsHash: summary.paramsHash ?? null, engineVersion: summary.engineVersion ?? null }
  }

  const id = `${experimentId}:${role}`
  const doc = {
    _id: id, experimentId, role,
    config: { params, method, symbols: syms, timeframes: tfs, market },
    summary,
    runHash: summary?.paramsHash ?? null,
    engineVersion: summary?.engineVersion ?? null,
    paramsHash: summary?.paramsHash ?? null,
    symbols: syms, timeframes: tfs,
    runIds: runs.map((r) => r.runId).filter(Boolean),
    recordedAt: now,
  }
  try {
    await ExpRun.updateOne({ _id: id }, { $setOnInsert: doc }, { upsert: true })
  } catch (e) {
    return { ok: false, code: `EXP_WRITE:${e?.message ?? 'err'}` }
  }

  // Fold the arm into the experiment doc's arms map (data-only, no state change).
  // armMetrics reads `run.summary` — pass the stamped summary in that shape.
  const folded = withArm(exp, role, { summary })
  const arms = folded.ok ? folded.exp.arms : exp.arms
  try {
    await Experiment.updateOne({ _id: experimentId }, { $set: { arms } })
  } catch { /* arms fold is best-effort */ }

  return { ok: true, code: 'OK', summary, runIds: doc.runIds }
}

/**
 * Accept or reject an experiment. Accept requires the §28.3 gate to pass; the
 * gate is re-computed on the persisted arms, so a stale doc cannot sneak in.
 */
export async function decide({ experimentId, accept, opts = {}, at = Date.now() }) {
  const exp = await getExperimentById(experimentId)
  if (!exp) return { ok: false, code: 'EXP_NOT_FOUND' }
  if (accept) {
    const rep = acceptanceReport(exp, opts)
    if (!rep.ok) return { ok: false, code: 'EXP_GATE_FAILED', gates: rep.gates, exp: null }
    return moveExperiment(experimentId, 'accepted', { at, data: { acceptance: rep.gates } })
  }
  return moveExperiment(experimentId, 'rejected', { at })
}

/** Hydrate an experiment doc with its recorded arm runs, if any. */
export async function withArmRuns(exp) {
  if (!exp) return exp
  const ExpRun = await getExperimentRun()
  if (!ExpRun) return exp
  try {
    const rows = await ExpRun.find({ experimentId: exp._id }).lean()
    const arms = { ...(exp.arms ?? {}) }
    for (const r of rows) arms[r.role] = { ...(arms[r.role] ?? {}), run: r }
    return { ...exp, arms }
  } catch {
    return exp
  }
}

/** Compare + gate report for the console (npm run experiment:report). */
export async function report(experimentId, opts = {}) {
  const exp = await withArmRuns(await getExperimentById(experimentId))
  if (!exp) return { ok: false, code: 'EXP_NOT_FOUND' }
  const arms = Object.values(exp.arms ?? {}).map((a) => ({
    name: a.name ?? a.role,
    metrics: a.metrics ?? armMetrics(a.run),
  }))
  return { ok: true, experiment: exp, comparison: core.compareArms(arms), acceptance: acceptanceReport(exp, opts) }
}

// =============================================================================
//  CLI (npm run experiment:* — roadmap §28 CLI trio+)
//    node engine/experimentService.mjs create --proposal '<json>' [--file f]
//    node engine/experimentService.mjs run <expId> --role baseline --preset default [--params '<json>'] [--symbols A,B] [--tfs 15m] [--no-mongo]
//    node engine/experimentService.mjs move <expId> <state>
//    node engine/experimentService.mjs decide <expId> <accept|reject> [--min-trades 30]
//    node engine/experimentService.mjs report <expId> [--min-trades 30]
//    node engine/experimentService.mjs list [--status running] [--limit 20]
// =============================================================================

function parseCli(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (!t.startsWith('--')) { a._.push(t); continue }
    const eq = t.indexOf('=')
    if (eq >= 0) { a[t.slice(2, eq)] = t.slice(eq + 1); continue }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { a[t.slice(2)] = next; i++ } else { a[t.slice(2)] = true }
  }
  return a
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseCli(argv)
  const cmd = a._[0]
  const { readFileSync } = await import('node:fs')

  const readObj = (raw) => {
    if (!raw) return {}
    if (a.file) return JSON.parse(readFileSync(String(a.file), 'utf8'))
    return JSON.parse(String(raw))
  }

  if (cmd === 'create') {
    const prop = a.proposal ? readObj(a.proposal) : (await import('../ai/proposal.mjs')).validateProposal(readObj(a.file ?? '{}'))?.proposal
    const r = await persistProposal(prop ?? {})
    console.log(JSON.stringify(r.exp ?? r, null, 2))
    return r
  }

  if (cmd === 'run') {
    const expId = a._[1]
    const role = a.role
    const presets = await import('./run.mjs')
    const runOpt = {
      params: a.params ? readObj(a.params) : (presets.PRESETS[String(a.preset ?? 'default')] ?? {}),
      method: a.method ?? 'vsa',
      symbols: a.symbols ? String(a.symbols).split(',') : undefined,
      timeframes: a.tfs ? String(a.tfs).split(',') : undefined,
      market: a.market ?? 'fapi',
      runOne: (o) => presets.runOne({ ...o, mongo: a['no-mongo'] ? false : 'auto' }),
    }
    const r = await runArm({ experimentId: expId, role, ...runOpt })
    console.log(JSON.stringify(r, null, 2))
    return r
  }

  if (cmd === 'move') {
    const r = await moveExperiment(a._[1], a._[2], {})
    console.log(JSON.stringify({ ok: r.ok, code: r.code, status: r.exp?.status ?? null }, null, 2))
    return r
  }

  if (cmd === 'decide') {
    const r = await decide({ experimentId: a._[1], accept: a._[2] === 'accept', opts: { minTrades: a['min-trades'] ? Number(a['min-trades']) : undefined } })
    console.log(JSON.stringify({ ok: r.ok, code: r.code, status: r.exp?.status ?? null }, null, 2))
    return r
  }

  if (cmd === 'report') {
    const r = await report(a._[1], { minTrades: a['min-trades'] ? Number(a['min-trades']) : undefined })
    console.log(JSON.stringify(r, null, 2))
    return r
  }

  if (cmd === 'list') {
    const { getExperiment } = await import('../services/store.mjs')
    const Model = await getExperiment()
    if (!Model) { console.error('Mongo unavailable'); return null }
    const q = a.status ? { status: String(a.status) } : {}
    const rows = await Model.find(q).sort({ createdAt: -1 }).limit(Number(a.limit ?? 20)).lean()
    console.log(rows.map((r) => `${r.status.padEnd(15)} ${r.experimentId}  ${r.hypothesis ?? ''}`).join('\n') || '(none)')
    return rows
  }

  console.error('usage: create | run | move | decide | report | list')
  return null
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main()
