import { getRouterParam, getQuery } from 'h3'
import { strategyVersionModel } from '../../../../utils/engineModel'

/**
 * GET /api/v1/strategies/:id/versions — list versions for a strategy (§30.4).
 * Query: ?limit=50
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50

  if (!id) return { success: false, error: 'strategy id required', data: [], meta: { count: 0 } }

  const Version = await strategyVersionModel()
  if (!Version) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  try {
    const rows = await Version.find({ strategyId: id }).sort({ createdAt: -1 }).limit(limit).lean()
    return { success: true, data: rows, meta: { count: rows.length, mongo: 'up' } }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }
})