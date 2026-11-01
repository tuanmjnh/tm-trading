import { randomUUID } from 'node:crypto'
import { requireRootEvent } from '~~/server/utils/authz'
import { requireOwnerId } from '~~/server/utils/owner'
import { enqueueServiceCommand, loadServiceDefinition } from '~~/server/utils/operations'

/**
 * POST /api/v1/operations/services/:serviceId/:action — control a service.
 *
 * Option (b): the API does not run the supervisor. It validates the request,
 * mints an `operationId`, and drops a command in the supervisor's inbox. The
 * supervisor performs it on its next tick (single writer, so two ticks can
 * never race on one service record). The response is `202 Accepted` with the
 * `operationId`; the caller polls `statusUrl` until the operation reaches a
 * terminal state — a command accepted is NOT a process started (§17.7, hard rule 1).
 *
 * Root-only. Spawning or stopping a background process is privileged
 * (docs/web-app/v4.2-operations-control-audit.md, finding S1).
 */
const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'reset', 'probe', 'run-once']

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  requireRootEvent(event)

  const serviceId = getRouterParam(event, 'serviceId') || ''
  const action = getRouterParam(event, 'action') || ''
  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>

  if (!serviceId || !action) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidRequest', message: 'serviceId and action are required' })
  }
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidAction', message: `unknown action ${action}` })
  }

  // Validate against the registry BEFORE enqueueing, so the operator gets a
  // clear 4xx instead of a command the supervisor will only reject later. The
  // supervisor still re-validates: it is the authority, this is a courtesy.
  const definition = await loadServiceDefinition(serviceId)
  if (!definition) {
    throw createError({ statusCode: 404, statusMessage: 'error.unknownService', message: `no service ${serviceId}` })
  }
  if (definition.planned && action !== 'probe') {
    throw createError({ statusCode: 409, statusMessage: 'error.serviceNotImplemented', message: `${serviceId} is a planned service` })
  }
  if (definition.supervised === false && action !== 'probe') {
    throw createError({ statusCode: 409, statusMessage: 'error.serviceNotSupervised', message: `${serviceId} is hosted by another process; only probe is allowed` })
  }
  if (!definition.supports.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'error.actionNotSupported', message: `${serviceId} does not support ${action}` })
  }

  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
    ? body.idempotencyKey.trim()
    : `api-${randomUUID()}`
  const scopeKey = typeof body.scopeKey === 'string' && body.scopeKey.trim().length > 0 ? body.scopeKey.trim() : 'system'
  const reason = typeof body.reason === 'string' && body.reason.trim().length > 0 ? body.reason.trim() : null
  const operationId = `op_${randomUUID()}`
  const requestedAt = Date.now()

  try {
    await enqueueServiceCommand({ operationId, serviceId, action, actor: ownerId, idempotencyKey, scopeKey, reason })
  } catch (error) {
    // A full inbox is a real, actionable condition (§17.11 bounded queues), not a
    // server fault: report it as 429 so the operator knows to wait for the
    // supervisor to drain rather than retrying into the same wall.
    if ((error as { code?: string })?.code === 'INBOX_FULL') {
      throw createError({
        statusCode: 429,
        statusMessage: 'error.inboxFull',
        message: 'the supervisor command inbox is full; the supervisor must drain it before new commands are accepted',
      })
    }
    throw error
  }

  setResponseStatus(event, 202)
  return {
    success: true,
    data: {
      operationId,
      serviceId,
      scopeKey,
      action,
      state: 'QUEUED',
      phase: 'queued',
      pending: true,
      requestedAt,
      requestedBy: ownerId,
      statusUrl: `/api/v1/operations/operations/${operationId}`,
    },
  }
})
