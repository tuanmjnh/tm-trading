// GET /api/v1/calendar/:id — one scheduled release with its provenance
// (V3.5 §60.12). Unknown id -> 404; Mongo down -> 503 (nothing to project).
import { getMacroCalendarEvent } from '~~/server/utils/macroCalendar'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidArgs', message: 'id is required' })
  }
  return getMacroCalendarEvent(id)
})
