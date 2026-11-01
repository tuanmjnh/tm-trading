// =============================================================================
//  TM TRADING — READINESS EVALUATION (V4.2 §17.4)
//
//  "The process has a pid" is not readiness. §17.4 defines READY as:
//
//    process alive  AND  dependencies reachable  AND  initialisation complete
//
//  and DEGRADED as READY followed by a failed functional/freshness check. This
//  module is the pure half of that contract: the supervisor collects evidence,
//  this file turns evidence into a verdict. It never probes anything itself and
//  never assumes a missing signal is a passing one.
//
//  Evidence fields are tri-state on purpose:
//
//    true      observed and passing
//    false     observed and failing
//    null      NOT OBSERVED — which is not a pass
//
//  A required rule with `null` blocks READY (we have not proven readiness).
//  An optional rule with `null` does NOT downgrade to DEGRADED (absence of
//  evidence is not evidence of a fault).
// =============================================================================

/** @typedef {import('../shared/types/service').ManagedServiceDefinition} ManagedServiceDefinition */
/** @typedef {import('../shared/types/service').ServiceReadinessReport} ServiceReadinessReport */
/** @typedef {import('../shared/types/service').ServiceReadinessCheck} ServiceReadinessCheck */
/** @typedef {import('../shared/types/service').ObservedServiceState} ObservedServiceState */
/** @typedef {import('../shared/types/service').ServiceHealth} ServiceHealth */

export const READINESS_SCHEMA_VERSION = 'readiness.v1'

/** Allowed future skew before a timestamp is treated as bad evidence. */
export const EVIDENCE_CLOCK_SKEW_MS = 5_000

/** @typedef {{ passed: boolean | null, detail?: string }} RuleVerdict */

/**
 * Evidence the supervisor must supply. Every field may be absent or `null`.
 *
 * @typedef {object} ReadinessEvidence
 * @property {boolean | null} [processAlive]
 * @property {boolean | null} [dependenciesReachable]
 * @property {boolean | null} [subscriptionAcked]
 * @property {number | null} [lastEventAt]        epoch ms
 * @property {number | null} [lastSuccessAt]      epoch ms
 * @property {number | null} [lastOutputCount]
 * @property {boolean | null} [capabilityVerified]
 * @property {boolean | null} [lastJobValidated]
 * @property {number | null} [outboxLastConsumedAt] epoch ms
 * @property {boolean | null} [sinkWritable]
 */

/**
 * @typedef {object} ReadinessContext
 * @property {number} now
 * @property {number | null} intervalSec
 * @property {number} staleAfterMs
 * @property {number} freshEventMaxAgeMs
 * @property {number} outboxMaxAgeMs
 */

/** @param {boolean | null | undefined} value */
function triState(value, failDetail, passDetail) {
  if (value === true) return { passed: true, detail: passDetail }
  if (value === false) return { passed: false, detail: failDetail }
  return { passed: null, detail: 'no evidence' }
}

/**
 * Freshness-style rule: a timestamp must exist and be recent enough.
 *
 * @param {number | null | undefined} at
 * @param {number} maxAgeMs
 * @param {number} now
 * @param {string} failDetail
 * @returns {RuleVerdict}
 */
function recentEnough(at, maxAgeMs, now, failDetail) {
  if (at === null || at === undefined) return { passed: null, detail: 'no evidence' }
  if (!Number.isFinite(at)) return { passed: null, detail: 'invalid timestamp' }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return { passed: null, detail: 'invalid window' }
  const ageMs = now - at
  if (ageMs < -EVIDENCE_CLOCK_SKEW_MS) return { passed: false, detail: 'timestamp is in the future' }
  const ageSec = Math.round(Math.max(0, ageMs) / 1000)
  if (ageMs <= maxAgeMs) return { passed: true, detail: `last seen ${ageSec}s ago` }
  return {
    passed: false,
    detail: `${failDetail} (${ageSec}s > ${Math.round(maxAgeMs / 1000)}s)`,
  }
}

/**
 * Readiness rule evaluators, keyed by rule id.
 *
 * @type {Record<string, (evidence: ReadinessEvidence, context: ReadinessContext) => RuleVerdict>}
 */
export const READINESS_RULES = Object.freeze({
  'process-alive': evidence =>
    triState(evidence.processAlive, 'process is not running', 'process is alive'),

  'dependency-reachable': evidence =>
    triState(evidence.dependenciesReachable, 'a required dependency is not ready', 'required dependencies are ready'),

  'subscription-acked': evidence =>
    triState(evidence.subscriptionAcked, 'subscription was not acknowledged', 'subscription acknowledged'),

  'fresh-event': (evidence, context) =>
    recentEnough(evidence.lastEventAt, context.freshEventMaxAgeMs, context.now, 'no market event within the window'),

  'recent-success': (evidence, context) =>
    recentEnough(evidence.lastSuccessAt, context.staleAfterMs, context.now, 'no completed cycle within the window'),

  'output-produced': (evidence) => {
    const count = evidence.lastOutputCount
    if (count === null || count === undefined) return { passed: null, detail: 'no evidence' }
    if (!Number.isFinite(count)) return { passed: null, detail: 'invalid output count' }
    if (count > 0) return { passed: true, detail: `${count} output rows` }
    return { passed: false, detail: 'the last cycle produced no output' }
  },

  'capability-verified': evidence =>
    triState(evidence.capabilityVerified, 'provider capability could not be verified', 'provider capability verified'),

  'validated-job': evidence =>
    triState(evidence.lastJobValidated, 'the last job did not pass validation', 'the last job passed validation'),

  'outbox-consuming': (evidence, context) =>
    recentEnough(evidence.outboxLastConsumedAt, context.outboxMaxAgeMs, context.now, 'delivery outbox is not being consumed'),

  'sink-writable': evidence =>
    triState(evidence.sinkWritable, 'output sink is not writable', 'output sink is writable'),
})

/** Stable list of rule ids, used by the registry to validate declarations. */
export const READINESS_RULE_IDS = Object.freeze(Object.keys(READINESS_RULES))

/**
 * Per-definition freshness windows.
 *
 * The defaults are derived from the cycle cadence, which is right for most
 * services but wrong for a feed that must see an event more often than it runs
 * a cycle (or for a delivery outbox consumed by another worker). A definition
 * may therefore override any window explicitly.
 *
 * @param {ManagedServiceDefinition} definition
 * @returns {{ staleAfterMs?: number, freshEventMaxAgeMs?: number, outboxMaxAgeMs?: number }}
 */
export function readinessOptions(definition) {
  const options = {}
  for (const key of ['staleAfterMs', 'freshEventMaxAgeMs', 'outboxMaxAgeMs']) {
    const value = definition?.[key]
    if (Number.isFinite(value) && Number(value) > 0) options[key] = Number(value)
  }
  return options
}

/**
 * Evaluate every declared readiness rule for one service.
 *
 * @param {ManagedServiceDefinition} definition
 * @param {ReadinessEvidence} [evidence]
 * @param {{ now?: number, staleAfterMs?: number, freshEventMaxAgeMs?: number, outboxMaxAgeMs?: number }} [options]
 * @returns {ServiceReadinessReport}
 */
export function evaluateReadiness(definition, evidence = {}, options = {}) {
  const now = options.now ?? Date.now()
  const intervalMs = Number.isFinite(definition.intervalSec) && definition.intervalSec > 0
    ? definition.intervalSec * 1000
    : 300_000
  const defaultWindowMs = Math.max(intervalMs * 2, 60_000)

  /** @type {ReadinessContext} */
  const context = {
    now,
    intervalSec: definition.intervalSec,
    staleAfterMs: options.staleAfterMs ?? defaultWindowMs,
    freshEventMaxAgeMs: options.freshEventMaxAgeMs ?? 60_000,
    outboxMaxAgeMs: options.outboxMaxAgeMs ?? defaultWindowMs,
  }

  /** @type {ServiceReadinessCheck[]} */
  const checks = []
  for (const declared of definition.readiness ?? []) {
    const evaluator = READINESS_RULES[declared.id]
    const result = evaluator
      ? evaluator(evidence, context)
      : { passed: null, detail: 'unknown readiness rule' }
    checks.push({
      id: declared.id,
      label: declared.label,
      required: declared.required,
      passed: result.passed,
      detail: result.detail,
    })
  }

  const blocking = checks.filter(check => check.required && check.passed !== true).map(check => check.id)
  const ready = blocking.length === 0
  const degraded = ready && checks.some(check => !check.required && check.passed === false)

  return { ready, degraded, blocking, checks }
}

/**
 * Derive the observed lifecycle state.
 *
 * STARTING is bounded by `startupGraceMs`: a service that never proves
 * readiness within its boot budget becomes FAILED, not STARTING forever.
 *
 * @param {{
 *   desired: 'RUNNING' | 'STOPPED',
 *   processAlive: boolean | null,
 *   readiness: ServiceReadinessReport | null,
 *   startedAt?: number | null,
 *   startupGraceMs?: number,
 *   now?: number,
 *   stopping?: boolean,
 * }} input
 * @returns {ObservedServiceState}
 */
export function deriveObservedState(input) {
  const {
    desired,
    processAlive,
    readiness,
    startedAt = null,
    startupGraceMs = 60_000,
    now = Date.now(),
    stopping = false,
  } = input

  if (stopping) return 'STOPPING'
  if (processAlive === null || processAlive === undefined) return 'UNKNOWN'
  if (processAlive === false) return desired === 'RUNNING' ? 'FAILED' : 'STOPPED'
  if (readiness?.ready) return readiness.degraded ? 'DEGRADED' : 'READY'

  const withinGrace = startedAt !== null && Number.isFinite(startedAt) && now - startedAt <= startupGraceMs
  return withinGrace ? 'STARTING' : 'FAILED'
}

/**
 * Health is only meaningful once a state is observed; FAILED is unhealthy by
 * definition and STARTING has no health verdict yet.
 *
 * @param {ObservedServiceState} observed
 * @returns {ServiceHealth}
 */
export function deriveServiceHealth(observed) {
  if (observed === 'FAILED') return 'UNHEALTHY'
  if (observed === 'READY') return 'HEALTHY'
  if (observed === 'DEGRADED') return 'DEGRADED'
  return 'UNKNOWN'
}

/** States that mean "something is running or about to be". */
const RUNNING_STATES = new Set(['STARTING', 'READY', 'DEGRADED', 'STOPPING'])

/**
 * Desired/observed drift.
 *
 * `UNKNOWN` counts as drift in both directions: we cannot prove the operator's
 * intent is being honoured, so the supervisor must reconcile it.
 *
 * @param {'RUNNING' | 'STOPPED'} desired
 * @param {ObservedServiceState} observed
 * @returns {boolean}
 */
export function isDrifted(desired, observed) {
  // UNKNOWN means we cannot prove the operator's intent is being honoured, so
  // the supervisor must reconcile in both directions.
  if (observed === 'UNKNOWN') return true
  if (desired === 'RUNNING') return !RUNNING_STATES.has(observed)
  return RUNNING_STATES.has(observed)
}
