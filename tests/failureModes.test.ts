import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeedHealth, candleGapUnresolved, FEED_STATES } from '../exec/feedHealth.mjs'
import { qualityGates } from '../exec/qualityGates.mjs'
import { resolvePaperSession } from '../exec/paper.mjs'
import { evaluate, resolveDay, RISK_DEFAULTS, halt, haltOpenSessions } from '../exec/risk.mjs'
import { deskHalt, haltSession, transition } from '../engine/session.mjs'
import { clientOrderId } from '../engine/keys.mjs'
import { beat, checkOverdue, evaluateHeartbeat, readHeartbeat } from '../services/heartbeat.mjs'

// =============================================================================
//  Slice F acceptance (V3.5 §59.15) — simulated failure tests:
//  disconnection · stale feed · restart · duplicate command · Risk Gate
//  denial · kill-switch. Everything runs offline: injected clocks, fake
//  models, temp heartbeat files. No Mongo, no network.
// =============================================================================

const T0 = 1_790_000_000_000

// ---------------------------------------------------------------------------
//  1. DISCONNECTION — a dead feed becomes a BLOCKING connection STATE (D33).
// ---------------------------------------------------------------------------

describe('Slice F: simulated disconnection', () => {
  test('consecutive failed fetches -> disconnected, and the gate blocks the entry', () => {
    const fh = createFeedHealth({ staleAfterMs: 90_000, failThreshold: 3 })
    fh.record('s', { ok: true, dataAt: T0, at: T0 })
    fh.record('s', { ok: false, at: T0 + 1000 })
    fh.record('s', { ok: false, at: T0 + 2000 })
    assert.equal(fh.state('s', { at: T0 + 2000 }).state, 'stale') // degraded honesty: 1-2 failures = stale, not yet down

    fh.record('s', { ok: false, at: T0 + 3000 })
    const down = fh.state('s', { at: T0 + 3000 })
    assert.equal(down.state, 'disconnected')
    assert.match(down.reasons.join(), /consecutive failed fetches/)

    // The gate turns that state into a hard block on new entries (§35.1).
    const q = qualityGates({
      streamState: down.state,
      quoteAgeMs: 3000,
      candleGapUnresolved: false,
      instrumentState: 'active',
      riskStateAvailable: true,
    })
    assert.equal(q.allowed, false)
    assert.ok(q.block.includes('market_stream_disconnected'))
  })

  test('a stream nobody has observed is unknown -> blocked (fail-closed, never green)', () => {
    const fh = createFeedHealth({})
    const s = fh.state('never-fetched')
    assert.equal(s.state, 'unknown')
    assert.equal(qualityGates({ streamState: s.state, instrumentState: 'active', riskStateAvailable: true }).allowed, false)
    assert.deepEqual(FEED_STATES, ['ok', 'degraded', 'stale', 'disconnected', 'unknown'])
  })

  test('a successful fetch after failures recovers to ok (no sticky outage)', () => {
    const fh = createFeedHealth({ failThreshold: 2 })
    fh.record('s', { ok: false, at: T0 })
    fh.record('s', { ok: false, at: T0 + 1 })
    assert.equal(fh.state('s', { at: T0 + 1 }).state, 'disconnected')
    fh.record('s', { ok: true, dataAt: T0 + 2000, at: T0 + 2000 })
    assert.equal(fh.state('s', { at: T0 + 2000 }).state, 'ok')
  })

  test('paper executor records a FAILED fetch as an observed fact (source guard)', () => {
    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.match(src, /feedHealth\.record\(feedStreamOf\(cfg\.market, symbol\), \{ ok: false/, 'quoteFor must count fetch failures toward the stream state')
  })
})

// ---------------------------------------------------------------------------
//  2. STALE FEED — old data, skipped bars and the measured quote age (§35.1).
// ---------------------------------------------------------------------------

describe('Slice F: simulated stale feed', () => {
  test('an endpoint answering with old data is NOT healthy: state -> stale', () => {
    const fh = createFeedHealth({ staleAfterMs: 90_000 })
    // Transport answered (ok: true) but the newest bar it served is 10 min old.
    const r = fh.record('s', { ok: true, dataAt: T0, at: T0 + 600_000 })
    assert.equal(r.ok, false, 'stale data must not count as a healthy fetch')
    assert.equal(fh.state('s', { at: T0 + 600_000 }).state, 'stale')
  })

  test('measured bar age over the policy threshold -> quote_stale block', () => {
    const q = qualityGates({
      streamState: 'ok',
      quoteAgeMs: 10 * 60_000, // newest bar is 10 minutes old
      candleGapUnresolved: false,
      instrumentState: 'active',
      riskStateAvailable: true,
      thresholds: { quoteStaleMs: 90_000 }, // PAPER_QUOTE_STALE_MS policy
    })
    assert.equal(q.allowed, false)
    assert.ok(q.block.includes('quote_stale'))
  })

  test('a skipped 1m bar is an unresolved gap -> candle_gap_unresolved block', () => {
    assert.equal(candleGapUnresolved([T0, T0 + 60_000], 60_000), false) // contiguous
    assert.equal(candleGapUnresolved([T0, T0 + 120_000], 60_000), true) // one bar skipped
    assert.equal(candleGapUnresolved([T0], 60_000), null) // one sample: no claim (D12)
    assert.equal(candleGapUnresolved([], 60_000), null)

    const q = qualityGates({
      streamState: 'ok',
      quoteAgeMs: 5_000,
      candleGapUnresolved: candleGapUnresolved([T0, T0 + 180_000], 60_000),
      instrumentState: 'active',
      riskStateAvailable: true,
    })
    assert.equal(q.allowed, false)
    assert.ok(q.block.includes('candle_gap_unresolved'))
  })

  test('paper gate is fed MEASURED facts, not the old hardcoded ok/false (source guard)', () => {
    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.ok(!/streamState:\s*'ok'/.test(src), 'streamState must no longer be hardcoded ok')
    assert.ok(!/candleGapUnresolved:\s*false/.test(src), 'candleGapUnresolved must no longer be hardcoded false')
    assert.match(src, /streamState:\s*feed\.state/, 'gate must receive the measured D33 state')
    assert.match(src, /quoteAgeMs:\s*barTime != null \? nowMs - barTime : null/, 'quote age must be measured from the DATA timestamp')
    assert.match(src, /thresholds:\s*\{\s*quoteStaleMs:\s*cfg\.quoteStaleMs\s*\}/, 'stale policy must be configurable (PAPER_QUOTE_STALE_MS)')
  })
})

// ---------------------------------------------------------------------------
//  3. RESTART — recovery supersedes stale sessions, never duplicates (Slice C
//     acceptance surfaced here as the restart failure mode of §59.15 F).
// ---------------------------------------------------------------------------

type Row = Record<string, any>

/** Minimal in-memory TradingSession model: the query shapes paper uses. */
function fakeSessionModel(rows: Row[]) {
  const matches = (r: Row, q: Row): boolean =>
    Object.entries(q).every(([k, v]: [string, any]) => {
      if (k === '$or' && Array.isArray(v)) return v.some((sub: Row) => matches(r, sub))
      if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(r[k])
      return r[k] === v
    })
  const created: Row[] = []
  const model = {
    find: (q: Row) => ({ lean: async () => rows.filter((r) => matches(r, q)) }),
    findOne: (q: Row) => ({ lean: async () => rows.find((r) => matches(r, q)) ?? null }),
    create: async (doc: Row) => { created.push(doc); rows.push(doc); return doc },
    updateOne: async (q: Row, upd: Row) => {
      const r = rows.find((x) => matches(x, q))
      if (r && upd?.$set) Object.assign(r, upd.$set)
      return { acknowledged: true }
    },
  }
  return { model, created }
}

const runningSession = (id: string, over: Row = {}): Row => ({
  _id: id, sessionId: id, kind: 'live-paper', accountId: 'default',
  // Tenancy (roadmap §61.3): legacy sessions carry a null owner.
  ownerId: null,
  state: 'running', timeline: [], timelineDropped: 0,
  counts: { orders: 0, fills: 0, positions: 0 }, ...over,
})

const savedEnv: Record<string, string | undefined> = {}
before(() => {
  for (const k of ['PAPER_SESSION', 'PAPER_SESSION_ID']) { savedEnv[k] = process.env[k]; delete process.env[k] }
})
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

describe('Slice F: simulated restart recovery', () => {
  test('watch boot supersedes stale actives: exactly one new session, old ones fail explicitly', async () => {
    const rows = [runningSession('ses_stale_1'), runningSession('ses_stale_2')]
    const { model, created } = fakeSessionModel(rows)
    const sid = await resolvePaperSession({ TradingSession: model } as never, { account: 'default' }, { watch: true })

    assert.ok(sid && sid.startsWith('ses_'), 'a fresh session must be started')
    assert.equal(created.length, 1, 'restart must create exactly ONE session (no duplicates)')
    assert.equal(sid, created[0].sessionId)

    for (const id of ['ses_stale_1', 'ses_stale_2']) {
      const row = rows.find((r) => r.sessionId === id)!
      assert.equal(row.state, 'failed', `${id} must be failed, not silently adopted`)
      const ev = (row.timeline as Row[]).find((e) => e.kind === 'superseded')
      assert.ok(ev && String(ev.message).includes(sid!), `${id} timeline must name its successor`)
    }
    // The fresh session got its own 'started' event — the restart is auditable.
    const fresh = rows.find((r) => r.sessionId === sid)!
    assert.ok((fresh.timeline as Row[]).some((e) => e.kind === 'started'))
  })

  test('a second boot supersedes the first — never two live sessions for one account', async () => {
    const rows: Row[] = [runningSession('ses_first')]
    const { model } = fakeSessionModel(rows)
    const m = { TradingSession: model } as never
    const first = await resolvePaperSession(m, { account: 'default' }, { watch: true })
    const second = await resolvePaperSession(m, { account: 'default' }, { watch: true })
    assert.notEqual(first, second)
    assert.equal(rows.filter((r) => ['queued', 'starting', 'running', 'paused', 'stopping'].includes(r.state)).length, 1)
    assert.equal(rows.find((r) => r.sessionId === first)!.state, 'failed')
  })

  test('explicit --session joins a live session and attaches; a terminal one stays sessionless', async () => {
    const rows = [runningSession('ses_live'), runningSession('ses_done', { state: 'completed' })]
    const { model } = fakeSessionModel(rows)
    const m = { TradingSession: model } as never

    const joined = await resolvePaperSession(m, { account: 'default' }, { sessionId: 'ses_live' })
    assert.equal(joined, 'ses_live')
    assert.ok((rows[0].timeline as Row[]).some((e) => e.kind === 'attached'))

    const terminal = await resolvePaperSession(m, { account: 'default' }, { sessionId: 'ses_done' })
    assert.equal(terminal, null, 'terminal sessions never reopen (D12) — run sessionless instead')

    const missing = await resolvePaperSession(m, { account: 'default' }, { sessionId: 'ses_ghost' })
    assert.equal(missing, null)
  })

  test('one-shot runs stay sessionless unless named (no cron session spam)', async () => {
    const { model } = fakeSessionModel([runningSession('ses_x')])
    assert.equal(await resolvePaperSession({ TradingSession: model } as never, { account: 'default' }, {}), null)
  })
})

// ---------------------------------------------------------------------------
//  4. DUPLICATE COMMAND — a repeated command is refused, and an order layer
//     idempotency key is deterministic (D3/D4).
// ---------------------------------------------------------------------------

describe('Slice F: simulated duplicate command', () => {
  test('a repeated pause command is refused, not double-applied', () => {
    const base = { state: 'running', startedAt: T0, timeline: [], timelineDropped: 0, lastEventAt: T0 } as Row
    const first = transition(base, 'paused', { at: T0 + 1000 })
    assert.equal(first.ok, true)
    const dup = transition(first.doc, 'paused', { at: T0 + 2000 }) // same command again
    assert.equal(dup.ok, false)
    assert.equal((dup as { code?: string }).code, 'ILLEGAL_TRANSITION')
    assert.equal(first.doc.state, 'paused', 'the refused retry must not change state')
  })

  test('terminal states swallow every late/duplicate command', () => {
    for (const term of ['completed', 'failed', 'halted']) {
      for (const to of ['queued', 'starting', 'running', 'paused', 'stopping', 'completed', 'failed', 'halted']) {
        const r = transition({ state: term, timeline: [], timelineDropped: 0 } as Row, to, { at: T0 })
        assert.equal(r.ok, false, `${term} -> ${to} must be refused`)
      }
    }
  })

  test('clientOrderId is a deterministic idempotency key (D4): replay -> same order id', () => {
    const alert = { symbol: 'BTCUSDT', side: 'BUY', price: 60000, sl: 59000, tps: [61000, 62000], ts: T0 }
    // Same alert delivered twice -> the same key -> the order-layer upsert dedupes.
    const k1 = clientOrderId('alrt_abc', 0)
    const k2 = clientOrderId('alrt_abc', 0)
    assert.equal(k1, k2)
    assert.notEqual(k1, clientOrderId('alrt_abc', 1), 'a different seq is a different order')
    assert.ok(alert && k1.length > 0)
  })
})

// ---------------------------------------------------------------------------
//  5. RISK GATE DENIAL — D7: the gate refuses, the executor never fills.
// ---------------------------------------------------------------------------

describe('Slice F: simulated Risk Gate denial', () => {
  const cfg = { ...RISK_DEFAULTS } as Row
  const FRESH = { halted: false, haltReason: '', realizedPnlPct: 0, realizedPnlAbs: 0, tradesOpened: 0, tradesClosed: 0, consecutiveLosses: 0 }
  const snap = (over: Row = {}): Row => ({
    config: over.config || cfg,
    day: { ...FRESH, ...(over.day || {}) },
    open: over.open || [],
    equity: 10000,
    balance: 10000,
    winStats: null,
  })
  const LONG = { symbol: 'BTCUSDT', side: 'BUY', entry: 63250.5, sl: 63012.1, tps: [63655, 64000] }

  test('denied orders carry a named code and ok:false', () => {
    assert.equal(evaluate(LONG, snap({ day: { realizedPnlPct: -6 } })).code, 'DAILY_LOSS_CAP')
    assert.equal(evaluate(LONG, snap({ open: Array.from({ length: 5 }, (_, i) => ({ symbol: `ALT${i}USDT`, dir: 1, qty: 1, entryPrice: 10 })) })).code, 'MAX_OPEN')
    assert.equal(evaluate({ ...LONG, tps: [63000, 64000] }, snap()).code, 'BAD_TPS') // TP below entry: rejected, never coerced
  })

  test('paper marks the denied alert rejected with the gate code (source guard)', () => {
    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.match(src, /status:\s*'rejected',\s*rejectReason:\s*`\$\{decision\.code\}: \$\{decision\.message\}`/, 'a denied intent must be persisted as rejected, never filled')
    // And the fill model never runs for it: the reject branch `continue`s first.
    const denyBranch = src.slice(src.indexOf('if (!decision.ok)'), src.indexOf('const safeTps'))
    assert.match(denyBranch, /continue/, 'the deny branch must skip the rest of the loop body')
  })
})

// ---------------------------------------------------------------------------
//  6. KILL-SWITCH — the halt freezes the desk and survives the day boundary.
// ---------------------------------------------------------------------------

describe('Slice F: simulated kill-switch', () => {
  const cfg = { ...RISK_DEFAULTS } as Row
  const LONG = { symbol: 'BTCUSDT', side: 'BUY', entry: 63250.5, sl: 63012.1, tps: [63655, 64000] }
  const day = (halted: boolean, reason = ''): Row => ({ halted, haltReason: reason, realizedPnlPct: 0, realizedPnlAbs: 0, tradesOpened: 0, tradesClosed: 0, consecutiveLosses: 0 })

  test('kill-switch on -> HALTED, every new order refused before any other check', () => {
    const d = evaluate(LONG, { config: cfg, day: day(true, 'kill_switch'), open: [], equity: 10000, balance: 10000, winStats: null } as Row)
    assert.equal(d.ok, false)
    assert.equal(d.code, 'HALTED')
  })

  test('the halt inherits across midnight (restart-of-day is not an escape)', () => {
    const latestKill = { halted: true, haltReason: 'kill_switch', realizedPnlPct: -1 }
    const inherited = resolveDay(null, latestKill)
    assert.equal(inherited.halted, true)
    assert.equal(inherited.haltReason, 'kill_switch')
  })

  test('a desk halt classifies: kill_switch/drift/manual yes, daily cap and no-halt no', () => {
    assert.deepEqual(deskHalt({ halted: true, haltReason: 'kill_switch' }), { halted: true, reason: 'kill_switch', deskWide: true })
    assert.equal(deskHalt({ halted: true, haltReason: 'drift' }).deskWide, true)
    assert.equal(deskHalt({ halted: true, haltReason: 'manual' }).deskWide, true)
    // The DAILY cap is day-scoped: it must not close the session for good.
    assert.deepEqual(deskHalt({ halted: true, haltReason: 'daily_loss_cap' }), { halted: true, reason: 'daily_loss_cap', deskWide: false })
    assert.equal(deskHalt({ halted: false, haltReason: '' }).deskWide, false)
    assert.equal(deskHalt({}).deskWide, false)
    assert.deepEqual(deskHalt({ halted: true, haltReason: '' }), { halted: true, reason: 'unknown', deskWide: true })
  })

  test('the running session is moved to halted with the reason on the timeline', () => {
    const res = haltSession(runningSession('ses_k'), { at: T0 + 5000, reason: 'kill_switch' })
    assert.equal(res.ok, true)
    const doc = (res as Row).doc
    assert.equal(doc.state, 'halted')
    assert.equal(doc.stoppedAt, T0 + 5000)
    const kinds = (doc.timeline as Row[]).map((e) => e.kind)
    assert.deepEqual(kinds, ['state', 'halt'], 'the transition and the reason are both recorded')
    assert.match(String((doc.timeline as Row[])[1].message), /desk halt \(kill_switch\)/)
  })

  test('halting is idempotent by refusal: the second cycle must not rewrite the session', () => {
    const first = (haltSession(runningSession('ses_k'), { at: T0, reason: 'kill_switch' }) as Row).doc
    const again = haltSession(first, { at: T0 + 60_000, reason: 'kill_switch' })
    assert.equal(again.ok, false)
    assert.equal((again as Row).code, 'ALREADY_HALTED')
    // Terminal stays terminal, and a daily cap never halts a session at all.
    assert.equal((haltSession(runningSession('ses_c', { state: 'completed' }), { at: T0, reason: 'kill_switch' }) as Row).code, 'ALREADY_TERMINAL')
    assert.equal((haltSession(runningSession('ses_q', { state: 'queued' }), { at: T0, reason: 'kill_switch' }) as Row).code, 'ILLEGAL_TRANSITION')
    assert.equal((haltSession(runningSession('ses_d'), { at: T0, reason: 'daily_loss_cap' }) as Row).code, 'NOT_A_DESK_HALT')
  })

  test('a paused session halts too; the executor is wired to do it (source guards)', () => {
    assert.equal(((haltSession(runningSession('ses_p', { state: 'paused' }), { at: T0, reason: 'drift' }) as Row).doc as Row).state, 'halted')

    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.match(src, /const halt = await enforceDeskHalt\(m, sessionId, haltDay\)/, 'runCycle must enforce the desk halt every cycle')
    assert.match(src, /haltSession\(found, \{ at: Date\.now\(\), reason: halt\.reason \}\)/, 'the session move must go through the pure guard')
    // Entries are skipped, but the exit scan is NOT: a halt must not trap a position.
    assert.match(src, /for \(const a of halt\.deskWide \? \[\] : entries\)/)
    assert.match(src, /\/\/ --- B\) EXIT -+/, 'the exit path must still run in the same cycle')
    assert.match(src, /stats\.halted = entries\.length/)
  })

  test('resume is an operator action — there is no code path that clears it here', () => {
    // evaluate() has no input that clears a halt: only exec/risk.mjs resume() does.
    const src = readFileSync(new URL('../exec/risk.mjs', import.meta.url), 'utf8')
    assert.match(src, /export async function resume/, 'resume exists as an explicit operator action')
    const evalBody = src.slice(src.indexOf('export function evaluate'), src.indexOf('export function evaluateModify'))
    assert.ok(!/halted\s*=\s*false/.test(evalBody), 'evaluate() must never silently clear a halt')
  })

  test('G8.1: the kill-switch halts live sessions through the gate itself (no executor required)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'risk-halt-'))
    const auditFile = join(dir, 'risk.ndjson')
    try {
      const live = [runningSession('ses_run'), runningSession('ses_pause', { state: 'paused' }), runningSession('ses_done', { state: 'completed' })]
      const writes: Row[] = []
      const row: Row = { halted: false, haltReason: '', haltedAt: null, realizedPnlPct: 0, save: async () => {} }
      // findOne is awaited directly AND called with .lean() (ensureTodayRow),
      // so the fake is a promise that also carries a lean() — same shape as a
      // Mongoose query.
      const findOne = () => { const p = Promise.resolve(row) as Row & Promise<Row>; p.lean = async () => row; return p }
      const m = {
        RiskState: { findOne },
        Position: { find: () => ({ lean: async () => [] }) },
        TradingSession: {
          find: (q: Row) => ({ lean: async () => live.filter((s) => (q.state.$in as string[]).includes(s.state)) }),
          updateOne: async (filter: Row, update: Row) => {
            const doc = live.find((s) => s.sessionId === filter._id)
            if (!doc || doc.state !== filter.state) return { modifiedCount: 0 }
            writes.push({ id: filter._id, ...update.$set })
            doc.state = 'halted'
            return { modifiedCount: 1 }
          },
        },
      }
      const res = await halt('kill_switch', { _models: m, now: T0 + 1000, auditFile })
      assert.equal(res.halted, true)
      assert.deepEqual(res.sessionsHalted, ['ses_run', 'ses_pause'], 'running and paused both halt; completed is never loaded')
      assert.equal(writes.length, 2)
      assert.equal(writes[0].state, 'halted')
      assert.equal(writes[0].stoppedAt, T0 + 1000)
      assert.match(String(writes[0].timeline.at(-1).message), /desk halt \(kill_switch\)/)
      assert.equal(row.haltReason, 'kill_switch', 'the risk record is still the authority that froze the desk')
      const audit = readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      assert.deepEqual(audit.at(-1).sessionsHalted, ['ses_run', 'ses_pause'], 'the audit names the sessions it moved')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('G8.1: a day-scoped cap never ends a session, and a refused write is counted not thrown', async () => {
    let updates = 0
    const racy = [
      { ...runningSession('ses_race'), state: 'running' },
    ]
    const m = {
      RiskState: { findOne: async () => ({ halted: false, haltReason: '', save: async () => {} }) },
      Position: { find: () => ({ lean: async () => [] }) },
      TradingSession: {
        find: () => ({ lean: async () => racy }),
        updateOne: async (filter: Row, update: Row) => {
          updates += 1
          return { modifiedCount: filter.state === racy[0].state ? 1 : 0 }
        },
      },
    }
    const cap = await haltOpenSessions(m, 'default', 'daily_loss_cap', T0)
    assert.deepEqual(cap, { halted: [], skipped: [] })
    assert.equal(updates, 0, 'the daily cap is day-scoped; halting is terminal, so it must not fire')

    // A session that another writer already moved is skipped with its code —
    // the audit keeps the fact instead of silently claiming success.
    const Session = m.TradingSession
    Session.updateOne = async () => ({ modifiedCount: 0 })
    const raced = await haltOpenSessions(m, 'default', 'drift', T0)
    assert.deepEqual(raced.halted, [])
    assert.deepEqual(raced.skipped, ['ses_race:RACE'])

    // A write that throws does not undo the halt (the desk is already frozen).
    Session.updateOne = async () => { throw new Error('mongo down') }
    const failed = await haltOpenSessions(m, 'default', 'manual', T0)
    assert.deepEqual(failed.skipped, ['ses_race:WRITE_FAILED'])
  })
})

// ---------------------------------------------------------------------------
//  Heartbeat: a dead paper executor must stop looking like a quiet market (D9).
// ---------------------------------------------------------------------------

describe('Slice F: paper heartbeat wiring', () => {
  test('a paper beat is picked up by the shared overdue evaluation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-'))
    const file = join(dir, 'services.json')
    try {
      const every = 60
      beat('paper', { lastRunAt: new Date(T0).toISOString(), lastOkAt: new Date(T0).toISOString(), intervalSec: every, count: 1 }, file)
      const live = evaluateHeartbeat(readHeartbeat(file), T0 + 60_000)
      const paper = live.find((r: Row) => r.name === 'paper')
      assert.ok(paper, 'the paper beat must appear in the shared heartbeat file')
      assert.equal(paper.overdue, false)

      // 2x the cycle with no beat -> overdue -> the orchestrator's 60s check
      // (services/run.mjs watch) raises it, and /health shows degraded.
      const dead = evaluateHeartbeat(readHeartbeat(file), T0 + every * 2 * 1000 + 1000)
      assert.equal(dead.find((r: Row) => r.name === 'paper')!.overdue, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a standalone alerter exists for deployments that never run the orchestrator', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-'))
    const file = join(dir, 'services.json')
    try {
      beat('paper', { lastRunAt: new Date(T0).toISOString(), lastOkAt: new Date(T0).toISOString(), intervalSec: 60, count: 1 }, file)
      const sent: string[] = []
      const res = await checkOverdue({ file, now: T0 + 10 * 60_000, send: (t: string) => { sent.push(t); return true } })
      assert.equal(res.overdue.length, 1)
      assert.deepEqual(res.alerted, ['paper'])
      assert.equal(sent.length, 1)
      assert.match(sent[0], /SERVICE CH/i)

      // The CLI itself: heartbeat.mjs must expose `check` and exit non-zero when
      // overdue, so cron/systemd notices even without Telegram.
      const src = readFileSync(new URL('../services/heartbeat.mjs', import.meta.url), 'utf8')
      assert.match(src, /cmd === 'check'/, 'the standalone check path must exist')
      assert.match(src, /process\.exit\(overdue\.length \? 1 : 0\)/, 'overdue must be a non-zero exit so a scheduler sees it')
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      assert.equal(pkg.scripts['services:alert'], 'node services/heartbeat.mjs check')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('watch mode beats each cycle; one-shot does not (source guard)', () => {
    const src = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
    assert.match(src, /beatPaper\(\{\s*lastRunAt:/, 'the watch tick must beat before each cycle')
    assert.match(src, /lastErrorAt:.*'mongo unavailable|mongoDown/, 'a Mongo-down cycle is a FAILED beat, not a quiet OK')
    // One-shot branch: between `if (!watch) {` and its closing `} else {`.
    const oneShot = src.slice(src.indexOf('if (!watch) {'), src.indexOf('} else {'))
    assert.ok(!oneShot.includes('beatPaper'), 'cron-style one-shot runs must not beat (would false-alarm between runs)')
  })
})
