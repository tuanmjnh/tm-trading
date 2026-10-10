import {
  VENUE_IDS,
  INSTRUMENTS,
  type InstrumentVenue,
} from '../../../utils/instruments'
import { fetchJson } from '../../../utils/marketRest'

/**
 * GET /api/v1/market-sources/health — health of all data sources (§30.1).
 *
 * Performs a lightweight probe against each venue's public REST endpoint.
 * Returns { venue, status, latencyMs, error? } for each.
 */
export default defineEventHandler(async (event) => {
  const results = await Promise.all(
    VENUE_IDS.map(async (venue: string) => {
      const start = Date.now()
      let status = 'down'
      let error: string | undefined
      let latencyMs: number | undefined

      try {
        if (venue === 'binance') {
          const u = new URL('https://fapi.binance.com/fapi/v1/ping')
          await fetchJson(u.toString())
          status = 'up'
        } else if (venue === 'bybit') {
          const u = new URL('https://api.bybit.com/v5/market/time')
          await fetchJson(u.toString())
          status = 'up'
        } else if (venue === 'okx') {
          const u = new URL('https://www.okx.com/api/v5/public/time')
          await fetchJson(u.toString())
          status = 'up'
        } else {
          status = 'unknown'
        }
        latencyMs = Date.now() - start
      } catch (err) {
        latencyMs = Date.now() - start
        error = err instanceof Error ? err.message : String(err)
      }

      return { venue, status, latencyMs, error }
    })
  )

  // Add instrument coverage per venue
  const coverage = results.map((r: typeof results[0]) => ({
    ...r,
    instruments: INSTRUMENTS.filter((i: typeof INSTRUMENTS[0]) => i.venues.some((v: InstrumentVenue) => v.venue === r.venue)).length,
  }))

  const healthy = coverage.filter((c: typeof coverage[0]) => c.status === 'up').length
  return { success: true, data: coverage, meta: { total: coverage.length, healthy } }
})