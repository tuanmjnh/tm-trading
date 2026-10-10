import { createError, readBody } from 'h3'
import {
  buildTicketAlert,
  engineKeys,
  ticketAlertModel,
  validateTicket
} from '../../../utils/orders'

// =============================================================================
//  POST /api/v1/orders — trade ticket (roadmap Phase 7T).
//
//  Writes a manual ENTRY alert (status 'received', source 'manual'). The paper
//  executor owns everything downstream: risk gate (D7), sizing, fill, PnL.
//  Requires the hub token (server/middleware/auth.ts) — first WRITE endpoint
//  of the dashboard, so it is deliberately thin: validate -> key -> insert.
//
//  Duplicates (same symbol/tf/side/price/ts within one second, double click)
//  hit the unique alertKey index and surface as 409 instead of a second alert.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const v = validateTicket(body)
  if (!v.ok) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_ticket', message: v.error })
  }

  const Alert = await ticketAlertModel()
  if (!Alert) {
    throw createError({
      statusCode: 503,
      statusMessage: 'mongo_down',
      message: 'MongoDB unavailable — order not stored, nothing placed'
    })
  }

  const ts = new Date()
  const doc = buildTicketAlert(body as Record<string, unknown>, ts)
  const { alertKey } = await engineKeys()
  const key = alertKey(doc as unknown as Record<string, unknown>, 'manual')

  try {
    const created = await Alert.create({ ...doc, alertKey: key })
    return {
      success: true,
      data: { alertKey: key, status: doc.status, id: String(created._id) }
    }
  } catch (e: unknown) {
    const code = (e as { code?: number } | null)?.code
    if (code === 11000) {
      throw createError({
        statusCode: 409,
        statusMessage: 'duplicate',
        message: 'Duplicate order (identical payload in the same second)'
      })
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'insert_failed',
      message: `Order not stored: ${String((e as Error)?.message ?? e)}`
    })
  }
})
