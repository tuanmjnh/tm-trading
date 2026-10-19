import { getRouterParam } from 'h3'
import { getStrategyResearch } from '../../../../utils/research'

/**
 * GET /api/v1/research/strategies/:id — research view of one strategy (roadmap
 * §30.7): its profile, immutable versions (§29), and every experiment/proposal
 * tied to those versions.
 *
 * Fail-soft: Mongo down -> 200 with empty collections + meta.mongo='down'
 * (a read must not 500 when the store blips).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    return { success: false, error: 'strategy id required', data: null, meta: { mongo: 'down' } }
  }

  const data = await getStrategyResearch(id, {}, requireOwnerId(event))
  return {
    success: true,
    data,
    meta: { mongo: data.mongo, versions: data.versions.length, experiments: data.experiments.length, proposals: data.proposals.length }
  }
})
