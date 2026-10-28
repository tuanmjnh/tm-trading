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
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }

  const BotInstance = await botInstanceModel()
  if (!BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  if (!instance) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'instance not found' })

  const $set: Record<string, unknown> = {}

  if (typeof body.archived === 'boolean') {
    if (body.archived === false && !TERMINAL.has(String(instance.state))) {
      throw createError({ statusCode: 409, statusMessage: 'error.bot_not_terminal', message: 'Only finished bots can be managed' })
    }
    $set.archived = body.archived
  }

  if (body.execution && typeof body.execution === 'object' && !Array.isArray(body.execution)) {
    const rawExec = body.execution as Record<string, unknown>
    const currentExec = (instance.execution || {}) as Record<string, unknown>
    const mergedExec: Record<string, unknown> = {
      ...currentExec,
      ...rawExec,
    }
    if (rawExec.sizingType === 'fixed_value' || rawExec.sizingType === 'percentage') {
      mergedExec.sizingType = rawExec.sizingType
    }
    if (Number.isFinite(Number(rawExec.sizingValue)) && Number(rawExec.sizingValue) > 0) {
      mergedExec.sizingValue = Number(rawExec.sizingValue)
    }
    $set.execution = mergedExec
  }

  if (!Object.keys($set).length) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'nothing to update' })
  }

  await BotInstance.updateOne({ _id: id, ownerId }, { $set })
  return { success: true, data: { instanceId: id, ...$set } }
})
