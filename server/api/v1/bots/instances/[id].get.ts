import { getRouterParam } from 'h3'
import { botInstanceModel } from '../../../../utils/engineModel'

/**
 * GET /api/v1/bots/instances/:id — one bot instance (roadmap §57.4 H).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'instance id required', data: null }

  const BotInstance = await botInstanceModel()
  if (!BotInstance) return { success: false, error: 'mongo down', data: null, meta: { mongo: 'down' } }

  try {
    const data = await BotInstance.findOne({ _id: id, ownerId: requireOwnerId(event) }).lean()
    if (!data) return { success: false, error: 'instance not found', data: null }
    return { success: true, data }
  } catch {
    return { success: false, error: 'mongo error', data: null, meta: { mongo: 'down' } }
  }
})
