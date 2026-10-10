import { readBody, getRouterParam } from 'h3'
import { cancelPaperOrder } from '../../../../../utils/paperOrders'

/**
 * POST /api/v1/paper/orders/:id/cancel — cancel a paper order (§30.5).
 * Body: { by: string, reason?: string }
 */
export default defineEventHandler(async (event) => {
  const orderId = getRouterParam(event, 'id')
  if (!orderId) return { success: false, error: 'order id required' }

  const body = await readBody(event)
  const { by = 'terminal', reason = 'manual' } = body ?? {}

  const r = await cancelPaperOrder({ alertKey: orderId, by, reason })

  if (!r.success) return { success: false, error: 'CANCEL_FAILED', message: `Failed to cancel: ${r.alertStatus}` }

  return { success: true, data: r }
})