import { getRouterParam } from 'h3'
import { deleteConversation } from '../../../../utils/assistantConversations'

/**
 * DELETE /api/v1/assistant/conversations/:id (Phase H §61.12 H5) — forget one
 * conversation. Owner-scoped: a foreign id is 404, never a silent delete.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  const removed = await deleteConversation(ownerId, id)
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'conversation not found' })
  }
  return { success: true, data: { deleted: true, id } }
})
