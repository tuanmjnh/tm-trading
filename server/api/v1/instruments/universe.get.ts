import { getUniverse } from '../../../utils/marketUniverse'

/**
 * GET /api/v1/instruments/universe — live symbol universe for symbol search.
 *
 * Bybit linear perpetuals + Binance spot (public REST) merged over the static
 * catalog, cached 15 min per process. Fail-soft: upstream bans/outages yield
 * stale cache, then static-only — never a 500. Upstream auth required (D10).
 */
export default defineEventHandler(async () => {
  const payload = await getUniverse()
  return { success: true, data: payload.rows, meta: payload.meta }
})
