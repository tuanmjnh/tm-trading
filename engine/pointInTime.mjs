// engine/pointInTime.mjs
// STRICT point-in-time control for evidence (roadmap Phase F).
//
// A document can list timestamps and still leak the future: a trade stamped
// after the freeze, a journal row written after the session stopped, a news
// packet published after the decision it justifies. This module does not try to
// prove a producer's clock was honest — it proves that every persisted record
// falls inside the cut-off the evidence claims, and says exactly which records
// do not. Violations are reported, never silently dropped.
//
// Pure: no IO, no clock. UTC epoch ms everywhere (D2).

export const PIT_SCHEMA_VERSION = 'pit.v1'

/** Policy switch: frozen evidence is audited strictly by default. */
export const PIT_STRICT_DEFAULT = true

export const PIT_VIOLATION_CODES = Object.freeze([
  'NO_CUTOFF',
  'SOURCE_NOT_SEALED',
  'ENTRY_AFTER_CUTOFF',
  'EXIT_AFTER_CUTOFF',
  'JOURNAL_ENTRY_AFTER_CUTOFF',
  'JOURNAL_EXIT_AFTER_CUTOFF',
  'NEWS_NO_ASOF',
  'NEWS_AFTER_CUTOFF',
])

const num = (v) => {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const idOf = (row, ...fields) => {
  for (const f of fields) {
    const v = row?.[f]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v)
  }
  return null
}

/**
 * Audit the timestamps of an evidence graph against its cut-off.
 *
 * @param {object} o
 * @param {object|null} [o.bundle] evidence bundle (trades + pointInTime + sealed)
 * @param {object[]} [o.journal] journal rows
 * @param {object[]} [o.news] news evidence sets
 * @param {number|null} [o.asOf] explicit cut-off (defaults to bundle frozenAt)
 * @param {boolean} [o.strict] report policy (default true for frozen sets)
 * @returns {object}
 */
export function pitAudit({ bundle = null, journal = [], news = [], asOf = null, strict = PIT_STRICT_DEFAULT } = {}) {
  const frozenAt = num(bundle?.pointInTime?.frozenAt)
  const cutoff = num(asOf) ?? frozenAt
  const violations = []
  const add = (code, recordId, ts, limit) => violations.push({ code, recordId: recordId ?? null, ts: ts ?? null, limit: limit ?? cutoff ?? null })
  let maxRecordTs = null
  const see = (ts) => { if (ts !== null && (maxRecordTs === null || ts > maxRecordTs)) maxRecordTs = ts }

  if (cutoff === null) add('NO_CUTOFF', null, null, null)

  const trades = Array.isArray(bundle?.trades) ? bundle.trades : []
  // A set whose source is still running cannot have a point-in-time verdict.
  if (bundle && bundle.sealed === false) add('SOURCE_NOT_SEALED', bundle?.sessionId ?? bundle?.setId ?? null, null, cutoff)

  for (const t of trades) {
    const entry = num(t?.entryTime)
    const exit = num(t?.exitTime)
    see(entry)
    see(exit)
    if (cutoff !== null && entry !== null && entry > cutoff) add('ENTRY_AFTER_CUTOFF', t?.key ?? null, entry, cutoff)
    if (cutoff !== null && exit !== null && exit > cutoff) add('EXIT_AFTER_CUTOFF', t?.key ?? null, exit, cutoff)
  }

  for (const j of journal) {
    const entry = num(j?.entryTime)
    const exit = num(j?.exitTime)
    see(entry)
    see(exit)
    if (cutoff !== null && entry !== null && entry > cutoff) add('JOURNAL_ENTRY_AFTER_CUTOFF', idOf(j, 'key', 'journalKey'), entry, cutoff)
    if (cutoff !== null && exit !== null && exit > cutoff) add('JOURNAL_EXIT_AFTER_CUTOFF', idOf(j, 'key', 'journalKey'), exit, cutoff)
  }

  for (const n of news) {
    const ts = num(n?.asOf)
    see(ts)
    if (ts === null) add('NEWS_NO_ASOF', idOf(n, 'setId', '_id'), null, cutoff)
    else if (cutoff !== null && ts > cutoff) add('NEWS_AFTER_CUTOFF', idOf(n, 'setId', '_id'), ts, cutoff)
  }

  const ok = violations.length === 0
  return {
    schema: PIT_SCHEMA_VERSION,
    strict: strict !== false,
    blocking: strict !== false && !ok,
    ok,
    cutoff,
    frozenAt,
    maxRecordTs,
    counts: { trades: trades.length, journal: Array.isArray(journal) ? journal.length : 0, news: Array.isArray(news) ? news.length : 0 },
    violations,
  }
}

/** One-line verdict for a limitations list (null when clean). */
export function pitLimitation(audit) {
  if (!audit || audit.ok) return null
  const codes = [...new Set((audit.violations ?? []).map((v) => v.code))]
  return `point-in-time: ${codes.join(', ')} (${audit.violations.length} record(s) outside the cut-off)`
}
