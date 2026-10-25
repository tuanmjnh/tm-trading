import type { H3Event } from 'h3'
import { requireAuthPayload } from '../../../../../../utils/request'
import { getStoredAiKey } from '../../../../../../utils/aiProviders'

/**
 * GET /api/v1/ai/providers/connections/:id/key — reveal the STORED API key.
 * Root-only (`permissions: ['*']` or the `root` role): the key is encrypted at
 * rest (D35) and never returned to regular accounts — they can only replace it.
 */
export default defineEventHandler(async (event: H3Event) => {
  const payload = await requireAuthPayload(event)
  const isRoot = payload.permissions.includes('*') || payload.roles.includes('root')
  if (!isRoot) {
    throw createError({ statusCode: 403, statusMessage: 'error.forbidden', message: 'Only root accounts may reveal stored API keys' })
  }
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'connection id is required' })
  }
  const apiKey = await getStoredAiKey(ownerId, id)
  if (apiKey === undefined) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'connection not found or has no stored key' })
  }
  return { success: true, data: { apiKey } }
})
