import { getRouterParam } from 'h3'
import { strategyProfileModel } from '../../../utils/engineModel'

/**
 * GET /api/v1/strategies/:id — strategy profile detail (§30.4).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'profile id required', data: null }

  const Profile = await strategyProfileModel()
  if (!Profile) return { success: false, error: 'mongo down', data: null, meta: { mongo: 'down' } }

  try {
    const data = await Profile.findOne({ _id: id }).lean()
    if (!data) return { success: false, error: 'profile not found', data: null }
    return { success: true, data }
  } catch {
    return { success: false, error: 'mongo error', data: null, meta: { mongo: 'down' } }
  }
})