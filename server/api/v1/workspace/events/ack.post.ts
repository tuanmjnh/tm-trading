import { readBody } from 'h3'
import { requireOwnerId } from '~~/server/utils/owner'
import { workspaceStore } from '~~/server/utils/engineModel'

/**
 * POST /api/v1/workspace/events/ack — acknowledge delivered events so the client
 * stops reconciling them (body: { ids: string[] }).
 *
 * The owner filter is applied INSIDE the update (markDeliveredForOwner), so a
 * caller can only ever mark their OWN events delivered — an id from another
 * owner is silently ignored (tenancy §61.3). Idempotent: re-acking already
 * delivered ids modifies nothing.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : []
  const ws = await workspaceStore()
  const delivered = await ws.markDeliveredForOwner(ownerId, ids)
  return { success: true, data: { delivered } }
})
