import { getQuery } from 'h3'
import { listSessions } from '../../../utils/sessions'

// =============================================================================
//  GET /api/v1/sessions — trading sessions, newest activity first (Slice C).
//
//  Query: ?limit=&state=&kind=&accountId=. Reads are fail-soft (store blips
//  yield an empty list, never a 500). Token required (D10).
// =============================================================================

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const data = await listSessions({
    limit: q.limit ? Number(q.limit) : undefined,
    ownerId: requireOwnerId(event),
    state: q.state ? String(q.state) : undefined,
    kind: q.kind ? String(q.kind) : undefined,
    accountId: q.accountId ? String(q.accountId) : undefined
  })
  return { success: true, data, meta: { count: data.length } }
})
