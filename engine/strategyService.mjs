// =============================================================================
//  TM TRADING — STRATEGY VERSION LIFECYCLE IO LAYER (roadmap §29)
//
//  Thin Mongo glue over the pure core (engine/strategy.mjs). Fail-soft (D33):
//  Mongo down returns a null-bearing result, never throws, never mutates state.
//  The pure core owns the rules (immutability + evidence gates); this layer
//  only persists and hydrates.
//
//  The service is what makes "new parameters = new version" practical: from an
//  existing version + a set of changes it derives the new parameter set, its
//  paramsHash, and a candidate next version id — but it NEVER writes unless the
//  operator confirms the bump. Creating a version is a deliberate act.
// =============================================================================

import * as core from './strategy.mjs'
import { paramsHash, ENGINE_VERSION } from './version.mjs'
import { getStrategyVersion, getStrategyProfile, getExperiment } from '../services/store.mjs'

const {
  strategyVersionRecord, assertUnchanged, transitionVersion,
  applyChanges, versionIdFor, bumpVersion,
} = core

/** Read a strategy version by id. null = Mongo down or not found. */
export async function getVersion(id) {
  const M = await getStrategyVersion()
  if (!M) return null
  try {
    return await M.findOne({ _id: id }).lean()
  } catch {
    return null
  }
}

/** List versions for a strategy (all statuses). */
export async function listVersions(strategyId, { limit = 50 } = {}) {
  const M = await getStrategyVersion()
  if (!M) return []
  try {
    return await M.find({ strategyId }).sort({ createdAt: -1 }).limit(limit).lean()
  } catch {
    return []
  }
}

/**
 * Create (or confirm already-created) a draft version. $setOnInsert + the
 * fingerprint guard: an in-place change to a published version is refused, an
 * identical replay is a no-op.
 */
export async function createVersion(input) {
  const M = await getStrategyVersion()
  if (!M) return { ok: false, code: 'MONGO_DOWN', version: null }
  const doc = strategyVersionRecord(input)
  if (!doc) return { ok: false, code: 'SV_BAD_INPUT', version: null }
  const existing = await getVersion(doc._id)
  if (existing) {
    const g = assertUnchanged(existing, doc)
    if (!g.ok) return g
    return { ok: true, code: 'SV_EXISTS', replay: g.replay, version: existing }
  }
  try {
    await M.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
    return { ok: true, code: 'OK', version: doc }
  } catch (e) {
    return { ok: false, code: `SV_WRITE:${e?.message ?? 'err'}`, version: null }
  }
}

/** Promote a version along the §29 chain (evidence-gated, pure core decides). */
export async function promoteVersion(id, to, { evidence = {}, by = null } = {}) {
  const M = await getStrategyVersion()
  const cur = await getVersion(id)
  if (!M || !cur) return { ok: false, code: 'SV_NOT_FOUND', version: null }
  const res = transitionVersion(cur, to, { evidence, by, at: Date.now() })
  if (!res.ok) return res
  const patch = { status: res.version.status, history: res.version.history }
  if (res.version.backtestRunId !== cur.backtestRunId) patch.backtestRunId = res.version.backtestRunId
  if (res.version.holdoutRunId !== cur.holdoutRunId) patch.holdoutRunId = res.version.holdoutRunId
  if (res.version.acceptedExperimentId !== cur.acceptedExperimentId) patch.acceptedExperimentId = res.version.acceptedExperimentId
  if (res.version.paperTrades !== cur.paperTrades) patch.paperTrades = res.version.paperTrades
  try {
    await M.updateOne({ _id: id }, { $set: patch })
    return { ok: true, code: 'OK', version: res.version }
  } catch (e) {
    return { ok: false, code: `SV_WRITE:${e?.message ?? 'err'}`, version: null }
  }
}

/**
 * "New parameters = new version": from a base version + a change set, compute
 * the NEW parameter set, its paramsHash, and a candidate id. READ-ONLY — it
 * returns the plan; the operator confirms by calling createVersion. A change
 * whose `from` mismatches the base is refused (never applied silently).
 */
export async function planNewVersion({ strategyVersionId, changes = [], bump = 'minor', engineVersion = null, createdBy = null }) {
  const base = await getVersion(strategyVersionId)
  if (!base) return { ok: false, code: 'SV_NOT_FOUND' }
  const { params, applied, refused } = applyChanges(base.parameters, changes)
  const newParamsHash = paramsHash(params)
  const nextVersion = bumpVersion(base.version, bump)
  if (!nextVersion) return { ok: false, code: 'SV_BAD_VERSION', base: base.version }
  const candidateId = versionIdFor(base.strategyId, nextVersion)
  return {
    ok: true,
    baseVersion: base.strategyVersionId,
    candidateVersionId: candidateId,
    nextVersion,
    newParamsHash,
    engineVersion: engineVersion ?? base.engineVersion ?? ENGINE_VERSION,
    parameters: params,
    changes: applied,
    refused,
    supersedes: base.strategyVersionId,
    createdBy,
  }
}

/**
 * Activate a version as the live paper version: set the profile's
 * strategyVersionId pointer. This is the ONLY live-changing operation here —
 * and it points at an immutable version, so the live behavior is exactly the
 * published, measured configuration (D1).
 *
 * @param {{ profileId?: string, strategyVersionId?: string, by?: string | null }} [opts]
 */
export async function activatePaper({ profileId, strategyVersionId, by = null } = {}) {
  const P = await getStrategyProfile()
  const V = await getStrategyVersion()
  if (!P || !V) return { ok: false, code: 'MONGO_DOWN' }
  const ver = await V.findOne({ _id: strategyVersionId }).lean()
  if (!ver) return { ok: false, code: 'SV_NOT_FOUND' }
  if (ver.status !== 'paper' && ver.status !== 'stable_paper') {
    return { ok: false, code: `SV_NOT_PAPER_READY:${ver.status}`, detail: 'only paper/stable_paper versions may go live' }
  }
  const prof = await P.findOne({ _id: profileId }).lean()
  if (!prof) return { ok: false, code: 'PROFILE_NOT_FOUND' }
  const history = [
    ...(Array.isArray(prof.history) ? prof.history : []),
    { from: prof.strategyVersionId ?? null, to: strategyVersionId, at: +new Date(), by },
  ]
  try {
    await P.updateOne({ _id: profileId }, { $set: { strategyVersionId, status: 'active', history } })
    return { ok: true, code: 'OK', profileId, strategyVersionId }
  } catch (e) {
    return { ok: false, code: `SV_WRITE:${e?.message ?? 'err'}` }
  }
}

/**
 * Resolve the live strategy version id for an (instrument, timeframe), read at
 * a point in time. The paper executor calls this to stamp `positions` +
 * `trade_context` with the version that actually produced the trade (D1).
 * null = no live version declared (never guessed).
 */
export async function resolveLiveVersion({ instrument = null, timeframe = null } = {}) {
  const P = await getStrategyProfile()
  if (!P) return null
  try {
    const prof = await P.findOne({ status: 'active', strategyVersionId: { $ne: null } }).lean()
    if (!prof) return null
    if (instrument && Array.isArray(prof.instruments) && prof.instruments.length && !prof.instruments.includes(instrument)) return null
    if (timeframe && Array.isArray(prof.timeframes) && prof.timeframes.length && !prof.timeframes.includes(timeframe)) return null
    return prof.strategyVersionId
  } catch {
    return null
  }
}

// =============================================================================
//  CLI (npm run strategy:*)
//    node engine/strategyService.mjs create --id tm-vsa --version 1.4.0 --params-hash <h> [--params '<json>'] [--supersedes x@y] [--by user]
//    node engine/strategyService.mjs list [strategyId] [--limit 50]
//    node engine/strategyService.mjs promote <id> <state> [--evidence '<json>'] [--by user]
//    node engine/strategyService.mjs plan <baseId> --changes '<json>' [--bump minor]
//    node engine/strategyService.mjs activate <profileId> <strategyVersionId> [--by user]
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
const readJson = (s) => (s ? JSON.parse(String(s)) : null)

export async function main(argv = process.argv.slice(2)) {
  const a = parseCli(argv)
  const cmd = a._[0]
  const by = a.by ?? null

  if (cmd === 'create') {
    const params = a.params ? readJson(a.params) : {}
    const r = await createVersion({
      strategyId: a.id, version: a.version,
      paramsHash: a['params-hash'],
      engineVersion: a['engine-version'] ?? null,
      indicatorVersions: a['indicator-versions'] ? readJson(a['indicator-versions']) : {},
      methodVersions: a['method-versions'] ? readJson(a['method-versions']) : {},
      parameters: params,
      supersedes: a.supersedes ?? null,
      createdBy: by, now: Date.now(),
    })
    console.log(JSON.stringify(r, null, 2)); return r
  }
  if (cmd === 'list') {
    const rows = await listVersions(a._[1] ?? a.id ?? '', { limit: a.limit ? Number(a.limit) : 50 })
    console.log(rows.map((r) => `${r.status.padEnd(13)} ${r.strategyVersionId}  ph=${String(r.paramsHash).slice(0, 12)}`).join('\n') || '(none)')
    return rows
  }
  if (cmd === 'promote') {
    const r = await promoteVersion(a._[1], a._[2], { evidence: a.evidence ? readJson(a.evidence) : {}, by })
    console.log(JSON.stringify({ ok: r.ok, code: r.code, status: r.version?.status ?? null }, null, 2)); return r
  }
  if (cmd === 'plan') {
    const r = await planNewVersion({ strategyVersionId: a._[1], changes: a.changes ? readJson(a.changes) : [], bump: a.bump ?? 'minor', createdBy: by })
    console.log(JSON.stringify(r, null, 2)); return r
  }
  if (cmd === 'activate') {
    const r = await activatePaper({ profileId: a._[1], strategyVersionId: a._[2], by })
    console.log(JSON.stringify(r, null, 2)); return r
  }
  console.error('usage: create | list | promote | plan | activate')
  return null
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main()
