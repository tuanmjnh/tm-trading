import { getRouterParam } from 'h3'
import { getConversation } from '../../../../utils/assistantConversations'

/**
 * GET /api/v1/assistant/conversations/:id (Phase H §61.12 H5) — one saved
 * conversation with its messages. Owner-scoped: a foreign id is 404.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  const conversation = await getConversation(ownerId, id)
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'conversation not found' })
  }
  return { success: true, data: conversation }
})
