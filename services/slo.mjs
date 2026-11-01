// =============================================================================
//  TM TRADING — PER-SERVICE SLOs (V4.2 §17.13)
//
//  An SLO is only honest if its inputs are things the system actually measures.
//  This module therefore defines exactly three objectives, each fed by evidence
//  the supervisor already collects — nothing is inferred or invented:
//
//    freshness   the service completed a cycle within its interval budget
//                (input: lastSuccessAt, definition.intervalSec)
//    flapping    it is not crash-looping
//                (input: the supervisor audit trail within a window)
//    saturation  its process is not overwhelmed
//                (input: the A7 telemetry sample, via evaluateTelemetry)
//
//  Deliberately NOT here: "availability %" or "error rate", which would need a
//  request/uptime time series this system does not record. Reporting a number we
//  cannot measure is exactly the measurement dishonesty D12 forbids.
//
//  Verdicts are `ok | at-risk | breached | unknown`, and `unknown` never counts
//  as a pass. Pure over its inputs, so every rule is unit-tested.
// =============================================================================

import { evaluateTelemetry } from './telemetry.mjs'

/** Version stamp (D1). */
export const SLO_SCHEMA_VERSION = 'service-slo.v1'

export const SLO_STATUSES = Object.freeze(['breached', 'at-risk', 'ok', 'unknown'])

/** How many cycles may pass before a "recent success" is late, then late enough to breach. */
export const DEFAULT_FRESHNESS_FACTOR = 3

/** Restart-shaped audit rows per hour that count as at-risk, then breached. */
export const DEFAULT_RESTART_WARN = 2
export const DEFAULT_RESTART_BREACH = 4

/** Flapping, measured over the last hour. */
export const FLAP_WINDOW_MS = 3_600_000

/** A cycle window never shorter than this, so a 60 s service is not judged per minute. */
const MIN_FRESHNESS_WINDOW_MS = 300_000

/** Audit actions that mean "this worker did not stay up". */
const UNHEALTHY_EXIT_ACTIONS = Object.freeze(['crash-restart', 'worker-exited'])

/**
 * Whether an objective applies to a service at all.
 *
 * A STOPPED service has no duty, and reporting it as "breached" would make every
 * deliberately stopped service look like an outage.
 */
export function serviceHasDuty(record) {
  return Boolean(record) && record.desired === 'RUNNING'
}

/** The freshness budget in ms: `factor × interval`, with a floor. */
export function freshnessWindowMs(definition, factor = DEFAULT_FRESHNESS_FACTOR) {
  const rawInterval = definition?.intervalSec
  // An invalid interval returns the floor directly. It must NOT fall through to
  // the multiplication below, where the floor would be scaled by the factor and
  // silently report a 900 s budget for a service that declared no interval.
  if (!Number.isFinite(rawInterval) || rawInterval <= 0) return MIN_FRESHNESS_WINDOW_MS
  return Math.max(MIN_FRESHNESS_WINDOW_MS, Math.round(rawInterval * 1000 * factor))
}

/** Keeping the worst verdict: breached > at-risk > ok > unknown. */
function worstStatus(statuses) {
  for (const status of SLO_STATUSES) {
    if (statuses.includes(status)) return status
  }
  return 'unknown'
}

function triage(ageMs, windowMs) {
  if (ageMs <= windowMs) return 'ok'
  if (ageMs <= windowMs * 2) return 'at-risk'
  return 'breached'
}

/**
 * Count restart-shaped audit rows inside the window.
 *
 * @param {ReadonlyArray<{ action?: unknown, at?: unknown }>} audit
 * @param {number} now
 * @param {string[]} [actions]
 */
export function countUnhealthyExits(audit, now, actions = UNHEALTHY_EXIT_ACTIONS, serviceId = null) {
  let count = 0
  for (const row of audit ?? []) {
    if (!row || !actions.includes(String(row.action))) continue
    if (serviceId && row.serviceId && row.serviceId !== serviceId) continue
    const at = Number(row.at)
    if (!Number.isFinite(at) || at < now - FLAP_WINDOW_MS) continue
    count += 1
  }
  return count
}

/**
 * Evaluate the three objectives for one service.
 *
 * @param {{
 *   definition: import('../shared/types/service').ManagedServiceDefinition,
 *   record: object | null,
 *   audit?: ReadonlyArray<object>,
 *   now?: number,
 *   restartsWarn?: number,
 *   restartsBreach?: number,
 * }} input
 * @returns {{
 *   schemaVersion: string,
 *   status: string,
 *   objectives: Array<{ id: string, status: string, detail: string }>
 * }}
 */
export function evaluateSlo(input) {
  const {
    definition,
    record = null,
    audit = [],
    now = Date.now(),
    restartsWarn = DEFAULT_RESTART_WARN,
    restartsBreach = DEFAULT_RESTART_BREACH,
  } = input

  const objectives = []
  const duty = serviceHasDuty(record)

  // A service the operator has not asked to run has NO SLO. Reporting it as `ok`
  // would paint a never-started or deliberately stopped service green, which is
  // the exact blindness this module exists to prevent, so every objective is
  // `unknown` and the service verdict is `unknown`.
  if (!duty) {
    const detail = record ? 'no duty while the service is stopped' : 'no duty, the service was never started'
    return {
      schemaVersion: SLO_SCHEMA_VERSION,
      status: 'unknown',
      objectives: [
        { id: 'freshness', status: 'unknown', detail },
        { id: 'flapping', status: 'unknown', detail },
        { id: 'saturation', status: 'unknown', detail },
      ],
    }
  }

  // --- freshness ------------------------------------------------------------
  const windowMs = freshnessWindowMs(definition)
  if (!Number.isFinite(record?.lastSuccessAt)) {
    // Never succeeded yet: that is "not observed", not "late".
    objectives.push({ id: 'freshness', status: 'unknown', detail: 'no completed cycle recorded yet' })
  } else {
    const ageMs = Math.max(0, now - record.lastSuccessAt)
    const status = triage(ageMs, windowMs)
    objectives.push({
      id: 'freshness',
      status,
      detail: `last success ${Math.round(ageMs / 1000)}s ago, budget ${Math.round(windowMs / 1000)}s`,
    })
  }

  // --- flapping -------------------------------------------------------------
  const restarts = countUnhealthyExits(audit, now, UNHEALTHY_EXIT_ACTIONS, record?.serviceId ?? definition?.id)
  const flapStatus = restarts >= restartsBreach
    ? 'breached'
    : restarts >= restartsWarn
      ? 'at-risk'
      : 'ok'
  objectives.push({
    id: 'flapping',
    status: flapStatus,
    detail: `${restarts} unhealthy exit(s) in the last hour`,
  })

  // --- saturation -----------------------------------------------------------
  const telemetryVerdict = record?.telemetry ? evaluateTelemetry(record.telemetry) : 'unknown'
  const saturationStatus = telemetryVerdict === 'saturated'
    ? 'breached'
    : telemetryVerdict === 'elevated'
      ? 'at-risk'
      : telemetryVerdict === 'ok'
        ? 'ok'
        : 'unknown'
  objectives.push({
    id: 'saturation',
    status: saturationStatus,
    detail: `telemetry verdict: ${telemetryVerdict}`,
  })

  return {
    schemaVersion: SLO_SCHEMA_VERSION,
    status: worstStatus(objectives.map(objective => objective.status)),
    objectives,
  }
}
