// =============================================================================
//  TM TRADING — trading session lifecycle, PURE (V3.4 Slice C / §59).
//
//  A session is the durable cross-cutting record of one live-paper or replay
//  run: which strategy version ran, what data it saw, every state change with
//  event time, and the keys of everything it produced (orders/fills/positions/
//  journal). Orders/fills/positions carry `sessionId` (additive, nullable —
//  legacy docs without one behave EXACTLY as before).
//
//  No IO, no clock, no database: the server/executor owns persistence and
//  calls these guards before every write (D25). All time comes from the
//  caller (D2/D16) so tests are deterministic.
// =============================================================================

export const SESSION_KINDS = Object.freeze(['live-paper', 'replay'])

/** Lifecycle states. `queued`/`starting`/`stopping` are transient by design. */
export const SESSION_STATES = Object.freeze([
  'queued',
  'starting',
  'running',
  'paused',
  'stopping',
  'completed',
  'failed',
  'halted',
])

/** Terminal states — a manager must not resume these, only supersede. */
export const SESSION_TERMINAL_STATES = Object.freeze(['completed', 'failed', 'halted'])

/**
 * Legal transitions. Terminal states have no outgoing edges; `completed` is
 * reachable only through `stopping` (orderly shutdown), never straight from
 * `running` — a session that simply stops producing events is `failed`, not
 * complete (D12: no silent success).
 */
export const SESSION_EDGES = Object.freeze({
  queued: ['starting', 'failed'],
  starting: ['running', 'failed'],
  running: ['paused', 'stopping', 'failed', 'halted'],
  paused: ['running', 'stopping', 'failed', 'halted'],
  stopping: ['completed', 'failed'],
  completed: [],
  failed: [],
  halted: [],
})

export const SESSION_SCHEMA_VERSION = 'session.v1'

/** Timeline cap per session — old events drop off the head, counted, never silent. */
export const SESSION_MAX_EVENTS = 200

const fail = (code, message) => ({ ok: false, code, message })

/**
 * Desk-wide halt reasons (D7c / §21). `daily_loss_cap` is NOT one of them: the
 * daily cap is day-scoped and expires at the UTC boundary, while a kill-switch
 * (or drift/manual halt) freezes the whole desk until an operator resumes it.
 */
export const DESK_HALT_REASONS = Object.freeze(['kill_switch', 'drift', 'manual'])

/**
 * Read a risk-day row (§21 shape) and classify the halt. `deskWide` is the only
 * flag a session cares about: it means "no new entries until a human resumes".
 */
export function deskHalt(day = {}) {
  const halted = !!(day && day.halted)
  const reason = String(day?.haltReason || '')
  if (!halted) return { halted: false, reason: null, deskWide: false }
  return { halted: true, reason: reason || 'unknown', deskWide: reason !== 'daily_loss_cap' }
}

/** Unique session id (D3): time-ordered + random suffix, safe as a Mongo _id. */
export function sessionId(now = Date.now()) {
  const t = Number(now)
  if (!Number.isFinite(t) || t <= 0) throw new Error('session: now must be a positive epoch ms')
  return `ses_${t.toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build a new session document (not yet persisted). Throws on bad input —
 * fail closed at creation, same as buildPositionDoc.
 */
export function createSession(input = {}) {
  const {
    sessionId: sid = null,
    kind = 'live-paper',
    strategyVersionId = null,
    botProfileId = null,
    accountId = 'default',
    ownerId = null,
    instruments = [],
    timeframes = [],
    manifest = null,
    restartedFrom = null,
    createdBy = null,
    now = Date.now(),
  } = input ?? {}

  if (!SESSION_KINDS.includes(kind)) throw new Error(`session: kind must be one of ${SESSION_KINDS.join('|')} (got ${String(kind)})`)
  const at = Number(now)
  if (!Number.isFinite(at) || at <= 0) throw new Error('session: now must be a positive epoch ms')
  const id = sid === null || sid === undefined ? sessionId(at) : String(sid)
  if (!id) throw new Error('session: sessionId required')

  return {
    _id: id,
    sessionId: id,
    kind,
    strategyVersionId: strategyVersionId ?? null,
    botProfileId: botProfileId ?? null,
    accountId: String(accountId ?? 'default'),
    // Tenancy (roadmap §61.3): the session belongs to the desk owner.
    ownerId: ownerId == null ? null : String(ownerId),
    instruments: Array.isArray(instruments) ? instruments.map(String) : [],
    timeframes: Array.isArray(timeframes) ? timeframes.map(String) : [],
    state: 'queued',
    startedAt: null,
    stoppedAt: null,
    lastEventAt: at,
    manifest: manifest ?? null,
    timeline: [{ t: at, kind: 'created', message: `session ${kind} created` }],
    timelineDropped: 0,
    counts: { orders: 0, fills: 0, positions: 0 },
    orderKeys: [],
    positionIds: [],
    journalKeys: [],
    restartedFrom: restartedFrom ?? null,
    createdBy: createdBy ?? null,
    schemaVersion: SESSION_SCHEMA_VERSION,
  }
}

/**
 * Guard a state transition. Returns { ok:true, doc } with the new doc
 * (timestamps + timeline entry applied, input untouched) or
 * { ok:false, code, message }. Terminal states never reopen.
 */
export function transition(doc, to, opts = {}) {
  if (!doc || typeof doc !== 'object') return fail('BAD_DOC', 'session: doc required')
  const from = doc.state
  if (!SESSION_STATES.includes(from)) return fail('BAD_STATE', `session: unknown state ${String(from)}`)
  if (!SESSION_STATES.includes(to)) return fail('BAD_TARGET', `session: unknown target ${String(to)}`)
  const allowed = SESSION_EDGES[from] ?? []
  if (!allowed.includes(to)) {
    return fail('ILLEGAL_TRANSITION', `session: ${String(from)} -> ${String(to)} not allowed`)
  }
  const at = opts.at === undefined || opts.at === null ? Date.now() : Number(opts.at)
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'session: at must be a positive epoch ms')

  const next = { ...doc, state: to, lastEventAt: at }
  if (from === 'queued' && to === 'starting') next.startedAt = at
  if (SESSION_TERMINAL_STATES.includes(to)) next.stoppedAt = at
  if (to === 'running' && (from === 'starting' || from === 'paused') && next.startedAt == null) {
    next.startedAt = at
  }
  return { ok: true, doc: appendEvent(next, { t: at, kind: 'state', message: `${String(from)} -> ${String(to)}` }) }
}

/**
 * Append a timeline event (capped at SESSION_MAX_EVENTS; overflow drops the
 * oldest and bumps timelineDropped — counted, never silent).
 */
export function appendEvent(doc, event) {
  if (!doc || typeof doc !== 'object') throw new Error('session: doc required')
  const ev = event && typeof event === 'object' ? event : {}
  const t = Number(ev.t)
  if (!Number.isFinite(t) || t <= 0) throw new Error('session: event.t must be a positive epoch ms')
  const entry = {
    t,
    kind: String(ev.kind ?? 'note'),
    message: String(ev.message ?? ''),
  }
  const timeline = [...(Array.isArray(doc.timeline) ? doc.timeline : []), entry]
  let dropped = Number(doc.timelineDropped) || 0
  while (timeline.length > SESSION_MAX_EVENTS) {
    timeline.shift()
    dropped += 1
  }
  return { ...doc, timeline, timelineDropped: dropped, lastEventAt: t }
}

/** True when no further transitions are legal. */
export function isTerminal(state) {
  return SESSION_TERMINAL_STATES.includes(state)
}

/**
 * Close the split-brain between the Risk Gate and the session record (§59.15
 * Slice F "kill-switch integration"): a desk-wide halt freezes new entries
 * through the gate, but the session document kept saying `running`. This is the
 * state side of the same event, so `/sessions` shows what the desk is doing.
 *
 * Idempotent by refusal: `ALREADY_HALTED` / `ALREADY_TERMINAL` mean the two
 * records already agree, and the caller must not write again (order matters
 * more than repetition here). Transition legality is still `transition`'s call,
 * so `queued`/`stopping` are refused with their own honest code.
 */
export function haltSession(doc, opts = {}) {
  if (!doc || typeof doc !== 'object') return fail('BAD_DOC', 'session: doc required')
  const at = opts.at === undefined || opts.at === null ? Date.now() : Number(opts.at)
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'session: at must be a positive epoch ms')
  const halt = deskHalt({ halted: true, haltReason: opts.reason })
  if (!halt.deskWide) return fail('NOT_A_DESK_HALT', `session: ${String(opts.reason)} is not a desk-wide halt`)
  // Specific before general: `halted` is itself terminal, and a caller logging
  // the refusal is better served by "already halted" than by "terminal".
  if (doc.state === 'halted') return fail('ALREADY_HALTED', 'session: already halted')
  if (isTerminal(doc.state)) return fail('ALREADY_TERMINAL', `session: ${String(doc.state)} cannot be halted`)
  const res = transition(doc, 'halted', { at })
  if (!res.ok) return res
  return {
    ok: true,
    doc: appendEvent(res.doc, {
      t: at,
      kind: 'halt',
      message: `desk halt (${halt.reason}) — new entries frozen by the Risk Gate until an operator resumes`,
    }),
  }
}
