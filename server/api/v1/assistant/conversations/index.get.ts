import { getQuery } from 'h3'
import { listConversations } from '../../../../utils/assistantConversations'

/**
 * GET /api/v1/assistant/conversations (Phase H §61.12 H5) — the caller's saved
 * assistant conversations, newest first. Owner from the verified hub token;
 * expired rows (TTL) are hidden.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const q = getQuery(event)
  const limit = Number(Array.isArray(q.limit) ? q.limit[0] : q.limit)
  const items = await listConversations(ownerId, { limit: Number.isFinite(limit) ? limit : 20 })
  return { success: true, data: { items } }
})
