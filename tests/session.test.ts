import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_EDGES,
  SESSION_STATES,
  SESSION_TERMINAL_STATES,
  appendEvent,
  createSession,
  isTerminal,
  sessionId,
  transition
} from '../engine/session.mjs'
import { SessionError, sessionsHttpError } from '../server/utils/sessions'

// =============================================================================
//  Trading session lifecycle (V3.4 Slice C / §59) — pure guards.
//
//  State machine, id format, timeline cap and terminal rules. Persistence
//  lives in engine/models/session.mjs + the server layer; this suite locks
//  the rules the writers must obey (D25).
// =============================================================================

const T0 = 1_790_000_000_000

describe('sessionId — unique, time-ordered identities (D3)', () => {
  test('shape carries epoch base36 + random suffix', () => {
    const id = sessionId(T0)
    assert.ok(id.startsWith('ses_'))
    assert.ok(id.includes(T0.toString(36)))
    assert.notEqual(sessionId(T0), sessionId(T0))
  })

  test('rejects non-positive time', () => {
    assert.throws(() => sessionId(0), /positive epoch/)
    assert.throws(() => sessionId(Number.NaN), /positive epoch/)
  })
})

describe('createSession — fail-closed construction', () => {
  test('defaults to a queued live-paper session with a created event', () => {
    const doc = createSession({ now: T0 })
    assert.equal(doc.state, 'queued')
    assert.equal(doc.kind, 'live-paper')
    assert.equal(doc._id, doc.sessionId)
    assert.equal(doc.schemaVersion, 'session.v1')
    assert.deepEqual(doc.timeline, [{ t: T0, kind: 'created', message: 'session live-paper created' }])
    assert.equal(doc.lastEventAt, T0)
    assert.equal(doc.timelineDropped, 0)
  })

  test('rejects unknown kinds and bad clocks', () => {
    assert.throws(() => createSession({ kind: 'yolo', now: T0 }), /kind must be/)
    assert.throws(() => createSession({ now: -1 }), /positive epoch/)
  })
})

describe('transition — legal edges only, terminal never reopens', () => {
  const started = (state: string) => ({ ...createSession({ now: T0 }), state, startedAt: T0 })

  test('happy path queued -> starting -> running -> pausing -> running -> stopping -> completed', () => {
    let doc = createSession({ now: T0 })
    for (const [from, to] of [['queued', 'starting'], ['starting', 'running'], ['running', 'paused'], ['paused', 'running'], ['running', 'stopping'], ['stopping', 'completed']] as const) {
      assert.equal(doc.state, from)
      const res = transition(doc, to, { at: T0 + 1 })
      assert.equal(res.ok, true, `${from} -> ${to}`)
      if (res.ok) doc = res.doc
    }
    assert.equal(doc.state, 'completed')
    assert.equal(doc.stoppedAt, T0 + 1)
    assert.equal(doc.timeline.length, 7) // created + 6 transitions
  })

  test('completed is unreachable straight from running (no silent success)', () => {
    const res = transition(started('running'), 'completed', { at: T0 + 1 })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'ILLEGAL_TRANSITION')
  })

  test('terminal states never reopen', () => {
    for (const s of SESSION_TERMINAL_STATES) {
      for (const t of SESSION_STATES) {
        const res = transition(started(s), t, { at: T0 + 1 })
        assert.equal(res.ok, false, `${s} -> ${t}`)
      }
    }
  })

  test('halt can strike running or paused, never queued', () => {
    assert.equal(transition(started('running'), 'halted', { at: T0 + 1 }).ok, true)
    assert.equal(transition(started('paused'), 'halted', { at: T0 + 1 }).ok, true)
    assert.equal(transition(started('queued'), 'halted', { at: T0 + 1 }).ok, false)
  })

  test('starting stamps startedAt; input doc untouched (pure)', () => {
    const before = createSession({ now: T0 })
    const res = transition(before, 'starting', { at: T0 + 5 })
    assert.equal(before.state, 'queued')
    assert.equal(before.timeline.length, 1)
    if (res.ok) {
      assert.equal(res.doc.startedAt, T0 + 5)
      assert.equal(res.doc.lastEventAt, T0 + 5)
    } else assert.fail('should transition')
  })

  test('bad docs, states and clocks fail closed', () => {
    assert.equal(transition(null, 'running').ok, false)
    assert.equal(transition({ state: 'nope' }, 'running').ok, false)
    assert.equal(transition(started('running'), 'nope').ok, false)
    assert.equal(transition(started('running'), 'paused', { at: -1 }).ok, false)
  })
})

describe('appendEvent — capped timeline, counted overflow', () => {
  test('caps at SESSION_MAX_EVENTS and counts drops', () => {
    let doc = createSession({ now: T0 })
    for (let i = 0; i < 250; i++) {
      doc = appendEvent(doc, { t: T0 + i + 1, kind: 'tick', message: `e${i}` })
    }
    assert.equal(doc.timeline.length, 200)
    assert.equal(doc.timelineDropped, 51) // 1 created + 250 - 200
    assert.equal(doc.timeline[199]?.message, 'e249')
    assert.equal(doc.lastEventAt, T0 + 250)
  })

  test('rejects timeless events', () => {
    const doc = createSession({ now: T0 })
    assert.throws(() => appendEvent(doc, { kind: 'x' }), /event\.t must be/)
    assert.throws(() => appendEvent(null, { t: 1 }), /doc required/)
  })
})

describe('sessionsHttpError — HTTP mapping (endpoints only map, never decide)', () => {
  test('SessionError keeps its codes', () => {
    const err = sessionsHttpError(new SessionError('nope', 404, 'session_not_found')) as {
      statusCode: number
      statusMessage: string
    }
    assert.equal(err.statusCode, 404)
    assert.equal(err.statusMessage, 'session_not_found')
  })

  test('h3-style errors pass through', () => {
    const err = sessionsHttpError({ statusCode: 409, statusMessage: 'x', message: 'y' }) as {
      statusCode: number
    }
    assert.equal(err.statusCode, 409)
  })

  test('unknown failures become 500s, never throws', () => {
    const err = sessionsHttpError(new Error('boom')) as { statusCode: number; statusMessage: string }
    assert.equal(err.statusCode, 500)
    assert.equal(err.statusMessage, 'session_failed')
  })
})

describe('isTerminal + edge table sanity', () => {
  test('terminal set matches edgeless states', () => {
    for (const s of SESSION_STATES) {
      assert.equal(isTerminal(s), SESSION_TERMINAL_STATES.includes(s))
      assert.equal((SESSION_EDGES[s as keyof typeof SESSION_EDGES] ?? []).length === 0, isTerminal(s))
    }
  })
})
