import { getRouterParam } from 'h3'
import { getTradingSession, sessionsHttpError } from '../../../utils/sessions'

// =============================================================================
//  GET /api/v1/sessions/:id — one trading session with its event timeline.
//  id = sessionId (or Mongo _id). Unknown id -> 404. Token required (D10).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw sessionsHttpError(new Error('session id is required'))
  }
  try {
    const data = await getTradingSession(id, requireOwnerId(event))
    if (!data) {
      throw sessionsHttpError(Object.assign(new Error(`session not found: ${id}`), { statusCode: 404, statusMessage: 'session_not_found' }))
    }
    return { success: true, data }
  } catch (err) {
    throw sessionsHttpError(err)
  }
})
