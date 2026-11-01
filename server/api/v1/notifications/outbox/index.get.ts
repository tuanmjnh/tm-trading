import { loadOutboxStats } from '~~/server/utils/outbox'

/**
 * GET /api/v1/notifications/outbox — notification delivery outbox stats & dead letters (V4.2 §7.3).
 *
 * Requires owner authentication via the Hub token. Returns counters per state,
 * the list of dead letters for operator triage, and Mongo health (fail-soft 200).
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const { stats, dead, mongo, error } = await loadOutboxStats(ownerId)

  return {
    success: true,
    data: {
      stats,
      dead,
    },
    meta: {
      count: dead.length,
      mongo,
      ...(error ? { error } : {}),
    },
  }
})
