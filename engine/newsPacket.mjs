// engine/newsPacket.mjs
// Bounded news evidence packets for the AI agent runtime (V3.5 §60 Slice E,
// §60.10) — PURE, offline-testable. No parallel agent, no execution path.
//
// buildEvidencePacket: deterministic ranked retrieval ("packet-v1"):
//   required primary-event matches -> entity relevance -> novelty ->
//   recency -> corroboration -> diversity. Same inputs + same clock ->
//   same ordering. Excluded items are counted with reasons (reproducible).
// assertNewsPaperAllowed: the A2 gate — degraded/contradicted/insufficient
//   packets BLOCK news-dependent paper entries (via policy return, expressed
//   through the Risk Gate interfaces by callers, never hidden prompt text).

import { createHash } from 'node:crypto'

export const PACKET_SCHEMA_VERSION = '1'
export const PACKET_BUILDER_VERSION = 'packet-v1'
export const PACKET_DEFAULT_BUDGET = 12

function packetIdFor(parts) {
  return `pkt_${createHash('sha1').update(parts.sort().join('|')).digest('hex').slice(0, 20)}`
}

function packetHash(rows) {
  return createHash('sha1').update(rows.map((r) => `${r.kind}:${r.id}`).join('|')).digest('hex')
}

/**
 * @param {object} o
 * @param {Array} o.events event rows (public shape: id/title/dirs/corroboration/status/entities/firstSeenAt)
 * @param {Array} o.items item rows (public shape: id/title/url/dir/level/tags/sourceId/firstSeenAt/publishedAt)
 * @param {object} o.query { group, symbols[], horizon, lookbackHours, budget }
 * @param {string[]} [o.requiredEventIds] primary-event matches that MUST be included when present
 * @param {number} [o.asOfMs] information-available cutoff (PIT: firstSeenAt <= asOf)
 * @param {object} [o.health] { states: {sourceId: state}, missingProviders: [] }
 */
export function buildEvidencePacket({ events = [], items = [], query = {}, requiredEventIds = [], asOfMs, health = null }) {
  const asOf = Number.isFinite(asOfMs) ? asOfMs : Date.now()
  const budget = Math.max(1, Math.min(50, query.budget || PACKET_DEFAULT_BUDGET))
  const lookbackMs = (query.lookbackHours || 72) * 3600 * 1000
  const symbols = (query.symbols || []).map((s) => String(s).toUpperCase())
  const excluded = { future: 0, stale: 0, retracted: 0, budget: 0 }
  const degradedReasons = []

  const avail = (r) => {
    const t = new Date(r.firstSeenAt || r.publishedAt || 0).getTime()
    return Number.isFinite(t) ? t : 0
  }
  const inWindow = (r) => {
    const t = avail(r)
    if (t > asOf) { excluded.future += 1; return false }
    if (asOf - t > lookbackMs) { excluded.stale += 1; return false }
    return true
  }

  const evRows = []
  for (const e of events || []) {
    if (e.status === 'retracted') { excluded.retracted += 1; continue }
    if (!inWindow(e)) continue
    const entityHit = (e.entities || []).some((en) => symbols.includes(String(en.symbol).toUpperCase()))
    const required = requiredEventIds.includes(e.id)
    const corroborationRank = e.corroboration === 'multi_source' ? 2 : e.corroboration === 'contradicted' ? 0 : 1
    evRows.push({
      kind: 'event', id: e.id, title: e.title, url: null,
      sourceIds: e.sourceIds || [], dirs: e.dirs || [], corroboration: e.corroboration,
      status: e.status || 'active', entities: e.entities || [], availableAt: avail(e),
      rank: [required ? 0 : 1, entityHit ? 0 : 1, e.status === 'corrected' ? 1 : 0, -corroborationRank, -avail(e)],
      relevance: required ? 'required-primary' : entityHit ? 'entity-match' : 'group-context',
    })
  }
  const itRows = []
  for (const i of items || []) {
    if (!inWindow(i)) continue
    const text = `${i.title || ''}`.toUpperCase()
    const entityHit = symbols.some((s) => new RegExp(`\\b${s}\\b`).test(text))
    itRows.push({
      kind: 'item', id: i.id, title: i.title, url: i.url || null,
      sourceIds: i.sourceId ? [i.sourceId] : [], dirs: i.dir ? [i.dir] : [],
      corroboration: 'single_source', level: i.level, tags: i.tags || [], availableAt: avail(i),
      rank: [2, entityHit ? 0 : 1, 0, i.level === 'high' ? -2 : -1, -avail(i)],
      relevance: entityHit ? 'entity-match' : 'group-context',
    })
  }
  const cmp = (a, b) => {
    for (let k = 0; k < a.rank.length; k += 1) {
      if (a.rank[k] !== b.rank[k]) return a.rank[k] - b.rank[k]
    }
    return a.id < b.id ? -1 : 1
  }
  const ordered = [...evRows.sort(cmp), ...itRows.sort(cmp)]
  // Budget fill in rank order; source diversity is reported (sourceRoots) for
  // transparency rather than hard-excluded — in a 3-source pilot, exclusion
  // would starve the packet whenever one provider syndicates aggressively.
  const picked = ordered.slice(0, budget)
  excluded.budget = ordered.length - picked.length
  const sourceRoots = {}
  for (const r of picked) {
    const root = r.sourceIds[0] || 'unknown'
    sourceRoots[root] = (sourceRoots[root] || 0) + 1
  }
  const rows = picked.map(({ rank, ...rest }) => rest)

  const contradictions = evRows.filter((r) => r.corroboration === 'contradicted').length
  if (health) {
    for (const [sid, st] of Object.entries(health.states || {})) {
      if (st === 'down') degradedReasons.push(`source ${sid} down`)
    }
    for (const p of health.missingProviders || []) degradedReasons.push(`missing provider ${p}`)
  }
  if (contradictions > 0) degradedReasons.push(`${contradictions} unresolved contradiction(s)`)
  if (!rows.length) degradedReasons.push('no evidence in window')
  const degraded = degradedReasons.length > 0

  const idParts = [...rows.map((r) => `${r.kind}:${r.id}`), String(asOf), PACKET_BUILDER_VERSION]
  return {
    packetId: packetIdFor(idParts),
    packetHash: packetHash(rows),
    builderVersion: PACKET_BUILDER_VERSION,
    schemaVersion: PACKET_SCHEMA_VERSION,
    query: { group: query.group || 'crypto', symbols, horizon: query.horizon || 'short_term', lookbackHours: query.lookbackHours || 72, budget, asOf: new Date(asOf).toISOString() },
    rows,
    excluded,
    sourceRoots,
    contradictions,
    degraded,
    degradedReasons,
  }
}

/**
 * A2 gate for news-dependent paper entries. Returns { ok, code, message } —
 * callers express blocks through the Risk Gate/session interfaces.
 * §59 Risk Gate + session + idempotency tests passing is a precondition the
 * CALLER asserts (tests/failureModes 22/22); this gate covers the news side.
 */
export function assertNewsPaperAllowed(packet) {
  if (!packet || typeof packet !== 'object') return { ok: false, code: 'NO_PACKET', message: 'no evidence packet' }
  if (!packet.rows || !packet.rows.length) {
    return { ok: false, code: 'PACKET_EMPTY', message: 'insufficient evidence — no news-dependent entry' }
  }
  if ((packet.contradictions || 0) > 0) {
    return { ok: false, code: 'PACKET_CONTRADICTED', message: 'unresolved contradictions require human review' }
  }
  if (packet.degraded) {
    return { ok: false, code: 'PACKET_DEGRADED', message: `packet degraded: ${(packet.degradedReasons || []).join('; ')}` }
  }
  return { ok: true, code: 'OK', message: 'packet satisfies news paper policy' }
}
