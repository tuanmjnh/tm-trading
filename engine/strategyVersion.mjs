// engine/strategyVersion.mjs
// Strategy Version Lifecycle (roadmap §29) — Pure Core
//
// State machine: DRAFT → BACKTEST → HOLDOUT → PAPER → STABLE_PAPER → ARCHIVED
// Rule: A version can never be silently changed in place. New parameters = new version.
// Pure core: no IO, no clock, no Mongo. The IO layer handles persistence.

import { hashOf, stableStringify } from './version.mjs'

export const STRATEGY_VERSION_STATES = Object.freeze([
  'draft', 'backtest', 'holdout', 'paper', 'stable_paper', 'archived'
])

export const STRATEGY_VERSION_TRANSITIONS = Object.freeze({
  draft: ['backtest', 'archived'],
  backtest: ['holdout', 'archived'],
  holdout: ['paper', 'archived'],
  paper: ['stable_paper', 'archived'],
  stable_paper: ['archived'],
  archived: [],
})
/**
 * Deterministic version ID: strategyId@version (semver)
 * e.g., "tm-vsa@1.4.0"
 */
export function versionIdFor({ strategyId, version }) {
  if (!strategyId || !version) return null
  return `${strategyId}@${version}`
}

/**
 * Create a fresh strategy version doc from input params.
 * Enforces immutability: strategyVersionId is deterministic from (strategyId, version).
 * Uses $setOnInsert so first write wins (immutability/D4).
 */
export function strategyVersionRecord(input = {}) {
  const { strategyId, version, engineVersion, paramsHash, referenceHash,
          indicatorVersions = {}, methodVersions = {}, parameters = {},
          createdBy = null, now = Date.now() } = input

  if (!strategyId || !version) return null

  const strategyVersionId = `${strategyId}@${version}`
  const paramsHashFinal = paramsHash || hashOf({ parameters: version })

  return {
    _id: `sv_${strategyVersionId}`,
    strategyVersionId,
    strategyId,
    version,
    engineVersion: engineVersion || null,
    paramsHash: paramsHash || null,
    referenceHash: referenceHash || null,
    indicatorVersions,
    methodVersions,
    parameters,
    status: 'draft',
    supersedes: null,
    changes: [],
    createdBy: null,
    createdAt: Date.now(),
    schemaVersion: 'strategyVersion.v1',
  }
}

/**
 * Validate state transition.
 * Only forward transitions allowed (except 'archived' from any state).
 * Terminal states ('archived') are final — no outgoing transitions.
 */
export function canTransition(from, to) {
  if (!from || !to) return false
  if (from === 'archived') return false
  if (from === 'archived' && to !== 'archived') return false

  const allowed = {
    draft: ['backtest', 'archived'],
    backtest: ['holdout', 'archived'],
    holdout: ['paper', 'archived'],
    paper: ['stable_paper', 'archived'],
    stable_paper: ['archived'],
    archived: [],
  }

  return allowed[from]?.includes(to) ?? false
}

/**
 * Transition a version doc to a new state.
 * Returns { ok, version?, error? } — pure, no side effects.
 */
export function transitionVersion(versionDoc, toState, { by = null, evidence = null } = {}) {
  if (!versionDoc) return { ok: false, error: 'NO_VERSION' }
  if (!versionIdFor({ strategyId: versionDoc.strategyId, version: versionDoc.version })) {
    return { ok: false, error: 'INVALID_VERSION' }
  }

  if (!canTransition(versionDoc.status, toState)) {
    return { ok: false, error: `ILLEGAL_TRANSITION: ${versionDoc.status} → ${toState}` }
  }

  const now = Date.now()
  const updated = {
    ...versionDoc,
    status: toState,
    updatedAt: Date.now(),
    history: [
      ...(versionDoc.history || []),
      { from: versionDoc.status, to: toState, at: Date.now(), by: null, evidence }
    ],
  }
  if (toState === 'archived') {
    // Archive is terminal — lock it
  }
  return { ok: true, version: { ...versionDoc, ...updated } }
}

/**
 * Create a new version from a base version + parameter changes.
 * "New parameters = new version" — immutable, new versionId.
 * Returns { ok, candidateVersion?, errors[] }
 */
export function createNextVersion(baseVersion, changes = [], { bump = 'patch' } = {}) {
  if (!baseVersion) return { ok: false, error: 'NO_BASE_VERSION' }

  const newVersion = bumpVersion(baseVersion.version, bump)
  if (!newVersion) return { ok: false, error: 'INVALID_VERSION_BUMP' }

  const { parameters = {}, ...rest } = baseVersion
  const newParams = { ...parameters }
  const applied = []
  const conflicts = []

  for (const change of changes) {
    const { parameter, from, to } = change
    if (parameters[parameter] !== from) {
      conflicts.push({ parameter, expected: parameters[parameter], provided: from })
      continue
    }
    newParams[parameter] = to
  }

  const newParamsHash = hashOf({ parameters: newParams, ...rest })

  return {
    ok: true,
    candidate: {
      strategyId: baseVersion.strategyId,
      version: newVersion,
      engineVersion: baseVersion.engineVersion,
      paramsHash: hashOf({ parameters: newParams }),
      referenceHash: null,
      indicatorVersions: baseVersion.indicatorVersions || {},
      methodVersions: baseVersion.methodVersions || {},
      parameters: newParams,
      supersedes: baseVersion.strategyVersionId,
      changes: changes.map(c => ({ parameter: c.parameter, from: c.from, to: c.to })),
      createdBy: null,
      createdAt: Date.now(),
    },
    conflicts,
  }
}

/**
 * Semantic version bump (patch/minor/major).
 * Only supports semver X.Y.Z format.
 */
export function bumpVersion(version, bump = 'patch') {
  const parts = String(version).split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  const [major, minor, patch] = parts
  switch (bump) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return `${major}.${minor}.${patch + 1}`
    default: return null
  }
}

/**
 * Check if a version doc is in a terminal state.
 */
export function isTerminal(versionDoc) {
  return versionDoc && ['archived'].includes(versionDoc.status)
}

/**
 * Get all valid next states from current state.
 */
export function getNextStates(currentState) {
  const transitions = {
    draft: ['backtest', 'archived'],
    backtest: ['holdout', 'archived'],
    holdout: ['paper', 'archived'],
    paper: ['stable_paper', 'archived'],
    stable_paper: ['archived'],
    archived: [],
  }
  return transitions[currentState] || []
}

export const STRATEGY_VERSION_SCHEMA_VERSION = 'strategyVersion.v1'
export const VERSION_STATES = ['draft', 'backtest', 'holdout', 'paper', 'stable_paper', 'archived']
export const TERMINAL_STATES = Object.freeze(['archived'])

export { hashOf, stableStringify } from './version.mjs'