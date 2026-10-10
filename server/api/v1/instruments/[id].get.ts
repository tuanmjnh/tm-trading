import { getRouterParam } from 'h3'
import { getInstrument } from '../../../utils/instruments'

/**
 * GET /api/v1/instruments/:id — instrument detail (§30.1).
 *
 * The :id is the canonical id (e.g. 'crypto:perp:BTC/USDT').
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'instrument id required', data: null }

  const decoded = decodeURIComponent(String(id))
  const data = getInstrument(decoded)
  if (!data) return { success: false, error: 'instrument not found', data: null }

  return { success: true, data }
})