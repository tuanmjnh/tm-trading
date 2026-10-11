import { getQuery } from 'h3'
import { botProfileModel } from '../../../../utils/engineModel'

/**
 * GET /api/v1/bots/profiles — list bot profiles (roadmap §57.4 G, §58.6).
 * Query: ?limit=100&status=&mode=&q=
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 500) : 100
  const status = q.status ? String(q.status) : ''
  const mode = q.mode ? String(q.mode) : ''
  const search = q.q ? String(q.q).trim().toLowerCase() : ''

  const BotProfile = await botProfileModel()
  if (!BotProfile) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  try {
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (mode) filter.mode = mode
    let rows = await BotProfile.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
    if (search) {
      rows = rows.filter((r: { name?: string; profileId?: string }) =>
        (r.name ?? '').toLowerCase().includes(search) || (r.profileId ?? '').toLowerCase().includes(search))
    }
    return { success: true, data: rows, meta: { count: rows.length, mongo: 'up' } }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }
})
