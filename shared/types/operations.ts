import type {
  DesiredServiceState,
  ObservedServiceState,
  ProcessTelemetry,
  ServiceAction,
  ServiceCategory,
  ServiceDependency,
  ServiceExecutionMode,
  ServiceHealth,
  ServiceProcessGroup,
  ServiceReadinessCheck,
  ServiceScope,
} from './service'

// =============================================================================
//  Operations read model (V4.2 §17.9).
//
//  The shape `GET /api/v1/operations/services` returns: the service registry
//  merged with the last supervisor snapshot. It is a READ model — mutations go
//  through the command endpoints and are executed by the supervisor.
//
//  `registered` is the field that keeps the screen honest: a registry entry with
//  no supervisor record is `registered: false, observed: 'UNKNOWN'`, because
//  "never started" must never be rendered as "stopped on purpose".
// =============================================================================

/** How an operation is moving, as the UI renders it. */
export type OperationsOperationState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNCONFIRMED'

export interface OperationsServiceRow {
  serviceId: string
  label: string
  description: string | null
  category: ServiceCategory
  scope: ServiceScope
  processGroup: ServiceProcessGroup | null
  executionMode: ServiceExecutionMode
  intervalSec: number | null
  intervalEnv: string | null
  planned: boolean
  supervised: boolean
  supports: ServiceAction[]
  dependencies: ServiceDependency[]
  readiness: ServiceReadinessCheck[]
  /** Service-level objectives (§17.13), evaluated from the evidence below. */
  slo: OperationsSlo
  /** Control-plane latency of the last finished operation, or null if none. */
  control: OperationsServiceControl | null
  /** True when the supervisor has a record for this service. */
  registered: boolean
  desired: DesiredServiceState
  observed: ObservedServiceState
  health: ServiceHealth
  drift: boolean
  active: boolean
  serviceInstanceId: string | null
  generation: number
  pid: number | null
  host: string | null
  startedAt: number | null
  lastHeartbeatAt: number | null
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  restartCount: number
  nextRestartAt: number | null
  operationId: string | null
  telemetry: ProcessTelemetry | null
  lease: { owner: string, expiresAt: number } | null
  workload: {
    queueDepth: number | null
    inFlight: number | null
    lastDurationMs: number | null
    lastOutputCount: number | null
  }
  heartbeatAgeMs: number | null
}

/** `ok | at-risk | breached | unknown` — `unknown` is never a pass. */
export type OperationsSloStatus = 'ok' | 'at-risk' | 'breached' | 'unknown'

export interface OperationsSlo {
  schemaVersion: string
  status: OperationsSloStatus
  objectives: Array<{ id: string, status: OperationsSloStatus, detail: string }>
}

/**
 * Control-plane latency of the last terminal operation on a service (§17.13).
 *
 * Derived from the operation timeline the supervisor already records, never
 * sampled. `queueMs` is the wait for the supervisor; `runMs` is the work;
 * `durationMs` is what the operator felt. A field is `null` when that half of
 * the timeline does not exist, which is not the same as zero.
 */
export interface OperationsServiceControl {
  operationId: string
  action: ServiceAction
  state: OperationsOperationState
  requestedAt: number
  startedAt: number | null
  finishedAt: number
  durationMs: number
  queueMs: number | null
  runMs: number | null
}

export interface OperationsOperationRow {
  operationId: string
  serviceId: string
  scopeKey?: string
  action: ServiceAction
  requestedBy?: string
  requestedAt: number
  deadlineAt?: number
  startedAt?: number
  finishedAt?: number
  state: OperationsOperationState
  phase?: string
  error?: string | null
  result?: Record<string, unknown>
  /** True for a command the supervisor has not consumed yet. */
  pending?: boolean
}

export interface OperationsViewSummary {
  total: number
  ready: number
  degraded: number
  failed: number
  active: number
  stopped: number
  unknown: number
  drifting: number
  planned: number
  sloBreached: number
  sloAtRisk: number
  sloUnknown: number
  /** Commands dropped and kept in the dead-letter box (§17.13). */
  deadLetterCount: number
}

export interface OperationsView {
  schemaVersion: string
  at: number
  services: OperationsServiceRow[]
  operations: OperationsOperationRow[]
  summary: OperationsViewSummary
  audit: Array<Record<string, unknown>>
}

export interface OperationsViewResponse {
  success: boolean
  data: OperationsView
}

/** `202 Accepted` body of a control command. */
export interface ServiceCommandAccepted {
  operationId: string
  serviceId: string
  scopeKey: string
  action: ServiceAction
  state: OperationsOperationState
  phase: string
  pending: boolean
  requestedAt: number
  requestedBy: string
  statusUrl: string
}

export interface ServiceCommandResponse {
  success: boolean
  data: ServiceCommandAccepted
}

export interface ServiceOperationResponse {
  success: boolean
  data: OperationsOperationRow & { pending: boolean, terminal: boolean }
}

/** Terminal states — polling stops here. */
export const OPERATIONS_TERMINAL_STATES: OperationsOperationState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCONFIRMED']
