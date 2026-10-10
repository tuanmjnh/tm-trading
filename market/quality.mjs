// market/quality.mjs
// Roadmap §24.1 data-quality checks: turn the RAW counters the market plane
// already measures (monitor status: latency + sequence; optional malformed /
// heartbeat inputs) into per-stream RATES and a named verdict.
//
// PURE: it never measures anything itself and never fabricates (D12) — a metric
// without samples is `null`, a heartbeat nobody reported is `unknown`, and the
// verdict degrades to 'unknown' instead of a happy 'ok' when nothing was
// observed. Rates are defined over what was OBSERVED (documented below); they
// are approximations of the stream, not claims about the venue.
//
//   duplicateRate   = dup / count
//   outOfOrderRate  = outOfOrder / count
//   gapRate         = gaps / (count + gaps)        (missing / (seen + missing))
//   malformedRate   = malformed / (seen + malformed)
//
// NOT wired yet: no service feeds `malformed`/`heartbeats` today (the provider
// layer does not count rejects yet) — the evaluator is ready, the inputs are
// still null-honest.

/** Version stamp (D1). */
export const QUALITY_SCHEMA_VERSION = 'quality.v1'

/** §24.1 default thresholds — every one overridable per call. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  p95LatencyMs: 500,
  duplicateRate: 0.001,
  outOfOrderRate: 0.005,
  gapRate: 0.01,
  malformedRate: 0.005,
  staleMs: 60_000,
})

const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)
/** Honest rate: null when nothing was observed, never 0-by-default. */
const rate = (n, denom) => (denom > 0 ? n / denom : null)

/**
 * Evaluate data quality from observed counters.
 *
 * @param {object} [opts]
 * @param {object} [opts.status]     shape of `monitor.status()` — {latency:{samples,p50,p95,max,bySource}, seq:{stream:{count,dup,gaps,outOfOrder}}}
 * @param {number} [opts.malformed]  count of provider events that failed normalization
 * @param {object} [opts.heartbeats] { source -> ageMs | null } — null/absent = unknown
 * @param {object} [opts.thresholds] overrides for DEFAULT_THRESHOLDS
 * @returns {{schemaVersion, verdict:'ok'|'suspect'|'unknown', latency, seq, malformed, heartbeats, suspect: Array<{id:string, reasons:string[]}>}}
 */
export function evaluateQuality({ status = {}, malformed = 0, heartbeats = {}, thresholds = {} } = {}) {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const suspect = []
  const flag = (id, ok, reasons) => { if (ok === false && reasons.length) suspect.push({ id, reasons }) }

  // --- sequence: per stream -------------------------------------------------
  const seq = {}
  const agg = { count: 0, dup: 0, gaps: 0, outOfOrder: 0 }
  for (const [stream, s] of Object.entries(status.seq ?? {})) {
    const count = num(s?.count) ?? 0
    const dup = num(s?.dup) ?? 0
    const gaps = num(s?.gaps) ?? 0
    const outOfOrder = num(s?.outOfOrder) ?? 0
    const duplicateRate = rate(dup, count)
    const outOfOrderRate = rate(outOfOrder, count)
    const gapRate = rate(gaps, count + gaps)
    const reasons = []
    if (duplicateRate != null && duplicateRate > th.duplicateRate) reasons.push(`duplicateRate ${duplicateRate.toFixed(4)} > ${th.duplicateRate}`)
    if (outOfOrderRate != null && outOfOrderRate > th.outOfOrderRate) reasons.push(`outOfOrderRate ${outOfOrderRate.toFixed(4)} > ${th.outOfOrderRate}`)
    if (gapRate != null && gapRate > th.gapRate) reasons.push(`gapRate ${gapRate.toFixed(4)} > ${th.gapRate}`)
    seq[stream] = { count, dup, gaps, outOfOrder, duplicateRate, outOfOrderRate, gapRate, healthy: reasons.length ? false : true }
    flag(stream, seq[stream].healthy, reasons)
    agg.count += count; agg.dup += dup; agg.gaps += gaps; agg.outOfOrder += outOfOrder
  }

  // --- latency: aggregate (bySource kept verbatim) ---------------------------
  const lat = status.latency ?? {}
  const latSamples = num(lat.samples) ?? 0
  const latP95 = num(lat.p95)
  const latHealthy = latSamples > 0 ? (latP95 != null && latP95 <= th.p95LatencyMs) : null
  const latency = { samples: latSamples, p50: num(lat.p50), p95: latP95, max: num(lat.max), bySource: lat.bySource ?? {}, healthy: latHealthy }
  flag('latency', latHealthy, latHealthy === false ? [`p95 ${latP95}ms > ${th.p95LatencyMs}ms`] : [])

  // --- malformed events -------------------------------------------------------
  const malformedCount = num(malformed) ?? 0
  const malformedRate = rate(malformedCount, agg.count + malformedCount)
  const malformedOk = malformedRate == null ? null : malformedRate <= th.malformedRate
  flag('malformed', malformedOk, malformedOk === false ? [`malformedRate ${malformedRate.toFixed(4)} > ${th.malformedRate}`] : [])

  // --- heartbeats: stale / unknown -------------------------------------------
  const hb = {}
  for (const [source, ageMs] of Object.entries(heartbeats)) {
    const age = num(ageMs)
    hb[source] = { ageMs: age, stale: age == null ? null : age > th.staleMs }
    flag(`heartbeat:${source}`, hb[source].stale === null ? null : !hb[source].stale, hb[source].stale ? [`last event ${age}ms ago > ${th.staleMs}ms`] : [])
  }

  // --- verdict: unknown unless SOMETHING was observed -------------------------
  const observed =
    agg.count > 0 || latSamples > 0 || malformedCount > 0 ||
    Object.values(hb).some((h) => h.ageMs != null)
  const verdict = !observed ? 'unknown' : suspect.length ? 'suspect' : 'ok'

  return { schemaVersion: QUALITY_SCHEMA_VERSION, verdict, latency, seq, malformed: { count: malformedCount, rate: malformedRate, healthy: malformedOk }, heartbeats: hb, suspect }
}