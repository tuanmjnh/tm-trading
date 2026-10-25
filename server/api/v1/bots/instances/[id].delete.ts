import { getRouterParam } from 'h3'
import { botInstanceModel } from '~~/server/utils/engineModel'

// DELETE /api/v1/bots/instances/:id — hard-delete ONE terminal instance
// (completed | failed | halted) plus its durable command rows. A non-terminal
// instance must be stopped first — deleting a live run would orphan its lease
// and its paper positions.
const TERMINAL = new Set(['completed', 'failed', 'halted'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'instance id is required' })
  const ownerId = requireOwnerId(event)

  const BotInstance = await botInstanceModel()
  if (!BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  if (!instance) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'instance not found' })
  if (!TERMINAL.has(String(instance.state))) {
    throw createError({ statusCode: 409, statusMessage: 'error.bot_not_terminal', message: 'Stop the bot before deleting it' })
  }

  await BotInstance.deleteOne({ _id: id, ownerId })
  try {
    const store = await botRuntimeStore() as unknown as {
      getBotRuntimeModels(): Promise<{ BotCommand: { deleteMany(f: Record<string, unknown>): Promise<{ deletedCount?: number }> } | null }>
    }
    const m = await store.getBotRuntimeModels()
    if (m?.BotCommand) await m.BotCommand.deleteMany({ ownerId, instanceId: id })
  } catch {
    // Command cleanup is best-effort — the instance itself is gone.
  }
  return { success: true, data: { deleted: true, instanceId: id } }
})
