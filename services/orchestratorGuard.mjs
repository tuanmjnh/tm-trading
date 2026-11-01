// =============================================================================
//  TM TRADING — ORCHESTRATOR / SUPERVISOR OVERLAP GUARD (V4.2 §17.15-O4)
//
//  Two runtimes can execute the same periodic work:
//
//    legacy        `npm run services`  (services/run.mjs, in-process timers)
//    supervisor    `node services/supervisor.mjs run` (one child per service)
//
//  Running both is the one thing S3 forbids: two copies of a producer means
//  duplicate Telegram alerts, duplicate intel writes and wasted provider budget.
//
//  The supervisor is the authority on who is running what — it claims an
//  exclusive lease per service+scope. The legacy orchestrator owns no lease, so
//  this guard is one-directional on purpose: it only READS the supervisor store
//  and tells `run.mjs` which services it must not touch while a live supervisor
//  holds them. It never claims, releases or writes anything.
//
//  Pure over its inputs (the store is injected), so the rule is testable without
//  a running supervisor or a real state file.
// =============================================================================

/**
 * Services the legacy orchestrator must skip, because a live supervisor holds
 * their lease.
 *
 * @param {{
 *   store: { listServices: () => Array<object> },
 *   serviceIds: ReadonlyArray<string>,
 *   scopeKey?: string,
 *   now?: number,
 * }} input
 * @returns {Array<{ serviceId: string, owner: string, expiresAt: number }>}
 */
export function overlappingSupervisorLeases(input) {
  const { store, serviceIds, scopeKey = 'system', now = Date.now() } = input
  if (!store || typeof store.listServices !== 'function') return []

  const wanted = new Set(serviceIds)
  const blocked = []
  for (const record of store.listServices()) {
    if (!record || !wanted.has(record.serviceId)) continue
    if ((record.scopeKey ?? 'system') !== scopeKey) continue
    const lease = record.lease
    if (!lease || lease.owner === 'legacy-orchestrator') continue
    // An EXPIRED lease proves nothing is running (a crashed supervisor releases
    // nothing), so it must not block the orchestrator forever.
    if (!(Number(lease.expiresAt) > now)) continue
    blocked.push({ serviceId: record.serviceId, owner: String(lease.owner), expiresAt: Number(lease.expiresAt) })
  }
  return blocked.sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0))
}

/**
 * Split a service list into what may run and what a supervisor already owns.
 *
 * @template T
 * @param {{ store: object, services: ReadonlyArray<T>, serviceIdOf?: (service: T) => string, now?: number }} input
 * @returns {{ runnable: T[], blocked: Array<{ service: T, owner: string, expiresAt: number }> }}
 */
export function partitionBySupervisorLease(input) {
  const { store, services, serviceIdOf = (service) => String(/** @type {any} */ (service).name), now = Date.now() } = input
  const blockedLeases = new Map(
    overlappingSupervisorLeases({ store, serviceIds: services.map(serviceIdOf), now })
      .map(entry => [entry.serviceId, entry]),
  )

  const runnable = []
  const blocked = []
  for (const service of services) {
    const lease = blockedLeases.get(serviceIdOf(service))
    if (lease) blocked.push({ service, owner: lease.owner, expiresAt: lease.expiresAt })
    else runnable.push(service)
  }
  return { runnable, blocked }
}
