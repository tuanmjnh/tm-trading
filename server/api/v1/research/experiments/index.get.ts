import { getQuery } from 'h3'
import { listExperiments } from '../../../../utils/research'

/**
 * GET /api/v1/research/experiments — recorded experiments (roadmap §28.1 /
 * §30.7). This is the human review queue: `?status=proposed` lists what the AI
 * proposed and is waiting on approval; `?status=paper_validation` lists what is
 * ready for an accept/reject decision.
 *
 * Query: ?status=new|proposed|approved|...|accepted|rejected&limit=50
 * Fail-soft: Mongo down -> 200 empty list + meta.mongo='down'.
 */
export default defineEventHandler(async (event) => {
  const { limit } = getListParams(event, 50, 200)
  const query = getQuery(event)
  const status = query.status ? String(query.status) : undefined

  const { rows, mongo } = await listExperiments({ status, limit }, {}, requireOwnerId(event))
  return { success: true, data: rows, meta: { count: rows.length, mongo } }
})
