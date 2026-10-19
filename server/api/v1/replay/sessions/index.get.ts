import { listReplaySessions } from '../../../../utils/replaySessions'

// =============================================================================
//  GET /api/v1/replay/sessions — active in-memory replay sessions (Slice B).
//
//  Read-only observability over the session registry: newest first. Sessions
//  are NOT durable (process restart empties the list — Slice C) and this
//  endpoint never invents rows to hide that. Token required (D10).
// =============================================================================

export default defineEventHandler((event) => {
  const data = listReplaySessions(requireOwnerId(event))
  return { success: true, data, meta: { count: data.length } }
})
