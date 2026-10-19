import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { loadIndicatorRun } from '../../../utils/indicators'

/**
 * GET /api/v1/indicator-runs/:id — one stored indicator run (roadmap §30.3).
 *
 * Fail-soft: unknown id -> 200 { success:false, error, data:null } (matches
 * paper/accounts/:id). Mongo unavailable -> 200 with meta.mongo='down' — never
 * 500 (a read must not explode when the store is briefly gone).
 */
export default defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    return { success: false, error: 'run id required', data: null, meta: { mongo: 'down' } }
  }

  const { run, mongo } = await loadIndicatorRun(id, requireOwnerId(event))

  if (!run) {
    return {
      success: false,
      error: 'indicator run not found or mongo down',
      data: null,
      meta: { mongo }
    }
  }

  return { success: true, data: run, meta: { mongo } }
})