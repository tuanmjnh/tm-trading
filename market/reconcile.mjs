// market/reconcile.mjs
// Roadmap §24.2 Candle reconciliation: periodically compare locally-recorded
// closed bars against venue REST bars.
//
// PURE core (no Mongo, no network):
//   - `compareBars(local, venue, { priceTolPct, volumeTolPct })`
//   - `reconcileCandles({ localBars, venueBars, ... })`
//   - `repairPatches(mismatches, missingLocal)`
//
// Honesty (D12):
//   - zero-local vs zero-venue -> 'unknown' (nothing compared),
//   - missing rows flag 'gap', price/volume deviation flags 'suspect',
//   - tolerances are relative (`|local - venue| / venue <= tol`), never absolute,
//   - repair patches preserve exact venue numbers (never interpolated/averaged).

/** Version stamp (D1). */
export const RECONCILE_SCHEMA_VERSION = 'reconcile.v1'

/** §24.2 default thresholds. */
export const DEFAULT_RECONCILE_OPTS = Object.freeze({
  priceTolPct: 0.0005,  // 0.05% price deviation allowed (rounding/dust)
  volumeTolPct: 0.01,   // 1% volume deviation allowed
})

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const pctDiff = (a, b) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / Math.abs(b))

/**
 * Compare one local bar against its matching venue bar.
 *
 * @param {object} local {open, high, low, close, volume, openTime}
 * @param {object} venue {open, high, low, close, volume, openTime}
 * @returns {{ok:boolean, diffs:object}} diffs lists any field that exceeded tolerance
 */
export function compareBars(local, venue, { priceTolPct = DEFAULT_RECONCILE_OPTS.priceTolPct, volumeTolPct = DEFAULT_RECONCILE_OPTS.volumeTolPct } = {}) {
  const diffs = {}
  for (const f of ['open', 'high', 'low', 'close']) {
    const l = num(local?.[f])
    const v = num(venue?.[f])
    if (l == null || v == null) { diffs[f] = { local: l, venue: v, diffPct: null }; continue }
    const d = pctDiff(l, v)
    if (d > priceTolPct) diffs[f] = { local: l, venue: v, diffPct: d }
  }
  const lv = num(local?.volume)
  const vv = num(venue?.volume)
  if (lv == null || vv == null) {
    diffs.volume = { local: lv, venue: vv, diffPct: null }
  } else {
    const vd = pctDiff(lv, vv)
    if (vd > volumeTolPct) diffs.volume = { local: lv, venue: vv, diffPct: vd }
  }
  return { ok: Object.keys(diffs).length === 0, diffs }
}

/**
 * Reconcile a list of local bars against venue REST bars for the SAME range.
 * Both inputs are arrays of `{openTime, open, high, low, close, volume}`.
 *
 * @returns {{
 *   schemaVersion: string,
 *   checked: number,
 *   matched: number,
 *   mismatches: Array<{openTime:number, diffs:object}>,
 *   missingLocal: Array<object>,  // present on venue, missing locally (gap)
 *   missingVenue: Array<object>,  // present locally, venue has no bar
 *   verdict: 'ok'|'suspect'|'gap'|'unknown',
 * }}
 */
export function reconcileCandles({
  localBars = [],
  venueBars = [],
  priceTolPct = DEFAULT_RECONCILE_OPTS.priceTolPct,
  volumeTolPct = DEFAULT_RECONCILE_OPTS.volumeTolPct,
} = {}) {
  const localMap = new Map()
  for (const b of localBars) if (num(b?.openTime) != null) localMap.set(Number(b.openTime), b)

  const venueMap = new Map()
  for (const b of venueBars) if (num(b?.openTime) != null) venueMap.set(Number(b.openTime), b)

  if (localMap.size === 0 && venueMap.size === 0) {
    return {
      schemaVersion: RECONCILE_SCHEMA_VERSION,
      checked: 0,
      matched: 0,
      mismatches: [],
      missingLocal: [],
      missingVenue: [],
      verdict: 'unknown',
    }
  }

  let checked = 0
  let matched = 0
  const mismatches = []
  const missingLocal = []
  const missingVenue = []

  // Check venue bars against local (venue is the ground truth)
  for (const [ot, vb] of venueMap) {
    checked++
    const lb = localMap.get(ot)
    if (!lb) { missingLocal.push(vb); continue }
    const res = compareBars(lb, vb, { priceTolPct, volumeTolPct })
    if (res.ok) matched++
    else mismatches.push({ openTime: ot, diffs: res.diffs, venue: vb, local: lb })
  }

  // Any bars we recorded that the venue doesn't know about?
  for (const [ot, lb] of localMap) {
    if (!venueMap.has(ot)) missingVenue.push(lb)
  }

  const verdict =
    mismatches.length > 0 ? 'suspect' :
    (missingLocal.length > 0 || missingVenue.length > 0) ? 'gap' :
    'ok'

  return {
    schemaVersion: RECONCILE_SCHEMA_VERSION,
    checked,
    matched,
    mismatches,
    missingLocal,
    missingVenue,
    verdict,
  }
}

/**
 * Generate Mongoose-compatible repair patches from reconciliation results.
 * Pure — caller decides whether and when to execute them (e.g. dry-run first).
 *
 * @param {{mismatches:Array, missingLocal:Array}} result
 * @param {{source:string, timeframe:string, symbol:string, market?:string}} meta
 * @returns {Array<{filter:object, update:object, upsert:boolean}>}
 */
export function buildRepairPatches({ mismatches = [], missingLocal = [] } = {}, { source, timeframe, symbol, market = null } = {}) {
  const patches = []
  // Mismatches -> update existing row with venue numbers
  for (const m of mismatches) {
    const v = m.venue
    const id = `${symbol}:${timeframe}:${m.openTime}`
    patches.push({
      filter: { _id: id },
      update: {
        $set: {
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: Number(v.volume),
          repairedAt: new Date(),
        },
      },
      upsert: false,
    })
  }
  // Missing local -> insert missing bar from venue
  for (const v of missingLocal) {
    const ot = Number(v.openTime)
    const ct = Number(v.closeTime ?? (ot + 60_000 - 1))
    const id = `${symbol}:${timeframe}:${ot}`
    patches.push({
      filter: { _id: id },
      update: {
        $setOnInsert: {
          _id: id,
          symbol,
          timeframe,
          market,
          source,
          state: 'closed',
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: Number(v.volume ?? 0),
          openTime: ot,
          closeTime: ct,
          repairedAt: new Date(),
        },
      },
      upsert: true,
    })
  }
  return patches
}