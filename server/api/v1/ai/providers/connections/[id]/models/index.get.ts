import { getRouterParam } from 'h3'
import { aiProviderHttpError, listAiModels } from '../../../../../../../utils/aiProviders'

// GET /api/v1/ai/providers/connections/:id/models — the connection's saved
// model catalogue, primary first. Owner from the verified hub token.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const connectionId = String(getRouterParam(event, 'id') ?? '').trim()
  try {
    const models = await listAiModels(ownerId, connectionId)
    return { success: true, data: { models, count: models.length } }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})



