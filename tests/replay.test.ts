import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ReplayError,
  createReplaySession,
  pauseReplaySession,
  playReplaySession,
  placeReplayOrder,
  readReplaySession,
  replayHttpError,
  resetReplaySessions,
  stepReplaySession,
  validateCreateSessionBody,
  validateStepBody
} from '../server/utils/replaySessions'
import type { CheckOrderFn } from '../server/utils/replaySessions'
import type { ReplayPosition } from '../server/utils/replayBroker'
import type { getCandles } from '../server/utils/marketRest'
import { fromPosition } from '../engine/journal.mjs'

// =============================================================================
//  Phase 7R2 — replay session API surface (roadmap §17 + §25). The pure
//  player semantics live in simulation/test.mjs §14; this suite locks the
//  SERVER layer: transport validation, cursor reads (future data never
//  serialized), manual step, play/pause state machine, error codes — and the
//  broker cycle (§25 acceptance): same fill model, same exit scan, same
//  journal projection, risk gate before every order.
//
//  Bars are stubbed (deps.getCandles); the gate and the journal writer are
//  injected (deps.checkOrder / deps.journalSync) — no network, no Mongo, no
//  file writes, fully deterministic.
// =============================================================================

const T0 = 1_780_000_000_000
const bars = (n: number) => Array.from({ length: n }, (_, i) => ({
  type: 'candle',
  source: 'test',
  symbol: 'BTCUSDT',
  timeframe: '1m',
  state: 'closed' as const,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 1,
  openTime: T0 + i * 60_000,
  closeTime: T0 + i * 60_000 + 59_999
}))
const stub = (n: number) => ({
  getCandles: (async () => ({ candles: bars(n), meta: {} })) as unknown as typeof getCandles
})

afterEach(() => resetReplaySessions())

describe('validateCreateSessionBody', () => {
  it('defaults to BTCUSDT / 1m / 300 when body is absent', () => {
    const v = validateCreateSessionBody(undefined)
    assert.equal(v.ok, true)
    assert.deepEqual(v.value, { symbol: 'BTCUSDT', interval: '1m', limit: 300, market: 'futures' })
  })

  it('normalizes symbol and accepts explicit market/interval/limit', () => {
    const v = validateCreateSessionBody({ symbol: ' ethusdt ', interval: '15m', limit: 100, market: 'spot' })
    assert.equal(v.ok, true)
    assert.deepEqual(v.value, { symbol: 'ETHUSDT', interval: '15m', limit: 100, market: 'spot' })
  })

  it('rejects a bad symbol / interval / market with a transport error', () => {
    assert.equal(validateCreateSessionBody({ symbol: '$$' }).ok, false)
    assert.equal(validateCreateSessionBody({ interval: '7x' }).ok, false)
    assert.equal(validateCreateSessionBody({ market: 'nasdaq' }).ok, false)
  })

  it('bounds limit to 5..maxLimit for the interval', () => {
    assert.equal(validateCreateSessionBody({ limit: 4 }).ok, false)
    assert.equal(validateCreateSessionBody({ limit: 999_999 }).ok, false)
    assert.equal(validateCreateSessionBody({ interval: '4m', limit: 300 }).ok, true)
  })

  it('rejects non-object bodies', () => {
    assert.equal(validateCreateSessionBody('x').ok, false)
    assert.equal(validateCreateSessionBody([1]).ok, false)
  })
})

describe('validateStepBody', () => {
  it('defaults to a single candle', () => {
    assert.deepEqual(validateStepBody(undefined).value, { candles: 1 })
    assert.deepEqual(validateStepBody({}).value, { candles: 1 })
  })
  it('accepts 1..500 integers only', () => {
    assert.equal(validateStepBody({ candles: 42 }).ok, true)
    assert.equal(validateStepBody({ candles: 0 }).ok, false)
    assert.equal(validateStepBody({ candles: 1.5 }).ok, false)
    assert.equal(validateStepBody({ candles: 501 }).ok, false)
    assert.equal(validateStepBody({ candles: '2' }).ok, false)
  })
})

describe('replay session lifecycle', () => {
  it('creates a session with cursor 0 and reads NOTHING back (future hidden)', async () => {
    const s = await createReplaySession(validateCreateSessionBody({ market: 'spot' }).value!, stub(60))
    assert.equal(s.cursor, 0)
    assert.equal(s.total, 60)
    assert.equal(s.mode, 'ready')
    const read = readReplaySession(s.id, 0)
    assert.equal(read.events.length, 0)
    assert.equal(read.session.cursor, 0)
  })

  it('step plays bars; the cursor read returns only what was played', async () => {
    const s = await createReplaySession(validateCreateSessionBody({ market: 'spot' }).value!, stub(60))
    const stepped = await stepReplaySession(s.id, 3)
    assert.equal(stepped.events.length, 3)
    assert.equal(stepped.session.cursor, 3)
    assert.equal(stepped.session.mode, 'paused')
    assert.equal(readReplaySession(s.id, 0).events.length, 3)
    assert.equal(readReplaySession(s.id, 3).events.length, 0)
    assert.equal(readReplaySession(s.id, 2).events.length, 1)
    // The played events carry closed candles only.
    for (const e of stepped.events) assert.equal(e.state, 'closed')
  })

  it('steps to done, then play refuses with 409 (terminal state)', async () => {
    const s = await createReplaySession(validateCreateSessionBody({ market: 'spot' }).value!, stub(5))
    await stepReplaySession(s.id, 5)
    assert.equal(readReplaySession(s.id, 0).session.mode, 'done')
    const again = await stepReplaySession(s.id, 10)
    assert.equal(again.events.length, 0)
    assert.equal(again.session.cursor, 5)
    assert.throws(() => playReplaySession(s.id), (e: unknown) => {
      const r = e as ReplayError
      return r instanceof ReplayError && r.statusCode === 409 && r.statusMessage === 'replay_done'
    })
  })

  it('play arms the player, validates speed, and pause stops it again', async () => {
    const s = await createReplaySession(validateCreateSessionBody({ market: 'spot' }).value!, stub(60))
    const playing = playReplaySession(s.id, 5)
    assert.equal(playing.mode, 'playing')
    assert.equal(playing.speed, 5)
    const paused = pauseReplaySession(s.id)
    assert.equal(paused.mode, 'paused')
    assert.equal(paused.speed, 5)
    assert.throws(() => playReplaySession(s.id, 3), (e: unknown) => {
      const r = e as ReplayError
      return r instanceof ReplayError && r.statusCode === 400 && r.statusMessage === 'replay_bad_speed'
    })
    pauseReplaySession(s.id)
  })

  it('unknown session -> 404 replay_not_found', () => {
    assert.throws(() => readReplaySession('rp_nope', 0), (e: unknown) => {
      const r = e as ReplayError
      return r instanceof ReplayError && r.statusCode === 404 && r.statusMessage === 'replay_not_found'
    })
  })

  it('no closed bars upstream -> 400 replay_no_bars (forming candles are not replayable)', async () => {
    const forming = bars(10).map((b) => ({ ...b, state: 'forming' as const }))
    await assert.rejects(
      createReplaySession({ symbol: 'BTCUSDT', interval: '1m', limit: 10, market: 'spot' },
        { getCandles: (async () => ({ candles: forming, meta: {} })) as unknown as typeof getCandles }),
      (e: unknown) => {
        const r = e as ReplayError
        return r instanceof ReplayError && r.statusCode === 400 && r.statusMessage === 'replay_no_bars'
      }
    )
  })
})

describe('replayHttpError', () => {
  it('maps ReplayError to an h3 error carrying the original code', () => {
    const h3err = replayHttpError(new ReplayError('gone', 404, 'replay_not_found')) as { statusCode?: number; statusMessage?: string }
    assert.equal(h3err.statusCode, 404)
    assert.equal(h3err.statusMessage, 'replay_not_found')
  })
  it('passes MarketRestError-style codes through (upstream 502)', () => {
    const h3err = replayHttpError({ statusCode: 502, statusMessage: 'error.upstreamFailed', message: 'banned' }) as { statusCode?: number }
    assert.equal(h3err.statusCode, 502)
  })
  it('unknown errors become 500 replay_failed', () => {
    const h3err = replayHttpError(new Error('boom')) as { statusCode?: number; statusMessage?: string }
    assert.equal(h3err.statusCode, 500)
    assert.equal(h3err.statusMessage, 'replay_failed')
  })
})

// -----------------------------------------------------------------------------
//  §25 broker cycle — SAME fill model, SAME exit scan, SAME journal projection,
//  risk gate (D7) before every order. Gate and journal writer are injected so
//  the suite never touches Mongo or reports/journal.ndjson.
// -----------------------------------------------------------------------------

const gateOk = (qty: number): CheckOrderFn => async () => ({ ok: true, qty, mongoDown: true })
const gateNo: CheckOrderFn = async () => ({ ok: false, code: 'DAILY_LOSS', message: 'daily loss cap hit', mongoDown: true })

const candle = (i: number, o: number, h: number, l: number, c: number) => ({
  type: 'candle',
  source: 'test',
  symbol: 'BTCUSDT',
  timeframe: '1m',
  state: 'closed' as const,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
  openTime: T0 + i * 60_000,
  closeTime: T0 + i * 60_000 + 59_999
})

/** Custom OHLC path: [index, open, high, low, close] rows in ascending order. */
const candlesOf = (rows: Array<[number, number, number, number, number]>) =>
  (async () => ({ candles: rows.map(([i, o, h, l, c]) => candle(i, o, h, l, c)), meta: {} })) as unknown as typeof getCandles

const ticket = (over: Record<string, unknown> = {}) => ({
  symbol: 'BTCUSDT',
  tf: '1m',
  side: 'BUY',
  type: 'market',
  price: 100.5,
  sl: 95,
  tps: [110],
  ...over
})

async function brokerSession(opts: {
  bars?: number
  getCandles?: typeof getCandles
  checkOrder?: CheckOrderFn
} = {}) {
  const journal: ReplayPosition[] = []
  const s = await createReplaySession(validateCreateSessionBody({ market: 'spot' }).value!, {
    getCandles: opts.getCandles ?? stub(opts.bars ?? 60).getCandles,
    checkOrder: opts.checkOrder ?? gateOk(0.01),
    journalSync: async (p) => {
      journal.push(p)
    }
  })
  return { s, journal }
}

describe('replay broker — orders through the gate', () => {
  it('rejects a malformed ticket and a foreign symbol before anything is queued', async () => {
    const { s } = await brokerSession()
    await assert.rejects(
      placeReplayOrder(s.id, { side: 'BUY', price: -1, sl: 95, tps: [110] }),
      (e: unknown) => e instanceof ReplayError && e.statusMessage === 'replay_invalid_order'
    )
    await assert.rejects(
      placeReplayOrder(s.id, ticket({ symbol: 'ETHUSDT' })),
      (e: unknown) => e instanceof ReplayError && e.statusMessage === 'replay_invalid_order'
    )
    assert.equal(readReplaySession(s.id).orders.length, 0)
  })

  it('refuses the order when the risk gate says no (D7) — nothing queued', async () => {
    const { s } = await brokerSession({ checkOrder: gateNo })
    await assert.rejects(
      placeReplayOrder(s.id, ticket()),
      (e: unknown) =>
        e instanceof ReplayError &&
        e.statusCode === 400 &&
        e.statusMessage === 'replay_order_rejected' &&
        /DAILY_LOSS/.test(e.message)
    )
    const read = readReplaySession(s.id)
    assert.equal(read.orders.length, 0)
    assert.equal(read.positions.length, 0)
  })

  it('the order carries the GATE-approved qty (D21: the UI never sizes)', async () => {
    const { s } = await brokerSession({ checkOrder: gateOk(0.25) })
    const placed = await placeReplayOrder(s.id, ticket())
    assert.equal(placed.order.qty, 0.25)
    assert.equal(placed.order.status, 'working') // no played bar yet -> no quote (D17)
  })

  it('placing after bars played fills immediately against the last played close', async () => {
    const { s } = await brokerSession({ checkOrder: gateOk(0.01) })
    await stepReplaySession(s.id, 1)
    const placed = await placeReplayOrder(s.id, ticket())
    assert.equal(placed.order.status, 'filled')
    const read = readReplaySession(s.id)
    assert.equal(read.positions.length, 1)
    assert.equal(read.positions[0].status, 'open')
    assert.ok(read.positions[0].entryPrice > 100.5 && read.positions[0].entryPrice < 100.6)
  })

  it('a limit order stays working across steps until the quote reaches it', async () => {
    const { s } = await brokerSession()
    await placeReplayOrder(s.id, ticket({ type: 'limit', price: 90, sl: 85, tps: [95] }))
    const stepped = await stepReplaySession(s.id, 3) // rising bars: ask never <= 90
    assert.equal(stepped.orders[0].status, 'working')
    assert.equal(stepped.positions.length, 0)
  })

  it('placing into a finished session is 409 replay_done', async () => {
    const { s } = await brokerSession({ bars: 2 })
    await stepReplaySession(s.id, 2)
    await assert.rejects(
      placeReplayOrder(s.id, ticket()),
      (e: unknown) => e instanceof ReplayError && e.statusCode === 409 && e.statusMessage === 'replay_done'
    )
  })
})

describe('replay broker — cycle (fill + exit + journal)', () => {
  it('market fill on the next step; the fill bar cannot stop us (same-bar scan guard)', async () => {
    // bar0 dips to 90 deep below the 95 stop — the entry quote bar must NOT be
    // scanned (lastScanMs = its close), exactly live paper's post-entry cursor.
    const { s, journal } = await brokerSession({
      getCandles: candlesOf([[0, 100, 101, 90, 100.5], [1, 101, 102, 100, 101.5], [2, 101.5, 103, 101, 102.5]]),
      checkOrder: gateOk(0.25)
    })
    await placeReplayOrder(s.id, ticket())
    const step1 = await stepReplaySession(s.id, 1)
    assert.equal(step1.orders[0].status, 'filled')
    const pos = step1.positions[0]
    assert.equal(pos.status, 'open')
    assert.equal(pos.qty, 0.25)
    // Fill model parity: market BUY = derived ask + taker slippage off the
    // 100.5 close, age 0 (now = quote.time on the replay clock).
    assert.ok(pos.entryPrice > 100.5 && pos.entryPrice < 100.6, `entry ${pos.entryPrice}`)
    assert.equal(pos.source, 'replay')
    assert.equal(pos.account, 'replay')
    assert.equal(pos.entryTime, T0 + 59_999) // the quote bar's eventTime (close), not wall time
    assert.equal(journal.length, 0) // an open row is not journalable yet
  })

  it('SL exit: paper findFirstExit + closeFill + journal projection source=replay -> SL', async () => {
    const { s, journal } = await brokerSession({
      getCandles: candlesOf([[0, 100, 101, 90, 100.5], [1, 100.4, 100.6, 94, 94.5], [2, 94.5, 95, 94, 94.8]]),
      checkOrder: gateOk(0.01)
    })
    await placeReplayOrder(s.id, ticket())
    await stepReplaySession(s.id, 1) // entry at bar0 close; bar0's deep dip skipped
    await stepReplaySession(s.id, 1) // bar1 low 94 <= stop 95 -> SL
    const pos = readReplaySession(s.id).positions[0]
    assert.equal(pos.status, 'closed')
    assert.equal(pos.exitReason, 'data:sl') // engine/stamp exitReasonFromHit — paper's string
    // stop level with taker slippage in the exit direction (long: below stop)
    assert.ok(Math.abs(Number(pos.exitPrice) - 95 * (1 - 2e-4)) < 1e-6, `exit ${pos.exitPrice}`)
    assert.ok((pos.pnlAbs ?? 0) < 0)
    assert.ok(Number.isFinite(Number(pos.fees)) && (pos.fees ?? 0) > 0) // measured round trip

    assert.equal(journal.length, 1) // sync projection ran exactly once
    const row = fromPosition(journal[0]) as Record<string, unknown>
    assert.equal(row.source, 'replay')
    assert.equal(row.account, 'replay')
    assert.equal(row.result, 'SL')
    assert.equal(row.symbol, 'BTCUSDT')
    assert.equal(row.dir, 1)
    assert.ok(String(row.key).startsWith('j1_'))
    assert.ok(row.exitTime instanceof Date)
  })

  it('TP1 touch: maker fill AT the level (no slippage) -> data:tp -> journal TP', async () => {
    const { s, journal } = await brokerSession({
      getCandles: candlesOf([[0, 100, 101, 99, 100.5], [1, 100.5, 102, 100, 101.5]]),
      checkOrder: gateOk(0.01)
    })
    await placeReplayOrder(s.id, ticket({ tps: [101] }))
    await stepReplaySession(s.id, 1)
    await stepReplaySession(s.id, 1)
    const pos = readReplaySession(s.id).positions[0]
    assert.equal(pos.status, 'closed')
    assert.equal(pos.exitReason, 'data:tp')
    assert.equal(pos.exitPrice, 101)
    assert.ok((pos.pnlAbs ?? 0) > 0)
    const row = fromPosition(journal[0]) as Record<string, unknown>
    assert.equal(row.result, 'TP')
  })

  it('the book is readable from the cursor read (orders + positions, no future bars)', async () => {
    const { s } = await brokerSession({
      getCandles: candlesOf([[0, 100, 101, 99, 100.5], [1, 100.5, 102, 100, 101.5]]),
      checkOrder: gateOk(0.01)
    })
    await placeReplayOrder(s.id, ticket({ tps: [101] }))
    const before = await stepReplaySession(s.id, 1)
    assert.equal(before.events.length, 1)
    assert.equal(before.orders[0].status, 'filled')
    assert.equal(before.positions[0].status, 'open')
    const read = readReplaySession(s.id, 0)
    assert.equal(read.events.length, 1) // future bars still hidden (D17)
    assert.equal(read.orders.length, 1)
    assert.equal(read.positions.length, 1)
  })
})
