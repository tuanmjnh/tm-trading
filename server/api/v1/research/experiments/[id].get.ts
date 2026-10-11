import { getRouterParam } from 'h3'
import { getExperimentResearch } from '../../../../utils/research'

/**
 * GET /api/v1/research/experiments/:id — one experiment hydrated with its arm
 * runs, the §28.2 comparison and the §28.3 acceptance report (roadmap §30.7).
 *
 * Fail-soft: unknown id or Mongo down -> 200 { success:false, data:null }.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    return { success: false, error: 'experiment id required', data: null, meta: { mongo: 'down' } }
  }

  const data = await getExperimentResearch(id)
  if (!data.experiment) {
    return { success: false, error: 'experiment not found or mongo down', data: null, meta: { mongo: data.mongo } }
  }

  return {
    success: true,
    data,
    meta: { mongo: data.mongo, status: (data.experiment as { status?: string }).status ?? null }
  }
})
