import { getRouterParam } from 'h3'
import { botInstanceModel } from '~~/server/utils/engineModel'

// GET /api/v1/bots/instances/:id/export — download ONE run's data as JSON
// (D1 traceability export). Contains the instance record plus every paper
// order and fill attributed to it via the `bot_<instanceId>_` alertKey prefix.
// No secrets: orders/fills are market data + ids only.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'instance id is required' })
  const ownerId = requireOwnerId(event)

  const BotInstance = await botInstanceModel()
  if (!BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  if (!instance) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'instance not found' })

  const store = await (async () => {
    const mod = await import('~~/services/botRuntimeStore.mjs')
    return mod.getBotRuntimeModels()
  })()
  if (!store?.PaperOrder || !store.PaperFill) {
    throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })
  }

  const orders = await store.PaperOrder.find({ ownerId, alertKey: new RegExp(`^bot_${id}_`) }).lean()
  const orderIds = orders.map((o: { orderId: string }) => o.orderId)
  const fills = orderIds.length
    ? await store.PaperFill.find({ ownerId, orderId: { $in: orderIds } }).sort({ eventTime: 1 }).lean()
    : []

  setResponseHeaders(event, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${id}-export.json"`
  })
  return {
    exportedAt: new Date().toISOString(),
    instance,
    orders,
    fills
  }
})

