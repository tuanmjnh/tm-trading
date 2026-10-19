// engine/macro.mjs
// Macro series mechanics (V3.5 §60 Slice C) — PURE, offline-testable.
//
// Pilot status: NO macro source is wired (Slice A audit: crypto press only).
// These are the vintage/revision mechanics §60.11 requires so that when a
// source arrives (Slice F), history is reproducible: every observation carries
// its reference period + publication (vintage) time, and point-in-time reads
// never see a revision published later than the query time.
//
// - observationIdFor: DETERMINISTIC `_id = seriesId|refPeriod|vintageAt`.
// - observationAsOf: latest vintage with vintageAt <= asOf (PIT-safe).
// - revise: appends a newer vintage, never mutates the old one.

import { createHash } from 'node:crypto'

export const MACRO_SCHEMA_VERSION = '1'

export const MACRO_CALENDAR_SCHEMA_VERSION = '1'

/** How far ahead a projected release may be published (a guess is not a schedule). */
export const MACRO_CALENDAR_HORIZON_MS = 120 * 86400 * 1000

/** Minimum observed publications before a cadence projection is allowed at all. */
export const MACRO_CALENDAR_MIN_SAMPLES = 3

export function calendarEventIdFor(seriesId, refPeriod, scheduledAtMs) {
  return `${seriesId}|${refPeriod}|${new Date(scheduledAtMs).toISOString()}`
}

export function observationIdFor(seriesId, refPeriod, vintageAtMs) {
  const v = new Date(vintageAtMs).toISOString()
  return `${seriesId}|${refPeriod}|${v}`
}

export function macroHash(seriesId, refPeriod, value, unit) {
  return createHash('sha1').update(`${seriesId}|${refPeriod}|${value}|${unit}`).digest('hex')
}

/**
 * Point-in-time read: the newest observation vintage for (series, refPeriod)
 * published at or before `asOf`. Null = unknown at that time (honest gap —
 * callers must render "insufficient evidence", never interpolate).
 */
export function observationAsOf(observations, asOfMs) {
  const asOf = Number(asOfMs)
  let best = null
  for (const o of observations || []) {
    const v = new Date(o.vintageAt).getTime()
    if (!Number.isFinite(v) || v > asOf) continue
    if (!best || v > new Date(best.vintageAt).getTime()) best = o
  }
  return best
}

/**
 * Release cadence from observed publication (vintage) times — PURE.
 *
 * This is the honest basis for a calendar row when no official schedule feed is
 * licensed: we project the NEXT release from how the source has actually been
 * publishing. `gapDays` uses the median of consecutive gaps, which is robust to
 * a skipped or extra publication. Fewer than MACRO_CALENDAR_MIN_SAMPLES
 * publications -> no projection at all (never invent a date from one data point).
 */
export function releaseCadence(vintages, { minSamples = MACRO_CALENDAR_MIN_SAMPLES } = {}) {
  const days = [...new Set((vintages || [])
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t))
    .map((t) => new Date(t).toISOString().slice(0, 10)))]
    .sort()
  if (days.length < Math.max(2, Number(minSamples) - 1)) return null
  const gaps = []
  for (let i = 1; i < days.length; i++) {
    gaps.push((Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`)) / 86400000)
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const gapDays = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    samples: days.length,
    gapDays,
    cadence: gapDays >= 350 ? 'annual' : gapDays >= 25 ? 'monthly' : gapDays >= 6 ? 'weekly' : 'frequent',
    lastPublishedAt: days[days.length - 1],
    irregular: (sorted[sorted.length - 1] - sorted[0]) > Math.max(6, gapDays), // spread warns the caller
  }
}

/**
 * Project the next scheduled release for one series — PURE. Returns null when
 * there is not enough history, when the date would be absurd, or when the
 * projection is outside the horizon. `projected: true` is part of the contract:
 * a cadence guess must never be presented as an official schedule.
 */
export function projectNextRelease({ seriesId, name, vintages, nowMs, minSamples = MACRO_CALENDAR_MIN_SAMPLES, horizonMs = MACRO_CALENDAR_HORIZON_MS } = {}) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const cadence = releaseCadence(vintages, { minSamples })
  if (!cadence) return null
  const last = Date.parse(`${cadence.lastPublishedAt}T00:00:00Z`)
  if (!Number.isFinite(last)) return null
  const scheduledAt = last + Math.round(cadence.gapDays) * 86400000
  if (!(scheduledAt > now)) return null // already past: a projection must be forward-looking
  if (scheduledAt - now > Number(horizonMs)) return null // too far out to be useful
  const scheduledDay = new Date(scheduledAt).toISOString().slice(0, 10)
  return {
    seriesId: String(seriesId || ''),
    name: name || null,
    refPeriod: scheduledDay,
    scheduledAt: new Date(scheduledAt),
    projected: true,
    method: 'cadence',
    cadence: cadence.cadence,
    gapDays: cadence.gapDays,
    samples: cadence.samples,
    confidence: cadence.samples >= 6 && !cadence.irregular ? 'medium' : 'low',
  }
}

/**
 * Calendar row doc (V3.5 §60.7 / §60.11). `previous` carries the last published
 * observation with its own provenance; consensus stays empty because no licensed
 * consensus source exists — an empty consensus is honest, an invented one is not.
 */
export function toCalendarEvent({ series = {}, projection, previous = null, nowMs } = {}) {
  if (!projection || !projection.scheduledAt) return null
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  return {
    _id: calendarEventIdFor(projection.seriesId, projection.refPeriod, new Date(projection.scheduledAt).getTime()),
    seriesId: projection.seriesId,
    refPeriod: projection.refPeriod,
    scheduledAt: new Date(projection.scheduledAt),
    title: `${projection.name || series.name || projection.seriesId} — ${projection.refPeriod}`,
    marketGroup: series.marketGroup || 'macro_cb',
    kind: 'macro_release',
    importance: series.frequency === 'm' ? 'high' : 'med',
    previous: previous
      ? { value: Number(previous.value), sourceId: previous.sourceId || null, vintageAt: new Date(previous.vintageAt) }
      : { value: null, sourceId: null, vintageAt: null },
    consensus: { value: null, sourceId: null, vintageAt: null },
    actual: { value: null, sourceId: null, vintageAt: null },
    status: 'scheduled',
    projected: projection.projected === true,
    projection: {
      method: projection.method || 'cadence',
      cadence: projection.cadence || null,
      samples: projection.samples ?? null,
      confidence: projection.confidence || 'low',
    },
    computedAt: new Date(now),
    sourceId: series.sourceId || 'fred',
    schemaVersion: MACRO_CALENDAR_SCHEMA_VERSION,
  }
}

/**
 * Build a new-vintage observation doc. Returns null when the payload is
 * unusable (no series/period/value). Revisions are new docs, never edits.
 */
export function toMacroObservation({ seriesId, refPeriod, value, unit, vintageAt, sourceId, status = 'actual' }, nowMs) {
  if (!seriesId || !refPeriod || value === null || value === undefined || !vintageAt) return null
  const vMs = new Date(vintageAt).getTime()
  if (!Number.isFinite(vMs)) return null
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  return {
    _id: observationIdFor(seriesId, refPeriod, vMs),
    seriesId,
    refPeriod,
    value: Number(value),
    unit: unit || '',
    vintageAt: new Date(vMs),
    firstSeenAt: new Date(now),
    sourceId: sourceId || null,
    status,
    hash: macroHash(seriesId, refPeriod, value, unit || ''),
    schemaVersion: MACRO_SCHEMA_VERSION,
  }
}
