import { getRouterParam } from 'h3'
import { botProfileModel } from '../../../../utils/engineModel'

/**
 * GET /api/v1/bots/profiles/:id — one bot profile (roadmap §57.4 G).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'profile id required', data: null }

  const BotProfile = await botProfileModel()
  if (!BotProfile) return { success: false, error: 'mongo down', data: null, meta: { mongo: 'down' } }

  try {
    const data = await BotProfile.findOne({ _id: id }).lean()
    if (!data) return { success: false, error: 'profile not found', data: null }
    return { success: true, data }
  } catch {
    return { success: false, error: 'mongo error', data: null, meta: { mongo: 'down' } }
  }
})
