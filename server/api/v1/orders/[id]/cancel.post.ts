import { readBody } from 'h3'
import { cancelPaperOrder } from '../../../../utils/paperOrders'
import { engineModel } from '../../../../utils/engineModel'

/**
 * POST /api/v1/orders/[id]/cancel - cancel a LIVE paper order (v3 §17.2/D14).
 *
 * `id` = clientOrderId (the D3 order-layer key the executor upserts on), or a
 * Mongo ObjectId. Cancelling is guarded server-side: only intents still in
 * 'received'/'working' can stop, the rest conflict (409) — a terminal never
 * races the executor. Body: { by?, reason? } (audit trail, default terminal/
 * manual). Requires hub token (D10) — WRITE endpoint.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'missing_id', message: 'Missing order id' })
  }
  const body = await readBody(event).catch(() => ({}))
  const by = typeof body?.by === 'string' && body.by.trim() ? String(body.by).slice(0, 64) : 'terminal'
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? String(body.reason).slice(0, 200) : undefined

  const PaperOrder = await engineModel('order.mjs', 'PaperOrder')
  if (!PaperOrder) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — cancel failed' })
  }

  const key = id.includes('order_') || id.includes('co_') ? { clientOrderId: id } : { _id: id }
  const order = await PaperOrder.findOne(key).lean().catch(() => null)
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'order_not_found', message: `Order not found: ${id}` })
  }
  if (!order.alertKey) {
    throw createError({ statusCode: 409, statusMessage: 'order_not_cancelable', message: 'Order has no alert to cancel' })
  }

  const result = await cancelPaperOrder({ alertKey: String(order.alertKey), by, reason })
  return { success: true, data: result }
})