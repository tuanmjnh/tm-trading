import { aiProviderHttpError, exportAiConnections } from '../../../../utils/aiProviders'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const query = getQuery(event)
  const includeSecrets = query.includeSecrets === '1' || query.includeSecrets === 'true'
  try {
    const data = await exportAiConnections(ownerId, includeSecrets)
    setHeader(event, 'content-disposition', `attachment; filename="tm-trading-ai-providers-${Date.now()}.json"`)
    return { success: true, data }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
