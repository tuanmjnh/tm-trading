import { getRouterParam } from 'h3'
import { aiProviderHttpError, deleteAiModel } from '../../../../../../../utils/aiProviders'

// DELETE /api/v1/ai/providers/connections/:id/models/:model — forget one
// catalogue row. The connection's active model string is never touched.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const connectionId = String(getRouterParam(event, 'id') ?? '').trim()
  const model = decodeURIComponent(String(getRouterParam(event, 'model') ?? '')).trim()
  try {
    const removed = await deleteAiModel(ownerId, connectionId, model)
    if (!removed) {
      throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'model row not found' })
    }
    return { success: true, data: { deleted: true, model } }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})



