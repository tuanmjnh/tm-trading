import { readBody } from 'h3'
import { engineModel } from '~~/server/utils/engineModel'

/**
 * POST /api/v1/paper/orders — place a paper order (§30.5).
 *
 * Creates an ENTRY alert that the paper executor will process in the next cycle.
 * Body: {
 *   account: string,
 *   symbol: string,
 *   side: 'BUY' | 'SELL',
 *   type: 'market' | 'limit' | 'stop',
 *   qty: number,
 *   price?: number,
 *   sl?: number,
 *   tps?: number[],
 *   tf?: string
 * }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { account, symbol, side, type, qty, price, sl, tps, tf } = body ?? {}

  if (!account || !symbol || !side || !type || !qty) {
    return { success: false, error: 'account, symbol, side, type, qty required' }
  }

  if (side !== 'BUY' && side !== 'SELL') return { success: false, error: 'side must be BUY or SELL' }

  const OrderTypes = ['market', 'limit', 'stop']
  if (!OrderTypes.includes(type)) return { success: false, error: 'type must be market|limit|stop' }

  const Alert = await engineModel('alert.mjs', 'Alert')
  if (!Alert) return { success: false, error: 'mongo down' }

  // Build alert key for idempotency (D3)
  const alertKey = `manual_${symbol}_${side}_${type}_${qty}_${Date.now()}`

  // Check if alert already exists
  const existing = await Alert.findOne({ alertKey }).lean()
  if (existing) {
    return { success: false, error: 'DUPLICATE_ALERT', message: 'Order already submitted' }
  }

  const alertDoc = {
    alertKey,
    action: 'ENTRY',
    symbol: symbol.toUpperCase(),
    side,
    price: price ?? null,
    sl: sl ?? null,
    tps: tps ?? [],
    tf: tf ?? null,
    status: 'received',
    source: 'manual',
    ts: Date.now(),
  }

  await Alert.create(alertDoc)

  return { success: true, data: { alertKey, message: 'Order submitted for processing' } }
})