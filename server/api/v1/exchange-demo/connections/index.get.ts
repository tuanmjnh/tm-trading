import { listExchangeDemoConnections } from '../../../../utils/exchangeDemo'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  return { success: true, data: await listExchangeDemoConnections(ownerId) }
})
