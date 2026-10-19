// engine/newsScorecard.mjs
// News-impact scorecard (V3.5 §60 Slice E) — PURE evaluation math.
//
// Scores EXPIRED outlook snapshots against subsequent price action:
// state bullish/bearish vs the sign of the symbol return over the snapshot's
// horizon window. neutral/mixed/insufficient_evidence snapshots are EXCLUDED
// (counted, never scored — scoring them would invent precision). Baseline is
// persistence (prior equal-length window return sign): the scorecard reports
// news-feature value AGAINST baseline, not in a vacuum. PIT-safe: prices are
// read strictly after generatedAt; inputs arrive pre-fetched so this module
// never touches the network.

import { createHash } from 'node:crypto'

export const SCORECARD_SCHEMA_VERSION = '1'

/** Sign of a return; 0/NaN -> 'flat' (unscorable, excluded). */
export function returnSign(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return 'flat'
  const r = (end - start) / start
  if (!Number.isFinite(r) || r === 0) return 'flat'
  return r > 0 ? 'pos' : 'neg'
}

/**
 * Score one (snapshot, symbol) pair.
 * prices: { atStart, atEnd, atPrior } closes (atPrior = start of the
 * previous equal-length window, for the persistence baseline).
 * @param {{ _id?: string, state?: string }} snapshot
 * @param {string} symbol
 * @param {{ atStart: number|null, atEnd: number|null, atPrior: number|null }} prices
 */
export function scoreOutlookSnapshot(snapshot, symbol, prices) {
  const state = snapshot.state
  if (state !== 'bullish' && state !== 'bearish') {
    return { scored: false, reason: `state '${state}' is not directional` }
  }
  const actual = returnSign(prices.atStart, prices.atEnd)
  if (actual === 'flat') return { scored: false, reason: 'zero/unknown subsequent return' }
  const expected = state === 'bullish' ? 'pos' : 'neg'
  const hit = actual === expected
  const baselineSign = returnSign(prices.atPrior, prices.atStart)
  const baseline = baselineSign === 'flat' ? null : baselineSign === expected
  return {
    scored: true,
    snapshotId: snapshot._id,
    symbol,
    state,
    actual,
    hit,
    baseline,
    beatBaseline: baseline === null ? null : hit && !baseline,
  }
}

/** Aggregate scored rows into a scorecard doc (deterministic id).
 * @param {{ group?: string, horizon?: string, symbols?: string[], rows?: any[], asOfMs?: number, createdBy?: string|null }} o
 */
export function buildScorecard({ group, horizon, symbols = [], rows = [], asOfMs, createdBy = null }) {
  const asOf = Number.isFinite(asOfMs) ? asOfMs : Date.now()
  const scored = rows.filter((r) => r.scored)
  const hits = scored.filter((r) => r.hit).length
  const withBaseline = scored.filter((r) => r.baseline !== null)
  const baselineHits = withBaseline.filter((r) => r.baseline).length
  const idBody = [group, horizon, [...symbols].sort().join(','), String(asOf), String(scored.length)].join('|')
  return {
    _id: `nsc_${createHash('sha1').update(idBody).digest('hex').slice(0, 20)}`,
    group: group || 'crypto',
    horizon: horizon || 'short_term',
    symbols: [...symbols],
    asOf: new Date(asOf),
    snapshots: scored.length,
    excluded: rows.length - scored.length,
    hits,
    hitRate: scored.length ? hits / scored.length : null,
    baselineSnapshots: withBaseline.length,
    baselineHits,
    baselineHitRate: withBaseline.length ? baselineHits / withBaseline.length : null,
    rows: scored,
    limitations: [
      'direction-only (sign of horizon return); magnitude ignored',
      'crypto pilot majors only; no transaction costs; correlation is not causation',
    ],
    schemaVersion: SCORECARD_SCHEMA_VERSION,
    createdBy,
  }
}
