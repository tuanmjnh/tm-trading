import { createError } from 'h3'
import { engineModel } from './engineModel'

// =============================================================================
//  Macro release calendar reads (V3.5 §60.7 / Slice C).
//
//  Rows are projections written by services/macro.mjs from the release cadence
//  observed in FRED vintages, so every response carries `projected` and the
//  projection's sample count and confidence. Mongo down -> { mongo: 'down',
//  events: [] } (never a 500, never a fabricated schedule).
//
//  `consensus` is returned as null when unknown instead of being omitted: the
//  page must be able to say "no consensus source" rather than render a blank
//  that looks like zero.
// =============================================================================

export interface MacroCalendarEventPublic {
  id: string
  seriesId: string
  title: string
  kind: string
  importance: string
  scheduledAt: string | null
  refPeriod: string
  status: string
  projected: boolean
  projectionMethod: string | null
  projectionCadence: string | null
  projectionSamples: number | null
  projectionConfidence: string | null
  previous: { value: number | null; sourceId: string | null; vintageAt: string | null }
  consensus: number | null
  actual: number | null
  sourceId: string | null
}

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const numOrNull = (v: unknown): number | null => {
  // Number(null) === 0 and Number('') === 0: an absent consensus/actual must be
  // NULL, never zero, or the page would claim a forecast nobody published.
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Allowlist projection of one calendar row — no internal fields leave here. */
export function toPublicMacroCalendarEvent(d: Record<string, any>): MacroCalendarEventPublic {
  return {
    id: String(d._id || ''),
    seriesId: String(d.seriesId || ''),
    title: String(d.title || d.seriesId || ''),
    kind: String(d.kind || 'macro_release'),
    importance: d.importance === 'high' || d.importance === 'low' ? d.importance : 'med',
    scheduledAt: isoOrNull(d.scheduledAt),
    refPeriod: String(d.refPeriod || ''),
    status: ['scheduled', 'released', 'revised', 'cancelled'].includes(d.status) ? String(d.status) : 'scheduled',
    projected: d.projected !== false,
    projectionMethod: d.projection?.method || null,
    projectionCadence: d.projection?.cadence || null,
    projectionSamples: numOrNull(d.projection?.samples),
    projectionConfidence: d.projection?.confidence || null,
    previous: {
      value: numOrNull(d.previous?.value),
      sourceId: d.previous?.sourceId || null,
      vintageAt: isoOrNull(d.previous?.vintageAt),
    },
    consensus: numOrNull(d.consensus?.value),
    actual: numOrNull(d.actual?.value),
    sourceId: d.sourceId || null,
  }
}

export interface ListCalendarQuery {
  fromMs?: number
  toMs?: number
  kind?: string
  limit: number
  deps?: { MacroCalendarEventModel?: any }
}

export async function listMacroCalendar(
  q: ListCalendarQuery,
): Promise<{ events: MacroCalendarEventPublic[]; meta: { mongo: 'up' | 'down'; total: number; projected: number; generatedAt: string | null } }> {
  const Model = q.deps?.MacroCalendarEventModel || (await engineModel('macroCalendarEvent.mjs', 'MacroCalendarEvent'))
  if (!Model) {
    return { events: [], meta: { mongo: 'down', total: 0, projected: 0, generatedAt: null } }
  }
  const now = Date.now()
  const filter: Record<string, unknown> = {
    scheduledAt: { $gte: new Date(Number.isFinite(q.fromMs) ? Number(q.fromMs) : now - 86400 * 1000) },
  }
  if (Number.isFinite(q.toMs)) (filter.scheduledAt as Record<string, unknown>).$lte = new Date(Number(q.toMs))
  if (q.kind) filter.kind = String(q.kind)
  const limit = Number.isFinite(q.limit) && q.limit > 0 ? Math.min(Math.floor(q.limit), 200) : 50
  const docs = await Model.find(filter).sort({ scheduledAt: 1 }).limit(limit).lean()
  const events = (docs as Array<Record<string, any>>).map(toPublicMacroCalendarEvent)
  return {
    events,
    meta: {
      mongo: 'up',
      total: await Model.countDocuments(filter).catch(() => events.length),
      projected: events.filter((e) => e.projected).length,
      generatedAt: new Date(now).toISOString(),
    },
  }
}

export async function getMacroCalendarEvent(
  id: string,
  deps?: { MacroCalendarEventModel?: any },
): Promise<MacroCalendarEventPublic> {
  const Model = deps?.MacroCalendarEventModel || (await engineModel('macroCalendarEvent.mjs', 'MacroCalendarEvent'))
  if (!Model) {
    throw createError({ statusCode: 503, statusMessage: 'error.mongoDown', message: 'mongo offline — calendar unavailable' })
  }
  const doc = await Model.findOne({ _id: String(id) }).lean()
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: `calendar event khong ton tai: ${id}` })
  }
  return toPublicMacroCalendarEvent(doc as Record<string, any>)
}
