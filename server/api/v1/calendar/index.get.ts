// GET /api/v1/calendar — scheduled macro releases (V3.5 §60.7 / §60.12).
// Query: ?fromMs=&toMs=&kind=&limit=. Every row reports `projected` and, when it
// is, the cadence evidence behind it: a projection is never dressed as an
// official schedule. Mongo down -> 200 with meta.mongo='down' (page degrades).
import { listMacroCalendar } from '~~/server/utils/macroCalendar'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined)
  return listMacroCalendar({
    fromMs: num(q.fromMs),
    toMs: num(q.toMs),
    kind: q.kind ? String(q.kind) : undefined,
    limit: num(q.limit) ?? 50,
  })
})
