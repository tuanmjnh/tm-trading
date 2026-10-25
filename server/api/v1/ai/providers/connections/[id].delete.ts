import { getRouterParam } from 'h3'
import { aiProviderHttpError, deleteAiConnection } from '../../../../../utils/aiProviders'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  try {
    return { success: true, data: await deleteAiConnection(ownerId, id) }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
