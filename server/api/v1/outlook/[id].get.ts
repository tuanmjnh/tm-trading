// GET /api/v1/outlook/:id — stored horizon outlook snapshot (V3.5 §60.12).
// `:id` is the deterministic `outlook_<group>_<horizon>_<YYYY-MM-DD>` key; the
// response is the snapshot as written, flagged `stale` when expired/invalidated.
import { getOutlookById } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  return getOutlookById(id)
})
