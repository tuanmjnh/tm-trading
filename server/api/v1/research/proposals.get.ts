import { getQuery } from 'h3'
import { listProposals } from '../../../utils/research'

/**
 * GET /api/v1/research/proposals — recorded AI experiment proposals (roadmap
 * §27.3 / §30.7). Proposals are DATA only (D7): accepting one creates an
 * experiment, it never changes production state.
 *
 * Query: ?status=new|accepted|rejected|experimented&limit=50
 * Fail-soft: Mongo down -> 200 empty list + meta.mongo='down'.
 */
export default defineEventHandler(async (event) => {
  const { limit } = getListParams(event, 50, 200)
  const query = getQuery(event)
  const status = query.status ? String(query.status) : undefined

  const { rows, mongo } = await listProposals({ status, limit }, {}, requireOwnerId(event))
  return { success: true, data: rows, meta: { count: rows.length, mongo } }
})
