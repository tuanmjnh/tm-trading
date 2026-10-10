import { getQuery } from 'h3'
import { strategyProfileModel } from '../../../utils/engineModel'

/**
 * GET /api/v1/strategies — list all strategy profiles (§30.4).
 */
export default defineEventHandler(async (event) => {
  const Profile = await strategyProfileModel()
  if (!Profile) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  try {
    const rows = await Profile.find({}).sort({ createdAt: -1 }).lean()
    return { success: true, data: rows, meta: { count: rows.length, mongo: 'up' } }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }
})