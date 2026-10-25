import { aiProviderHttpError, listAiConnections, providerCatalog } from '../../../../utils/aiProviders'

// GET /api/v1/ai/providers — catalog (metadata only) + this owner's connections.
// A provider outage or an invalid key is visible through each row's status,
// lastError and lastTestedAt; secrets are never part of the response.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  try {
    const [catalog, connections] = await Promise.all([providerCatalog(), listAiConnections(ownerId)])
    return { success: true, data: { ...catalog, connections } }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
