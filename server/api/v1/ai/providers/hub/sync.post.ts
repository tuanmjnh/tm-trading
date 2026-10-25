import { aiProviderHttpError, syncAiProvidersFromHub } from '../../../../../utils/aiProviders'

// POST /api/v1/ai/providers/hub/sync — mirror tm-hub's relay catalog into local
// `provider='hub'` connections. Secrets stay on the hub; only the app secret is
// used for authorization of the server-to-server relay calls.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  try {
    const summary = await syncAiProvidersFromHub(ownerId)
    return { success: true, data: summary }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
