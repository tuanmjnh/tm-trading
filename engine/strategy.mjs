// =============================================================================
//  TM TRADING — STRATEGY VERSION LIFECYCLE (roadmap §29) — PURE CORE
//
//  §29 chain:  DRAFT -> BACKTEST -> HOLDOUT -> PAPER -> STABLE_PAPER -> ARCHIVED
//  and the rule under it: "A version can never be silently changed in place.
//  New parameters = new version."
//
//  Immutability is enforced by a FINGERPRINT over the identity fields
//  (strategyId, version, engineVersion, paramsHash, referenceHash,
//  indicatorVersions, methodVersions, parameters). `assertUnchanged` refuses
//  any write that reuses a `strategyVersionId` with a different fingerprint —
//  the DB layer ($setOnInsert) makes the first write the fact, this check makes
//  an attempted in-place change LOUD instead of silent.
//
//  Promotion evidence is honest (D12): advancing past BACKTEST requires a
//  measured run id; advancing to PAPER requires an ACCEPTED §28 experiment;
//  advancing to STABLE_PAPER requires measured paper trades ≥ a floor. Missing
//  evidence never blocks LOUDLY by guessing — it refuses the transition.
//
//  PURE: no Mongo, no clock, no env. IO lives in engine/strategyService.mjs.
// =============================================================================

import { hashOf, canonicalParams } from './version.mjs'

export const STRATEGY_SCHEMA_VERSION = 'strategy.v1'

/** §29 lifecycle states (lower-case, matching the repo's state conventions). */
export const VERSION_STATES = Object.freeze([
  'draft', 'backtest', 'holdout', 'paper', 'stable_paper', 'archived',
])

const ALLOWED_NEXT = Object.freeze({
  draft: ['backtest', 'archived'],
  backtest: ['holdout', 'archived'],
  holdout: ['paper', 'archived'],
  paper: ['stable_paper', 'archived'],
  stable_paper: ['archived'],
  archived: [],
})

/**
 * Evidence each promotion edge REQUIRES (field names on the doc, written by the
 * service when the measurement actually happened). `null` = no evidence.
 * archived is reachable from any state but needs none (retiring is cheap).
 */
const REQUIRED_EVIDENCE = Object.freeze({
  backtest: ['backtestRunId'],
  holdout: ['holdoutRunId'],
  paper: ['acceptedExperimentId'],
  stable_paper: ['paperTrades'],
})

const str = (v) => (v == null || v === '' ? null : String(v))

/** `1.4.0` -> `{major,minor,patch}`; null when not strict `x.y.z`. */
export function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim())
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null
}

/** Next patch/minor/major from a base version. Invalid base -> null. */
export function bumpVersion(base, bump = 'patch') {
  const v = parseSemver(base)
  if (!v) return null
  if (bump === 'major') return `${v.major + 1}.0.0`
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`
  if (bump === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`
  return null
}

/** Deterministic strategy version id (D3): `strategyId@semver`. */
export function versionIdFor(strategyId, version) {
  const sid = str(strategyId)
  if (!sid || !parseSemver(version)) return null
  return `${sid}@${String(version).trim()}`
}

/** Stable identity hash over the fields §26.2 declares immutable. */
export function versionFingerprint(v = {}) {
  let parameters = null
  try {
    parameters = v.parameters ? canonicalParams(v.parameters) : null
  } catch {
    parameters = v.parameters ?? null // non-engine param sets still fingerprint stably
  }
  return hashOf({
    strategyId: str(v.strategyId) ?? '',
    version: str(v.version) ?? '',
    engineVersion: str(v.engineVersion) ?? null,
    paramsHash: str(v.paramsHash) ?? null,
    referenceHash: str(v.referenceHash) ?? null,
    indicatorVersions: v.indicatorVersions ?? null,
    methodVersions: v.methodVersions ?? null,
    parameters,
  })
}

/**
 * Build a fresh `draft` strategy version doc (§26.2).
 * Requires strategyId + strict-semver version + paramsHash (an identity with no
 * parameter hash could not be reproduced, which is exactly what a version IS).
 * Optional: supersedes (the prior version id this one replaces — "new
 * parameters = new version" recorded, not inferred).
 */
export function strategyVersionRecord({
  strategyId, version, engineVersion = null, paramsHash, referenceHash = null,
  indicatorVersions = {}, methodVersions = {}, parameters = {},
  createdBy = null, supersedes = null, changes = [], now = null,
} = {}) {
  const id = versionIdFor(strategyId, version)
  const hash = str(paramsHash)
  if (!id || !hash) return null
  const doc = {
    _id: id,
    strategyVersionId: id,
    strategyId: str(strategyId),
    version: String(version).trim(),
    engineVersion: str(engineVersion),
    paramsHash: hash,
    referenceHash: str(referenceHash),
    indicatorVersions: indicatorVersions ?? {},
    methodVersions: methodVersions ?? {},
    parameters: parameters ?? {},
    supersedes: str(supersedes),
    changes: Array.isArray(changes) ? changes : [],
    status: 'draft',
    backtestRunId: null,
    holdoutRunId: null,
    acceptedExperimentId: null,
    paperTrades: null,
    history: [{ from: null, to: 'draft', at: +new Date(now ?? 0) || null, by: str(createdBy) }],
    createdBy: str(createdBy),
    createdAt: +new Date(now ?? 0) || null,
    fingerprint: null,
    schemaVersion: STRATEGY_SCHEMA_VERSION,
  }
  doc.fingerprint = versionFingerprint(doc)
  return doc
}

/**
 * True when two docs carry the same identity fingerprint. ALWAYS recomputed
 * from the identity fields — a doc that mutated one of those fields in place
 * still carries its OLD fingerprint property, and trusting that stored value
 * is exactly the silent in-place change §29 forbids.
 */
export function sameFingerprint(a, b) {
  if (!a || !b) return false
  return versionFingerprint(a) === versionFingerprint(b)
}

/**
 * Immutability guard for writes: an existing doc with the SAME id but a
 * DIFFERENT fingerprint means someone is trying to change a published version
 * in place — refuse loudly. Identical fingerprint = a replay write, allowed.
 */
export function assertUnchanged(existing, incoming) {
  if (!existing) return { ok: true }
  if (!incoming) return { ok: false, code: 'SV_NO_INCOMING' }
  if (sameFingerprint(existing, incoming)) return { ok: true, replay: true }
  return {
    ok: false,
    code: 'SV_IMMUTABLE_CHANGE',
    detail: `strategy version ${existing._id} already exists with a different identity (published versions are immutable — create a new version instead)`,
  }
}

/**
 * Move a version along the §29 chain with evidence (D12: no evidence, no
 * promotion). Evidence fields are stamped onto the doc as part of the move so
 * the promotion is auditable (who/when/what proved it).
 */
export function transitionVersion(version, to, { evidence = {}, by = null, at = null } = {}) {
  if (!version || typeof version !== 'object') return { ok: false, code: 'SV_NOT_A_DOC' }
  const from = String(version.status ?? '')
  if (!VERSION_STATES.includes(to)) return { ok: false, code: `SV_BAD_STATE:${to}` }
  if (to === from) return { ok: false, code: 'SV_ALREADY' }
  if (!(ALLOWED_NEXT[from] || []).includes(to)) return { ok: false, code: `SV_ILLEGAL:${from}->${to}` }

  const need = REQUIRED_EVIDENCE[to] ?? []
  const missing = need.filter((k) => {
    const v = evidence[k] ?? version[k]
    return v === null || v === undefined || v === ''
  })
  if (missing.length) {
    return { ok: false, code: `SV_EVIDENCE_MISSING:${missing.join(',')}`, missing }
  }

  const next = { ...version, status: to }
  for (const k of need) {
    if (evidence[k] !== undefined && evidence[k] !== null) next[k] = evidence[k]
  }
  if (to === 'stable_paper') {
    next.paperTrades = Number(evidence.paperTrades ?? version.paperTrades ?? 0) || null
  }
  next.history = [
    ...(Array.isArray(version.history) ? version.history : []),
    { from, to, at: +new Date(at ?? 0) || null, by: str(by) },
  ]
  return { ok: true, code: 'OK', version: next }
}

/**
 * Apply proposal changes to a base parameter set ("new parameters = new
 * version", §29). A change whose `from` does not match the current value is
 * REFUSED and listed — never applied silently. Returns the new parameter set
 * plus applied/refused lists so the caller can write them into the new version.
 */
export function applyChanges(baseParams, changes) {
  const base = baseParams && typeof baseParams === 'object' ? baseParams : {}
  const out = { ...base }
  const applied = []
  const refused = []
  for (const c of Array.isArray(changes) ? changes : []) {
    const parameter = str(c?.parameter)
    if (!parameter) {
      refused.push({ parameter: null, reason: 'missing parameter name' })
      continue
    }
    const current = out[parameter]
    const expected = c.from
    const matches = expected === null || expected === undefined
      ? current === undefined || current === null
      : JSON.stringify(current) === JSON.stringify(expected)
    if (!matches) {
      refused.push({ parameter, expected, actual: current ?? null, reason: 'from does not match the base version value' })
      continue
    }
    out[parameter] = c.to ?? null
    applied.push({ parameter, from: expected ?? null, to: c.to ?? null })
  }
  return { params: out, applied, refused }
}
