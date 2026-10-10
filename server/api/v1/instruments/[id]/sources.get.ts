import { getRouterParam } from 'h3'
import { getInstrumentVenues } from '../../../../utils/instruments'

/**
 * GET /api/v1/instruments/:id/sources — venue data sources for an instrument (§30.1).
 *
 * Returns the venue mappings (native symbol per venue).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'instrument id required', data: [] }

  const decoded = decodeURIComponent(String(id))
  const venues = getInstrumentVenues(decoded)
  if (!venues.length) return { success: false, error: 'instrument not found', data: [] }

  return { success: true, data: venues, meta: { count: venues.length } }
})