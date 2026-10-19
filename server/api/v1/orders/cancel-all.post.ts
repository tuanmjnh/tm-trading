import { readBody } from 'h3'
import { cancelPaperOrder } from '../../../utils/paperOrders'
import { engineModel } from '../../../utils/engineModel'

/**
 * POST /api/v1/orders/cancel-all — cancel every cancelable paper order (§17.2/D14).
 *
 * Bulk convenience ONLY: each order goes through the SAME guarded
 * cancelPaperOrder() compare-and-swap as the single-cancel endpoint (alert
 * received/working or it is reported skipped, never forced) — a terminal can
 * never race the executor, even sweeping the whole book. Capped at 100 rows
 * per call so one tap cannot pin the event loop.
 *
 * Body: { by?, reason? } (audit trail, default terminal/manual).
 * Response: { cancelled: string[] (alertKeys), skipped: { id, reason }[] }.
 * Requires hub token (D10) — WRITE endpoint.
 */
const SWEEP_CAP = 100

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const by = typeof body?.by === 'string' && body.by.trim() ? String(body.by).slice(0, 64) : 'terminal'
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? String(body.reason).slice(0, 200) : 'cancel-all'

  const PaperOrder = await engineModel('order.mjs', 'PaperOrder')
  if (!PaperOrder) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — cancel failed' })
  }

  // Tenancy (docs/web-app/user-tenancy-plan.md): a panic sweep is scoped to the
  // caller's own book — it must never touch another account's orders.
  const ownerId = requireOwnerId(event)
  const live = await PaperOrder.find({ ownerId, status: { $in: ['created', 'riskChecked', 'pending', 'partiallyFilled'] } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(SWEEP_CAP)
    .lean()
    .catch(() => [])

  const cancelled: string[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const o of live as Array<{ alertKey?: unknown; clientOrderId?: unknown; _id?: unknown }>) {
    const id = String(o.clientOrderId ?? o._id ?? '?')
    const alertKey = typeof o.alertKey === 'string' ? o.alertKey : null
    if (!alertKey) {
      skipped.push({ id, reason: 'order_not_cancelable' })
      continue
    }
    try {
      await cancelPaperOrder({ alertKey, ownerId, by, reason })
      cancelled.push(alertKey)
    } catch (err) {
      const r = (err as { statusMessage?: unknown }).statusMessage
      skipped.push({ id, reason: typeof r === 'string' ? r : 'cancel_failed' })
    }
  }

  return {
    success: true,
    data: {
      cancelled,
      skipped,
      meta: { cancelled: cancelled.length, skipped: skipped.length, capped: live.length >= SWEEP_CAP }
    }
  }
})
