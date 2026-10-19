import { getQuery } from 'h3'
import { requireOwnerId } from '~~/server/utils/owner'
import { workspaceStore } from '~~/server/utils/engineModel'

/**
 * GET /api/v1/workspace/events — the caller's UNDELIVERED trading events
 * (§61.17 Phase C: "the same persisted state everywhere without a manual hard
 * refresh").
 *
 * Owner-scoped: `pendingForOwner` only ever returns rows stamped with the
 * authenticated hub user, so two users never see each other's workspace. The
 * response carries the union of view ids the batch invalidates, so a screen
 * refetches only when something it renders actually changed. Undelivered rows
 * never expire, so this survives a reload/restart with nothing lost.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const q = getQuery(event)
  const limit = Number(q.limit) || 200
  const ws = await workspaceStore()
  const events = await ws.pendingForOwner(ownerId, { limit })
  const views = ws.viewsForEvents(events)
  return { success: true, data: { events, views, count: events.length } }
})
