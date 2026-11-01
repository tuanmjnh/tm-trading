import { randomUUID } from 'node:crypto'
import { requireRootEvent } from '~~/server/utils/authz'
import { requireOwnerId } from '~~/server/utils/owner'
import { enqueueServiceCommand, listRunOnceServices } from '~~/server/utils/operations'

/**
 * POST /api/v1/admin/services/run-once — run every periodic service one cycle.
 *
 * **Converted in V4.2 S2.** This endpoint used to spawn `services/run.mjs once`
 * detached, sleep 800 ms, re-read the *pre-existing* heartbeat and return
 * `success: true` — reporting a result it had not observed (the exact
 * anti-pattern §17 forbids: docs/web-app/v4.2-operations-control-audit.md).
 *
 * It now enqueues a real `run-once` operation per service for the supervisor and
 * answers `202 Accepted` with the operation ids. Nothing is claimed to have run
 * until the supervisor proves it. Root-only, because it starts background work.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  requireRootEvent(event)

  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  // One batch key, suffixed per service: a retried request resolves to the same
  // operations instead of a second batch.
  const batchKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
    ? body.idempotencyKey.trim()
    : `api-runall-${randomUUID()}`
  const requestedAt = Date.now()

  const targets = await listRunOnceServices()
  const accepted: Array<{ serviceId: string, operationId: string }> = []
  let truncated = false

  for (const { serviceId } of targets) {
    const operationId = `op_${randomUUID()}`
    try {
      await enqueueServiceCommand({
        operationId,
        serviceId,
        action: 'run-once',
        actor: ownerId,
        idempotencyKey: `${batchKey}:${serviceId}`,
        scopeKey: 'system',
        reason: 'run-all-once',
      })
    } catch (error) {
      // Reaching capacity mid-batch is expected under pressure: stop, report what
      // was accepted and let the operator retry the rest after the supervisor
      // drains. Reported honestly via `truncated` rather than silently ignored.
      if ((error as { code?: string })?.code === 'INBOX_FULL') {
        truncated = true
        break
      }
      throw error
    }
    accepted.push({ serviceId, operationId })
  }

  setResponseStatus(event, 202)
  return {
    success: true,
    data: {
      batchKey,
      requestedAt,
      count: accepted.length,
      truncated,
      accepted,
      // The operations run when the supervisor is up; until then they wait in
      // the inbox and expire if nothing consumes them.
      performedBy: 'supervisor',
    },
  }
})
