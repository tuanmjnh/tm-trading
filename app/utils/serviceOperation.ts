// =============================================================================
//  runServiceOperation — follow one control command to a terminal state
//  (V4.2 §17.7 hard rule 1: "command accepted ≠ process started ≠ ready").
//
//  The transport is injected, so the same loop powers the row button, the
//  context menu and any future surface, and can be tested without a network or
//  fake timers. Polling is a plain loop (not setInterval) so an aborted
//  operation cannot leave a timer behind.
// =============================================================================

export const OPERATION_TERMINAL_STATES = Object.freeze(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCONFIRMED'])

export const DEFAULT_OPERATION_POLL_MS = 1_000
export const DEFAULT_OPERATION_TIMEOUT_MS = 300_000

export interface OperationSnapshot {
  state: string
  phase?: string | null
  terminal?: boolean
  error?: string | null
}

export interface RunServiceOperationOptions {
  serviceId: string
  action: string
  /** Enqueue the command; resolves to the acceptance envelope. */
  request: (serviceId: string, action: string) => Promise<{ operationId: string }>
  /** Read one operation; the response marks `terminal`. */
  fetchOperation: (operationId: string) => Promise<OperationSnapshot>
  /** Called once the command is persisted (never before). */
  onAccepted?: (operationId: string) => void
  /** Called with each phase, so a caller can show progress. */
  onPhase?: (phase: string) => void
  pollMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** Injectable sleep, so a test does not wait on the clock. */
  sleep?: (ms: number) => Promise<void>
}

export interface RunServiceOperationResult {
  state: string
  phase: string | null
  error: string | null
  /** True when the deadline passed without a terminal state. */
  timedOut: boolean
  operationId: string | null
}

/** Sleep helper, overridable for tests. */
export const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function isTerminalState(state: string): boolean {
  return OPERATION_TERMINAL_STATES.includes(state)
}

/**
 * Enqueue a command and poll until it is terminal.
 *
 * Never throws for an operation outcome: a failed operation resolves to
 * `state: 'FAILED'`, and a deadline resolves to `UNCONFIRMED` — the caller
 * decides how to present that, but it can never mistake it for success.
 */
export async function runServiceOperation(options: RunServiceOperationOptions): Promise<RunServiceOperationResult> {
  const {
    serviceId,
    action,
    request,
    fetchOperation,
    onAccepted,
    onPhase,
    pollMs = DEFAULT_OPERATION_POLL_MS,
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    signal,
    sleep = realSleep,
  } = options

  onPhase?.('queued')
  const accepted = await request(serviceId, action)
  const operationId = accepted.operationId
  onAccepted?.(operationId)
  const deadline = Date.now() + timeoutMs
  let phase: string | null = 'queued'

  for (;;) {
    if (signal?.aborted) {
      return { state: 'CANCELLED', phase, error: 'aborted', timedOut: false, operationId }
    }

    const snapshot = await fetchOperation(operationId)
    phase = snapshot.phase ?? String(snapshot.state).toLowerCase()
    onPhase?.(phase)

    if (snapshot.terminal === true || isTerminalState(snapshot.state)) {
      return {
        state: snapshot.state,
        phase,
        error: snapshot.error ?? null,
        timedOut: false,
        operationId,
      }
    }

    if (Date.now() > deadline) {
      return { state: 'UNCONFIRMED', phase, error: null, timedOut: true, operationId }
    }

    await sleep(pollMs)
  }
}
