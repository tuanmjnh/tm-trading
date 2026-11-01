// =============================================================================
//  OPERATIONS EVENT STREAM — pure helpers (V4.2 §17.7).
//
//  The supervisor is a SEPARATE process, so it cannot push into the web server:
//  the Nuxt endpoint polls the supervisor's state (plus the command inbox) on a
//  short interval and turns each CHANGE into a Server-Sent Event. That keeps the
//  browser near-real-time without inventing a second source of truth.
//
//  The two functions here are deliberately pure so the protocol is testable
//  without a socket or a timer:
//
//    sseFrame()             encode one event, newline-safe;
//    operationsSignature()  a cheap fingerprint of everything the screen shows.
//
//  The signature is what makes the stream cheap: an unchanged fingerprint emits
//  nothing, so a 2 s poll does not become 30 events a minute of identical state.
// =============================================================================

/** Encode one Server-Sent Event frame. */
export function sseFrame(event: string, data: unknown, id?: string | number): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data ?? null)
  const lines: string[] = []
  if (id !== undefined && id !== null) lines.push(`id: ${id}`)
  lines.push(`event: ${event}`)
  // A data field must be one `data:` line per source line; a raw newline inside
  // the JSON would otherwise terminate the frame early and drop the rest.
  for (const line of payload.split('\n')) lines.push(`data: ${line}`)
  return `${lines.join('\n')}\n\n`
}

/** Fields that mean "the screen would change". Anything outside this is noise. */
function serviceFingerprint(service: Record<string, unknown>): unknown[] {
  return [
    service.serviceId,
    service.observed,
    service.health,
    service.desired,
    service.drift,
    service.pid,
    service.generation,
    service.operationId,
    service.restartCount,
    service.lastHeartbeatAt ?? null,
    service.lastSuccessAt ?? null,
    service.lastError ?? null,
    (service.workload as Record<string, unknown> | undefined)?.lastOutputCount ?? null,
  ]
}

function operationFingerprint(operation: Record<string, unknown>): unknown[] {
  return [operation.operationId, operation.state, operation.phase ?? null, operation.error ?? null]
}

/**
 * A fingerprint of the parts of the view the UI renders. Equal signature means
 * nothing an operator can see changed, so no event is sent.
 */
export function operationsSignature(view: unknown): string {
  const source = (view ?? {}) as Record<string, unknown>
  const services = Array.isArray(source.services) ? (source.services as Record<string, unknown>[]) : []
  const operations = Array.isArray(source.operations) ? (source.operations as Record<string, unknown>[]) : []
  return JSON.stringify([
    services.map(serviceFingerprint),
    operations.map(operationFingerprint),
    source.summary ?? null,
  ])
}

/** Poll interval for the supervisor state (cheap: three small file reads). */
export const OPERATIONS_POLL_MS = 2_000

/** Keepalive comment interval, so a proxy or load balancer does not cut an idle stream. */
export const OPERATIONS_PING_MS = 15_000
