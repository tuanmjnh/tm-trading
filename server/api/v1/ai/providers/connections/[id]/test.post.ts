import { getRouterParam } from 'h3'
import { aiProviderHttpError, testAiConnection } from '../../../../../../utils/aiProviders'

// POST /api/v1/ai/providers/connections/:id/test — reachability + credential
// check. Persists status/lastError so an outage stays visible after the request.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  try {
    return { success: true, data: await testAiConnection(ownerId, id) }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
