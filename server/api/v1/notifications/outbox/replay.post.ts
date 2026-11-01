import { readBody } from 'h3'
import { replayOutbox } from '~~/server/utils/outbox'

/**
 * POST /api/v1/notifications/outbox/replay — replay a dead-letter outbox entry (V4.2 §7.3).
 *
 * Body: { id: string }
 * Moves the entry back to 'queued' state with nextAttemptAt=now, allowing the
 * drain tick to retry it.
 */
export default defineEventHandler(async (event) => {
  requireOwnerId(event)
  const body = await readBody(event)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''

  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing outbox entry id' })
  }

  const result = await replayOutbox(id)
  if (!result) {
    throw createError({ statusCode: 404, message: 'Outbox entry not found or unreplayable' })
  }

  return {
    success: true,
    data: result,
  }
})
