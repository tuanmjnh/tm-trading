import { readBody, getRouterParam } from 'h3'
import { engineModel } from '~~/server/utils/engineModel'
import { fetchKlines } from '~~/engine/data.mjs'

/**
 * POST /api/v1/paper/positions/:id/close — close a paper position (§30.5).
 * Body: { reason?: string }
 */
export default defineEventHandler(async (event) => {
  const positionId = getRouterParam(event, 'id')
  if (!positionId) return { success: false, error: 'position id required' }

  const body = await readBody(event)
  const { reason = 'manual' } = body ?? {}

  const Position = await engineModel('position.mjs', 'Position')
  if (!Position) return { success: false, error: 'mongo down' }

  const pos = await Position.findOne({ _id: positionId }).lean()
  if (!pos) return { success: false, error: 'position not found' }
  if (pos.status !== 'open') return { success: false, error: 'position not open' }

  // Need a quote to close - fetch latest price
  const { bars } = await fetchKlines({ symbol: pos.symbol, tf: '1', market: 'fapi', refresh: true, limit: 2 })
  const last = (bars as Array<{ close?: number }>)?.[bars.length - 1]
  const price = last?.close ?? pos.entryPrice

  // Create a follow-up alert for the paper executor to process
  const Alert = await engineModel('alert.mjs', 'Alert')
  if (!Alert) return { success: false, error: 'mongo down' }

  const alertKey = `manual_close_${pos.symbol}_${positionId}_${Date.now()}`
  const alertDoc = {
    alertKey,
    action: 'TIME_CLOSE',
    symbol: pos.symbol,
    price,
    status: 'received',
    source: 'manual',
    ts: Date.now(),
  }

  await Alert.create(alertDoc)

  return { success: true, data: { positionId, alertKey, message: 'Close request submitted for processing' } }
})