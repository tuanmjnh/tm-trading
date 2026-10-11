import { getQuery } from 'h3'
import { botInstanceModel } from '../../../../utils/engineModel'

/**
 * GET /api/v1/bots/instances — list bot instances (roadmap §57.4 H, §58.6).
 * Query: ?limit=100&state=&botProfileId=&mode=
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 500) : 100
  const state = q.state ? String(q.state) : ''
  const botProfileId = q.botProfileId ? String(q.botProfileId) : ''
  const mode = q.mode ? String(q.mode) : ''

  const BotInstance = await botInstanceModel()
  if (!BotInstance) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  try {
    const filter: Record<string, unknown> = {}
    if (state) filter.state = state
    if (botProfileId) filter.botProfileId = botProfileId
    if (mode) filter.mode = mode
    const rows = await BotInstance.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
    return { success: true, data: rows, meta: { count: rows.length, mongo: 'up' } }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }
})
