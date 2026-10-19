// services/macro.mjs
// =============================================================================
//  MACRO service — FRED observations with vintage lineage (V3.5 §60 Slice F).
//
//  Federal Reserve Economic Data (FRED) is the free, key-gated official source
//  for US macro series (key: https://fred.stlouisfed.org — FRED_API_KEY env,
//  server-side only). No key -> { skipped: 'no-key' } (fail-soft, same as the
//  CryptoPanic pattern — heartbeat records the skip, nothing throws).
//
//  Vintages: FRED returns realtime_start/realtime_end per observation — the
//  window during which this value was the known truth. vintageAt =
//  realtime_end (the last moment this vintage was current); engine/macro.mjs
//  observationAsOf() then gives PIT-safe historical reads, so a revision
//  never leaks into a past evaluation. Revisions are new docs, never edits.
//
//  Series seed (registry, $setOnInsert — operator edits survive):
//    FEDFUNDS  Effective Federal Funds Rate (%)
//    DGS10     10-Year Treasury Constant Maturity Rate (%, daily)
//    CPIAUCSL  CPI All Urban Consumers (Index 1982-84=100, monthly)
//    PAYEMS    All Employees, Total Nonfarm (thousands, monthly)
//    UNRATE    Unemployment Rate (%, monthly)
//    WALCL     Fed balance sheet, Total Assets ($M, weekly)
// =============================================================================
import { connectMongo } from '../engine/db.mjs'
import { projectNextRelease, toCalendarEvent, toMacroObservation } from '../engine/macro.mjs'

export const MACRO_SERIES = Object.freeze([
  { seriesId: 'FEDFUNDS', name: 'Effective Federal Funds Rate', unit: '%', frequency: 'm' },
  { seriesId: 'DGS10', name: '10-Year Treasury Constant Maturity Rate', unit: '%', frequency: 'd' },
  { seriesId: 'CPIAUCSL', name: 'Consumer Price Index (1982-84=100)', unit: 'index', frequency: 'm' },
  { seriesId: 'PAYEMS', name: 'All Employees: Total Nonfarm Payrolls', unit: 'thousands', frequency: 'm' },
  { seriesId: 'UNRATE', name: 'Unemployment Rate', unit: '%', frequency: 'm' },
  { seriesId: 'WALCL', name: 'Fed Balance Sheet: Total Assets', unit: '$M', frequency: 'w' },
])

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FETCH_TIMEOUT_MS = 15000

let seriesMemo = null
let obsMemo = null
let calMemo = null

export async function getMacroSeries() {
  if (seriesMemo) return seriesMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/macroSeries.mjs')
  seriesMemo = mod.MacroSeries
  return seriesMemo
}

export async function getMacroObservation() {
  if (obsMemo) return obsMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/macroObservation.mjs')
  obsMemo = mod.MacroObservation
  return obsMemo
}

export async function getMacroCalendarEvent() {
  if (calMemo) return calMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/macroCalendarEvent.mjs')
  calMemo = mod.MacroCalendarEvent
  return calMemo
}

export function resetMacroMemo() {
  seriesMemo = null
  obsMemo = null
  calMemo = null
}

async function fetchSeries(seriesId, apiKey, fetchImpl, since) {
  const doFetch = fetchImpl || fetch
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: since,
    order_by: 'observation_date',
    sort_order: 'asc',
  })
  const res = await doFetch(`${FRED_BASE}?${params.toString()}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`)
  const json = await res.json()
  return json?.observations || []
}

/** One FRED observation -> vintage-pinned doc (null when unusable). */
export function toVintageDoc(series, ob, nowMs) {
  if (!ob || ob.value === '.' || ob.value === null || ob.value === undefined) return null
  const value = Number(ob.value)
  if (!Number.isFinite(value)) return null
  // vintageAt = realtime_end: the last moment this vintage was the known truth.
  const vintageAt = ob.realtime_end || ob.realtime_start
  return toMacroObservation(
    { seriesId: series.seriesId, refPeriod: String(ob.date), value, unit: series.unit, vintageAt, sourceId: 'fred', status: 'actual' },
    nowMs,
  )
}

/**
 * One run: seed series registry + upsert recent observations per series.
 * @returns summary (also the heartbeat lastSummary)
 */
export async function runMacro({ fetchImpl, now = new Date(), apiKey = process.env.FRED_API_KEY || '', deps = {} } = {}) {
  if (!apiKey) return { skipped: 'no-key', series: 0, observations: 0 }
  const Series = deps.SeriesModel || (await getMacroSeries())
  const Obs = deps.ObsModel || (await getMacroObservation())
  if (!Series || !Obs) return { skipped: 'mongo-down', series: 0, observations: 0 }
  const since = new Date(now.getTime() - 400 * 86400 * 1000).toISOString().slice(0, 10)
  await Series.bulkWrite(
    MACRO_SERIES.map((s) => ({
      updateOne: {
        filter: { _id: s.seriesId },
        update: {
          $setOnInsert: {
            _id: s.seriesId, seriesId: s.seriesId, name: s.name, marketGroup: 'macro_cb',
            geography: 'US', unit: s.unit, frequency: s.frequency,
            sourceId: 'fred', licenseStatus: 'ok', schemaVersion: '1',
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )
  let observations = 0
  const errors = []
  for (const s of MACRO_SERIES) {
    try {
      const rows = await fetchSeries(s.seriesId, apiKey, fetchImpl, since)
      const ops = []
      for (const ob of rows) {
        const doc = toVintageDoc(s, ob, now.getTime())
        if (doc) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })
      }
      if (ops.length) {
        const res = await Obs.bulkWrite(ops, { ordered: false })
        observations += typeof res?.getUpsertedIds === 'function' ? Object.keys(res.getUpsertedIds()).length : (res?.upsertedCount ?? 0)
      }
    } catch (e) {
      errors.push(`${s.seriesId}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  if (errors.length === MACRO_SERIES.length) throw new Error(`macro: all series failed (${errors[0]})`)
  const calendar = await writeMacroCalendar({ Obs, Series: deps.SeriesModel || Series, now, deps })
  return { series: MACRO_SERIES.length, observations, errors, calendar }
}

/**
 * Write the projected release calendar (§60.7 Slice C).
 *
 * Each series' NEXT release is projected from the publication cadence we have
 * actually observed (`projectNextRelease`), and the row is written `$setOnInsert`
 * so an official schedule (projected: false) from a future connector is never
 * overwritten by a guess. Fail-soft: a calendar problem must not fail the
 * observations run. Returns the number of rows inserted.
 */
export async function writeMacroCalendar({ Obs, Series = null, now = new Date(), deps = {}, vintagesPerSeries = 8 } = {}) {
  try {
    const Cal = deps.CalendarModel || (await getMacroCalendarEvent())
    if (!Cal || !Obs) return 0
    const rows = Series ? await Series.find({}).lean() : []
    const byId = new Map((rows || []).map((r) => [r.seriesId || r._id, r]))
    let inserted = 0
    for (const s of MACRO_SERIES) {
      const vintages = await Obs.find({ seriesId: s.seriesId }).sort({ vintageAt: -1 }).limit(vintagesPerSeries).lean()
      const projection = projectNextRelease({
        seriesId: s.seriesId,
        name: byId.get(s.seriesId)?.name || s.name,
        vintages: (vintages || []).map((v) => v.vintageAt),
        nowMs: now.getTime(),
      })
      if (!projection) continue
      const latest = (vintages || [])[0] || null
      const doc = toCalendarEvent({
        series: { ...s, marketGroup: byId.get(s.seriesId)?.marketGroup || 'macro_cb', sourceId: 'fred' },
        projection,
        previous: latest ? { value: latest.value, sourceId: latest.sourceId, vintageAt: latest.vintageAt } : null,
        nowMs: now.getTime(),
      })
      if (!doc) continue
      const { _id, ...rest } = doc
      const res = await Cal.updateOne({ _id }, { $setOnInsert: { _id, ...rest } }, { upsert: true })
      if (res?.upsertedCount || res?.upsertedId) inserted += 1
    }
    return inserted
  } catch {
    return 0 // fail-soft: the heartbeat turns a silent 0 into "no schedule" and the UI renders it as such
  }
}
