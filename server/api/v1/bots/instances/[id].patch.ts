import { getRouterParam, readBody } from 'h3'
import { botInstanceModel } from '~~/server/utils/engineModel'

// PATCH /api/v1/bots/instances/:id — soft-archive a TERMINAL instance
// (completed | failed | halted). Archived rows drop out of the default list
// but the D1 run data is never touched. Live bots must be stopped first.
const TERMINAL = new Set(['completed', 'failed', 'halted'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'instance id is required' })
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.archived !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'archived (boolean) is required' })
  }

  const BotInstance = await botInstanceModel()
  if (!BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  if (!instance) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'instance not found' })
  if (body.archived === false && !TERMINAL.has(String(instance.state))) {
    throw createError({ statusCode: 409, statusMessage: 'error.bot_not_terminal', message: 'Only finished bots can be managed' })
  }

  await BotInstance.updateOne({ _id: id, ownerId }, { $set: { archived: body.archived } })
  return { success: true, data: { instanceId: id, archived: body.archived } }
})
