import { getQuery, getRouterParam } from 'h3'
import { botInstanceModel, botRuntimeStore } from '~~/server/utils/engineModel'

/**
 * GET /api/v1/bots/instances/:id/commands — recent commands for one instance.
 * Query: ?limit=50
 *
 * Read-only and owner-scoped. Fail-soft: Mongo down -> 200 with an empty list so
 * the dashboard can still show the instance itself.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'instance id required', code: 'missing_instance' }

  const ownerId = requireOwnerId(event)
  const BotInstance = await botInstanceModel()
  if (!BotInstance) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  try {
    const exists = await BotInstance.exists({ _id: id, ownerId })
    if (!exists) return { success: false, error: 'instance not found', code: 'not_found' }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }

  const q = getQuery(event)
  const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50

  const store = await botRuntimeStore()
  const rows = await store.listCommands(ownerId, { instanceId: id, limit })
  return { success: true, data: rows, meta: { count: rows.length } }
})
