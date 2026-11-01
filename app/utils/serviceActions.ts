import type { OperationsServiceRow } from '#shared/types/operations'

// =============================================================================
//  Service control vocabulary (V4.2 §17.6, §17.9).
//
//  One place decides how each action looks and when it is unavailable, so the
//  detail drawer, the row context menu and any future surface can never disagree
//  about whether "start" is allowed. The label itself is translated by the
//  caller with `operations.services.actions.<id>`.
// =============================================================================

export type ServiceActionId = 'start' | 'stop' | 'restart' | 'reset' | 'probe' | 'run-once'
export type ServiceActionColor = 'primary' | 'success' | 'error' | 'warning' | 'neutral'

export interface ServiceActionMeta {
  action: ServiceActionId
  icon: string
  color: ServiceActionColor
  /** `control` mutates lifecycle; `inspect` only looks. */
  group: 'control' | 'inspect'
}

export const SERVICE_ACTIONS_UI: readonly ServiceActionMeta[] = Object.freeze([
  { action: 'start', icon: 'i-lucide-play', color: 'success', group: 'control' },
  { action: 'stop', icon: 'i-lucide-square', color: 'error', group: 'control' },
  { action: 'restart', icon: 'i-lucide-rotate-cw', color: 'warning', group: 'control' },
  { action: 'reset', icon: 'i-lucide-eraser', color: 'warning', group: 'control' },
  { action: 'run-once', icon: 'i-lucide-zap', color: 'primary', group: 'control' },
  { action: 'probe', icon: 'i-lucide-stethoscope', color: 'neutral', group: 'inspect' },
])

/** Lifecycle states that mean "a process is (or is about to be) running". */
const RUNNING_STATES = new Set(['STARTING', 'READY', 'DEGRADED', 'STOPPING'])

/** A planned service has no code; an unsupervised one is owned by another process. */
export function isControllable(service: Pick<OperationsServiceRow, 'planned' | 'supervised'>): boolean {
  return !service.planned && service.supervised
}

export type ActionBlockReason =
  | 'unsupported'
  | 'notControllable'
  | 'alreadyRunning'
  | 'notRunning'
  | 'neverStarted'

/**
 * Why an action cannot run, or `null` when it can.
 *
 * A stable machine code (not a sentence) so the caller can translate it and a
 * test can assert it precisely.
 */
export function actionBlockReason(
  service: OperationsServiceRow,
  action: ServiceActionId,
): ActionBlockReason | null {
  // `probe` is always allowed: it observes, it does not duplicate work.
  if (action === 'probe') return service.supports.includes('probe') ? null : 'unsupported'
  if (!service.supports.includes(action)) return 'unsupported'
  if (!isControllable(service)) return 'notControllable'
  if (action === 'start' && RUNNING_STATES.has(service.observed)) return 'alreadyRunning'
  if (action === 'stop' && !RUNNING_STATES.has(service.observed) && service.observed !== 'FAILED') return 'notRunning'
  if (action === 'restart' && !service.registered) return 'neverStarted'
  return null
}

export function isActionDisabled(service: OperationsServiceRow, action: ServiceActionId): boolean {
  return actionBlockReason(service, action) !== null
}
