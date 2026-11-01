import type { FreshnessState } from './provenance'

// =============================================================================
//  Managed-service lifecycle model (V4.2 §17.2–§17.9).
//
//  The repo already runs 18 units of continuous work (see
//  docs/web-app/v4.2-service-inventory.md) but describes them only as a JSON
//  heartbeat file. These types are the contract the registry, the supervisor
//  and the Operations screen share, so "is it running?" stops being a boolean
//  derived from file age.
//
//  Three axes are deliberately independent:
//
//    desired   what the operator asked for      (RUNNING | STOPPED)
//    observed  what the system can prove        (UNKNOWN … FAILED)
//    health    whether a READY service is doing useful work (HEALTHY … UNKNOWN)
//
//  §17.4 requires `READY` to mean "alive AND dependencies reachable AND
//  initialisation complete", and `DEGRADED` to mean "READY, then a functional
//  check failed". Merging the two would make a feed that just subscribed look
//  broken and a dead feed look fine.
// =============================================================================

/** Who owns the data a service acts on. */
export type ServiceScope = 'system' | 'owner' | 'account' | 'session'

/** What kind of work the service does, used for grouping and filtering. */
export type ServiceCategory =
  | 'market-data'
  | 'intelligence'
  | 'signals'
  | 'alerts'
  | 'ai'
  | 'bots'
  | 'platform'

/** How the service is driven. */
export type ServiceExecutionMode = 'continuous' | 'periodic' | 'event-driven' | 'on-demand'

/** Process that hosts the service in the V4.2 target grouping (§17.5). */
export type ServiceProcessGroup = 'web' | 'market' | 'intelligence' | 'signals' | 'ai' | 'bots'

/** Control actions the supervisor may expose for a service. */
export type ServiceAction = 'start' | 'stop' | 'restart' | 'reset' | 'probe' | 'run-once'

/** How strictly a dependency must be satisfied before start. */
export type DependencyPolicy = 'REQUIRE_READY' | 'DEGRADED_ALLOWED' | 'OPTIONAL'

export interface ServiceDependency {
  serviceId: string
  policy: DependencyPolicy
}

/** The operator's intent. Persisted, never inferred from a heartbeat. */
export type DesiredServiceState = 'RUNNING' | 'STOPPED'

/** What the supervisor can prove about the service right now. */
export type ObservedServiceState =
  | 'UNKNOWN'
  | 'STARTING'
  | 'READY'
  | 'DEGRADED'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED'

/** Functional health of a service that is already READY. */
export type ServiceHealth = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN'

/** A readiness rule declared by the registry. */
export interface ServiceReadinessRule {
  /** Rule id understood by `services/readiness.mjs`. */
  id: string
  /** Human-readable label; the UI translates by `id` when a key exists. */
  label: string
  /** Required rules gate READY; optional rules only downgrade to DEGRADED. */
  required: boolean
}

/** The outcome of one readiness rule for one evaluation. */
export interface ServiceReadinessCheck {
  id: string
  label: string
  required: boolean
  /** `null` means "no evidence", which is not the same as `false`. */
  passed: boolean | null
  detail?: string
}

export interface ServiceReadinessReport {
  /** Every required rule passed. */
  ready: boolean
  /** Ready, but at least one optional rule failed. */
  degraded: boolean
  /** Ids of required rules that did not pass. */
  blocking: string[]
  checks: ServiceReadinessCheck[]
}

/** One machine-readable service definition. */
export interface ManagedServiceDefinition {
  id: string
  label: string
  category: ServiceCategory
  scope: ServiceScope
  /** True when rows produced by the service are keyed by `ownerId`. */
  ownerScopedData?: boolean
  executionMode: ServiceExecutionMode
  processGroup: ServiceProcessGroup
  /** Entry module relative to the repo root, when the service is code. */
  entry?: string
  /**
   * Named export of `entry` that performs one cycle, e.g. `runFunding`.
   *
   * The worker host calls it for both the periodic loop and `run-once`, so a
   * supervised service is one function, not a bespoke CLI.
   */
  runExport?: string
  /**
   * Summary fields, in priority order, that report how many rows the last cycle
   * produced. Used only for the optional `output-produced` readiness rule.
   */
  outputCountKeys?: string[]
  /** Default cadence in seconds; `null` for event-driven / on-demand work. */
  intervalSec: number | null
  /** Env var that overrides `intervalSec`. */
  intervalEnv?: string
  /** Env var that disables an embedded copy of the service. */
  killSwitch?: string
  /** Hard cap on how long STARTING may last before it is FAILED. */
  startupGraceMs: number
  /**
   * Window (ms) for `recent-success`. Defaults to `max(intervalSec * 2, 60s)`.
   * Set it when a long-running cycle legitimately exceeds the derived window.
   */
  staleAfterMs?: number
  /** Window (ms) for `fresh-event`. Defaults to 60s. */
  freshEventMaxAgeMs?: number
  /** Window (ms) for `outbox-consuming`. Defaults to the `recent-success` window. */
  outboxMaxAgeMs?: number
  dependencies: ServiceDependency[]
  readiness: ServiceReadinessRule[]
  supports: ServiceAction[]
  /**
   * False when another process still hosts the service (an embedded Nitro
   * plugin). Such a service may only be probed until it is migrated, because a
   * second copy would duplicate processing.
   */
  supervised?: boolean
  /** True for entries that describe target state but have no code yet. */
  planned?: boolean
}

/** One durable control operation (§17.7). */
export interface ServiceOperation {
  operationId: string
  serviceId: string
  /** Ownership key the command applies to (`system` or an owner id). */
  scopeKey: string
  action: ServiceAction
  /** Hub user id that requested it. */
  requestedBy: string
  requestedAt: number
  /** Client-supplied key; a repeat returns the same operation. */
  idempotencyKey: string
  state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNCONFIRMED'
  /** Human-readable phase, e.g. `awaiting-readiness`. */
  phase?: string
  startedAt?: number
  finishedAt?: number
  /** Absolute deadline; an operation past it becomes UNCONFIRMED. */
  deadlineAt?: number
  error?: string
  result?: Record<string, unknown>
}

export interface ServiceWorkload {
  queueDepth: number | null
  inFlight: number | null
  lastDurationMs: number | null
  lastOutputCount: number | null
}

/** Everything the Operations table renders for one service. */
export interface ServiceStateSnapshot {
  serviceId: string
  scopeKey: string
  desired: DesiredServiceState
  observed: ObservedServiceState
  health: ServiceHealth
  /** True when observed cannot prove the operator's desired state. */
  drift: boolean
  /** Identity of the running instance; changes on restart. */
  serviceInstanceId: string | null
  /** Monotonic restart generation for the same service identity. */
  generation: number
  pid: number | null
  host: string | null
  lastHeartbeatAt: number | null
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  restartCount: number
  readiness: ServiceReadinessCheck[]
  /** Freshness of the service's newest output, when it has one. */
  freshness: FreshnessState | null
  /** Per-process saturation sample, when the worker reported one. */
  telemetry: ProcessTelemetry | null
  workload: ServiceWorkload
  /** In-flight operation, if any. */
  operationId: string | null
}

/** Per-process saturation sample (A7 / §17.13). */
export interface ProcessTelemetry {
  schemaVersion: string
  pid: number
  host: string
  sampledAt: number
  uptimeSec: number
  eventLoopDelayMs: {
    p50: number | null
    p95: number | null
    p99: number | null
    max: number | null
  }
  /** Event-loop utilization in [0, 1]; `null` when not measurable. */
  utilization: number | null
  heapUsedMb: number
  heapTotalMb: number
  rssMb: number
  cpuPercent: number | null
  /** GC pause accumulated since the previous sample, or `null` when no GC ran. */
  gcPauseMs: {
    count: number
    totalMs: number
    maxMs: number
  } | null
}
