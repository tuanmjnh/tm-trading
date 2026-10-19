// engine/outlook.mjs
// Outlook builder (V3.5 §60 Slice D) — PURE, offline-testable, NO model calls.
//
// `rule-v1` synthesizes a MarketOutlookSnapshot from clustered events + items:
// - unsupported groups (anything but the crypto pilot) and thin evidence
//   return `insufficient_evidence` instead of a generic prediction;
// - every supporting/counter item links a NewsItem/MarketEvent id + URL;
// - contradicted events force `mixed` and appear as counter-evidence;
// - NO calibrated probabilities in v1 (qualitative scenarios only, per §60.8);
// - expiry per horizon; evidence hash for reproducibility.

import { createHash } from 'node:crypto'

export const OUTLOOK_SCHEMA_VERSION = '1'
export const OUTLOOK_EXTRACTOR_VERSION = 'rule-v1'
export const OUTLOOK_PILOT_GROUPS = Object.freeze(['crypto'])
/** Minimum evidence rows (items + events) for a directional view. */
export const OUTLOOK_MIN_EVIDENCE = 3

export const OUTLOOK_HORIZONS = Object.freeze({
  short_term: { days: 7, label: 'Short term (1–7d)' },
  swing: { days: 28, label: 'Swing (1–4w)' },
  long_term: { days: 180, label: 'Long term (1–6m)' },
})

function evidenceHash(ids) {
  return createHash('sha1').update([...ids].sort().join('|')).digest('hex')
}

/**
 * Build one horizon snapshot. `events`/`items` are plain objects in the
 * public projection shape (ids, dirs, corroboration, urls).
 * @param {{ group: string, horizon: string, events?: any[], items?: any[], nowMs?: number }} args
 */
export function buildOutlook({ group, horizon, events = [], items = [], nowMs }) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const spec = OUTLOOK_HORIZONS[horizon]
  if (!spec) return null
  const generatedAt = new Date(now)
  const expiresAt = new Date(now + spec.days * 86400 * 1000)
  const base = {
    _id: `outlook_${group}_${horizon}_${generatedAt.toISOString().slice(0, 10)}`,
    marketGroup: group,
    horizon,
    horizonDays: spec.days,
    extractorModelVersion: OUTLOOK_EXTRACTOR_VERSION,
    schemaVersion: OUTLOOK_SCHEMA_VERSION,
    generatedAt,
    expiresAt,
    evidenceHash: '',
    state: 'insufficient_evidence',
    supporting: [],
    counterEvidence: [],
    contradictionCount: 0,
    multiSourceCount: 0,
    singleSourceCount: 0,
    limitations: [
      'rule-v1 deterministic synthesis — no model forecasts',
      'crypto pilot only; no price validation yet (scorecard lands in Slice E)',
    ],
    invalidation: 'A retraction of key corroborated events, or price action diverging from the stated drivers, invalidates this view.',
  }
  if (!OUTLOOK_PILOT_GROUPS.includes(group)) {
    return { ...base, limitations: [...base.limitations, `group '${group}' is outside the pilot — no directional view`] }
  }
  const evList = events || []
  const itList = items || []
  if (evList.length + itList.length < OUTLOOK_MIN_EVIDENCE) return base
  const contradicted = evList.filter((e) => e.corroboration === 'contradicted' || e.status === 'contradicted')
  const multi = evList.filter((e) => e.corroboration === 'multi_source').length
  const single = evList.filter((e) => e.corroboration === 'single_source').length
  // Direction vote: event dirs (weight 2 when multi-source) + item dirs.
  const votes = { pos: 0, neg: 0 }
  for (const e of evList) {
    const w = e.corroboration === 'multi_source' ? 2 : 1
    for (const d of e.dirs || []) if (votes[d] !== undefined) votes[d] += w
  }
  for (const i of itList) if (votes[i.dir] !== undefined) votes[i.dir] += 1
  let state = 'neutral'
  if (contradicted.length > 0) state = 'mixed'
  else if (votes.pos > votes.neg * 1.5) state = 'bullish'
  else if (votes.neg > votes.pos * 1.5) state = 'bearish'
  const rank = (list) =>
    [...list]
      .sort((a, b) => {
        const score = (x) => (x.corroboration === 'multi_source' ? 2 : x.level === 'high' ? 1.5 : 1)
        return score(b) - score(a)
      })
      .slice(0, 5)
  const supporting = rank(evList.filter((e) => !contradicted.includes(e))).map((e) => ({
    kind: 'event',
    id: e.id,
    title: e.title,
    url: null,
    corroboration: e.corroboration,
  }))
  for (const i of rank(itList).slice(0, Math.max(0, 5 - supporting.length))) {
    supporting.push({ kind: 'item', id: i.id, title: i.title, url: i.url || null, corroboration: 'single_source' })
  }
  const counterEvidence = [
    ...contradicted.slice(0, 3).map((e) => ({ kind: 'event', id: e.id, title: e.title, note: 'direction conflict across sources' })),
    ...itList
      .filter((i) => (state === 'bullish' && i.dir === 'neg') || (state === 'bearish' && i.dir === 'pos'))
      .slice(0, 2)
      .map((i) => ({ kind: 'item', id: i.id, title: i.title, url: i.url || null, note: 'opposing direction' })),
  ].slice(0, 5)
  return {
    ...base,
    state,
    supporting,
    counterEvidence,
    contradictionCount: contradicted.length,
    multiSourceCount: multi,
    singleSourceCount: single,
    evidenceHash: evidenceHash([...evList.map((e) => e.id), ...itList.map((i) => i.id)]),
  }
}
