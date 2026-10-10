import { VENUE_IDS, CATALOG_VENUES, INSTRUMENTS, type InstrumentVenue } from '../../utils/instruments'

/**
 * GET /api/v1/venues — list all supported venues (§30.1).
 *
 * Returns both the catalog venues (from instruments) and the hardcoded
 * provider ids (from market/providers/*.mjs).
 */
export default defineEventHandler(async (event) => {
  const catalog = CATALOG_VENUES
  const providers = VENUE_IDS

  // Build venue metadata
  const data = [...new Set([...catalog, ...providers])].map((v: string) => ({
    id: v,
    inCatalog: catalog.includes(v),
    hasProvider: providers.includes(v),
    instruments: INSTRUMENTS.filter((i: typeof INSTRUMENTS[0]) => i.venues.some((vv: InstrumentVenue) => vv.venue === v)).map((i: typeof INSTRUMENTS[0]) => i.id),
  }))

  return { success: true, data, meta: { count: data.length } }
})