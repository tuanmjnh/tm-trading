import { getQuery } from 'h3'
import { listInstruments, INSTRUMENT_TYPES } from '../../../utils/instruments'

/**
 * GET /api/v1/instruments — list all canonical instruments (§30.1).
 *
 * Query: ?type=perp|spot|future|option&status=active|inactive
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const type = q.type ? String(q.type) : undefined
  const status = q.status ? String(q.status) : undefined

  if (type && !INSTRUMENT_TYPES.includes(type)) {
    return { success: false, error: `type must be one of ${INSTRUMENT_TYPES.join(',')}`, data: [] }
  }

  const data = listInstruments({ type, status })
  return { success: true, data, meta: { count: data.length } }
})