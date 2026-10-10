import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import {
  getCandles,
  normalizeInterval,
  normalizeLimit,
  normalizeMarket,
  normalizeSymbol
} from './marketRest'
import { validateTicket } from './orders'
import type { TicketBody } from './orders'
import { execRisk } from './positionActions'
import {
  advanceBroker,
  createBrokerState,
  queueOrder
} from './replayBroker'
import type { BrokerState, ReplayOrder, ReplayPosition } from './replayBroker'

// =============================================================================
//  REPLAY SESSIONS — server-side player manager (Phase 7R2, roadmap §17).
//
//  A session owns ONE simulation/replay.mjs player (pure, deterministic) plus
//  the scheduling the pure player deliberately does not do: play() arms a
//  self-rescheduling setTimeout that steps ONE bar per candle-period / speed
//  (unref'd, same pattern as market-plane's skew sync — a replay must never
//  hold the process open). The client consumes events by cursor via
//  GET /sessions/:id?cursor=N, so future bars are never even serialized.
//
//  Bars come from the SAME historical candles endpoint the live chart uses
//  (marketRest.getCandles) — one data source for live and replay.
//
//  7R2 order cycle (roadmap §25): every step feeds the replayBroker — the
//  SAME fill model (simulation/fill.mjs), the SAME exit scan (exec/paper.mjs
//  findFirstExit) and the SAME journal projection (engine/journal.mjs
//  syncJournal, source 'replay') the live paper pipeline uses. An order
//  crosses the SAME risk gate (exec/risk checkOrder, D7) before it enters the
//  book; replay orders/positions stay in memory (never alerts/positions
//  collections), so the live executor cannot pick them up.
//
//  Session state lives in memory for the life of the Nitro process (dev-tool
//  semantics: a restart drops sessions — the events buffer is not persisted
//  yet; replay_sessions collection lands with durable sessions). Auth is the
//  standard /api middleware — nothing here is public.
// =============================================================================

type ReplayModule = typeof import('../../simulation/replay.mjs')
type ReplayPlayer = ReturnType<ReplayModule['createReplayPlayer']>
type CandleEvent = import('./marketRest').CandleEvent

// cwd-based dynamic import — same rationale as engineModel()/reports.ts:
// Nitro bundles relative paths OUT of server/ incorrectly (docs/app-inheritance.md).
let replayModP: Promise<ReplayModule> | null = null
function replayMod(): Promise<ReplayModule> {
  if (!replayModP) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'replay.mjs')).href
    replayModP = import(/* @vite-ignore */ file) as Promise<ReplayModule>
  }
  return replayModP
}

type JournalModule = typeof import('../../engine/journal.mjs')

let journalModP: Promise<JournalModule> | null = null
function journalMod(): Promise<JournalModule> {
  if (!journalModP) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'journal.mjs')).href
    journalModP = import(/* @vite-ignore */ file) as Promise<JournalModule>
  }
  return journalModP
}

export interface ReplayBodyValidation<T> {
  ok: boolean
  error?: string
  value?: T
}

export class ReplayError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'replay_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

/** Map a caught error to an h3 error (ReplayError / MarketRestError pass their own code). */
export function replayHttpError(err: unknown): unknown {
  if (err instanceof ReplayError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string }
  if (typeof e?.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'replay failed' })
  }
  return createError({ statusCode: 500, statusMessage: 'replay_failed', message: err instanceof Error ? err.message : String(err) })
}

// -----------------------------------------------------------------------------
//  Transport validators (pure — tests import them directly, positions style).
//  Shape only: the DOMAIN rules (speed membership, bar normalisation) belong
//  to the player, so transport and domain cannot drift apart.
// -----------------------------------------------------------------------------

export interface CreateSessionInput {
  symbol: string
  interval: string
  limit: number
  market: 'spot' | 'futures'
}

export interface StepInput {
  candles: number
}

export function validateCreateSessionBody(o: unknown): ReplayBodyValidation<CreateSessionInput> {
  const err = (m: string): ReplayBodyValidation<CreateSessionInput> => ({ ok: false, error: m })
  if (o === undefined || o === null) return { ok: true, value: { symbol: 'BTCUSDT', interval: '1m', limit: 300, market: normalizeMarket(undefined, process.env.MARKET_EXCHANGE) } }
  if (typeof o !== 'object' || Array.isArray(o)) return err('session body must be an object')
  const b = o as { symbol?: unknown; interval?: unknown; limit?: unknown; market?: unknown }
  try {
    const symbol = b.symbol === undefined ? 'BTCUSDT' : normalizeSymbol(String(b.symbol))
    const info = normalizeInterval(b.interval === undefined ? undefined : String(b.interval))
    const limit = normalizeLimit(b.limit === undefined ? undefined : String(b.limit), {
      min: 5,
      max: info.maxLimit,
      def: 300
    })
    const market = normalizeMarket(b.market === undefined ? undefined : String(b.market), process.env.MARKET_EXCHANGE)
    return { ok: true, value: { symbol, interval: info.interval, limit, market } }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

export function validateStepBody(o: unknown): ReplayBodyValidation<StepInput> {
  const full: StepInput = { candles: 1 }
  if (o === undefined || o === null) return { ok: true, value: full }
  if (typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'step body must be an object' }
  const b = o as { candles?: unknown }
  if (b.candles === undefined) return { ok: true, value: full }
  const n = b.candles
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: `candles must be a number (got ${String(n)})` }
  if (!Number.isInteger(n) || n < 1 || n > 500) return { ok: false, error: 'candles must be an integer in 1..500' }
  return { ok: true, value: { candles: n } }
}

// -----------------------------------------------------------------------------
//  Session store (process memory).
// -----------------------------------------------------------------------------

interface SessionRec {
  id: string
  player: ReplayPlayer
  interval: string
  intervalMs: number
  market: 'spot' | 'futures'
  createdAt: string
  timer: ReturnType<typeof setTimeout> | null
  /** In-memory order/position book (replayBroker) — never persisted. */
  broker: BrokerState
  /** Deps resolved once at create (defaults filled in) — always callable. */
  deps: ResolvedDeps
}

/** Risk-gate decision shape the session needs from exec/risk checkOrder. */
export interface GateDecision {
  ok: boolean
  qty?: number
  code?: string
  message?: string
  mongoDown?: boolean
}

export type CheckOrderFn = (ticket: {
  symbol: string
  side: string
  entry: number
  sl: number
  tps: number[]
}) => Promise<GateDecision>

/**
 * IO seams, injectable for tests. Defaults: real checkOrder (D7 gate, Mongo
 * fail-soft) and real journal projection (engine/journal syncJournal — NDJSON
 * always, Mongo when up).
 */
export interface ReplayDeps {
  getCandles?: typeof getCandles
  journalSync?: (pos: ReplayPosition) => Promise<void>
  checkOrder?: CheckOrderFn
}

/** The session stores deps AFTER defaulting — the IO seams are never optional. */
interface ResolvedDeps {
  getCandles?: typeof getCandles
  journalSync: NonNullable<ReplayDeps['journalSync']>
  checkOrder: NonNullable<ReplayDeps['checkOrder']>
}

/** Replay rows carry their own account+source so paper stats stay clean (D12). */
const REPLAY_ACCOUNT = 'replay'

async function defaultCheckOrder(ticket: Parameters<CheckOrderFn>[0]): Promise<GateDecision> {
  const risk = await execRisk()
  return risk.checkOrder(ticket, risk.loadRiskConfig()) as Promise<GateDecision>
}

async function defaultJournalSync(pos: ReplayPosition): Promise<void> {
  const j = await journalMod()
  // The SAME projection paper rows go through: ndjson always, Mongo when up,
  // key-deduped (D4 in spirit) — a replay row lands with source 'replay'.
  await j.syncJournal({ positions: [pos], alerts: [], regimeSnapshots: [] })
}

const SESSIONS = new Map<string, SessionRec>()
const MAX_SESSIONS = 20

export interface ReplaySummary {
  id: string
  symbol: string
  timeframe: string
  market: string
  interval: string
  total: number
  cursor: number
  mode: string
  speed: number
  now: number
  createdAt: string
}

export interface ReplayRead {
  session: ReplaySummary
  events: CandleEvent[]
  /** Working/filled/rejected orders of this session (book state, no future bars). */
  orders: ReplayOrder[]
  /** Open + closed replay positions; closed rows carry the journal projection fields. */
  positions: ReplayPosition[]
}

function summaryOf(rec: SessionRec): ReplaySummary {
  const s = rec.player.state()
  return {
    id: rec.id,
    symbol: s.symbol,
    timeframe: s.timeframe,
    market: rec.market,
    interval: rec.interval,
    total: s.total,
    cursor: s.cursor,
    mode: s.mode,
    speed: s.speed,
    now: s.now,
    createdAt: rec.createdAt
  }
}

function getRec(id: string): SessionRec {
  const rec = SESSIONS.get(String(id ?? '').trim())
  if (!rec) throw new ReplayError(`replay session not found (${String(id)})`, 404, 'replay_not_found')
  return rec
}

/**
 * The player's step() is plain JS whose indexed reads infer `| undefined`
 * elements — narrow once here so downstream sees clean CandleEvent[].
 */
function playedEvents(raw: unknown): CandleEvent[] {
  return (Array.isArray(raw) ? raw : []).filter((e): e is CandleEvent => Boolean(e))
}

/**
 * Run one broker cycle for the bars just played: entries + exits against the
 * replay clock, then the journal projection for every closed position. Always
 * resolves — a broker failure must never kill the auto-step timer.
 */
async function advanceAfterStep(rec: SessionRec, events: CandleEvent[]): Promise<void> {
  if (!events.length) return
  // Nothing to do -> don't even load the engine modules: a session with no
  // working orders and no open positions cannot fill or exit anything.
  const hasWork =
    rec.broker.orders.some((o) => o.status === 'working') ||
    rec.broker.positions.some((p) => p.status === 'open')
  if (!hasWork) return
  const quote = rec.player.quote()
  if (!quote) return // no played bar yet — nothing to quote (D17)
  const st = rec.player.state()
  try {
    const res = await advanceBroker(rec.broker, {
      symbol: st.symbol,
      tf: st.timeframe,
      account: REPLAY_ACCOUNT,
      bars: events,
      quote,
      now: quote.time
    })
    for (const e of res.errors) console.warn(`[replay:${rec.id}] ${e}`)
    for (const pos of res.closed) {
      try {
        await rec.deps.journalSync(pos)
      } catch (e) {
        console.warn(`[replay:${rec.id}] journal write failed for ${pos.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } catch (e) {
    console.error(`[replay:${rec.id}] broker advance failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Arm the auto-step timer: one bar every candle-period / speed, unref'd. */
function scheduleNext(rec: SessionRec): void {
  if (rec.player.state().mode !== 'playing') return
  const delay = rec.player.nextDelayMs(rec.intervalMs)
  const t = setTimeout(() => {
    rec.timer = null
    const events = playedEvents(rec.player.step(1))
    // Re-arm only AFTER the cycle finished — a slow journal write must not
    // overlap the next bar (deterministic order, same as manual stepping).
    void advanceAfterStep(rec, events).finally(() => {
      if (rec.player.state().mode === 'playing' && SESSIONS.has(rec.id)) scheduleNext(rec)
    })
  }, delay)
  t.unref?.()
  rec.timer = t
}

function clearTimer(rec: SessionRec): void {
  if (rec.timer) {
    clearTimeout(rec.timer)
    rec.timer = null
  }
}

// -----------------------------------------------------------------------------
//  Actions (routes are thin wrappers around these).
// -----------------------------------------------------------------------------

export async function createReplaySession(
  input: CreateSessionInput,
  deps: ReplayDeps = {}
): Promise<ReplaySummary> {
  if (SESSIONS.size >= MAX_SESSIONS) {
    throw new ReplayError(`replay limit reached (${MAX_SESSIONS} sessions) — restart the dev server to clear`, 409, 'replay_limit')
  }
  const candlesFn = deps.getCandles ?? getCandles
  const { candles } = await candlesFn({
    symbol: input.symbol,
    market: input.market,
    interval: input.interval,
    limit: input.limit
  })
  const mod = await replayMod()
  let player
  try {
    player = mod.createReplayPlayer({ symbol: input.symbol, timeframe: input.interval, bars: candles })
  } catch (e) {
    throw new ReplayError(e instanceof Error ? e.message : String(e), 400, 'replay_no_bars')
  }
  const rec: SessionRec = {
    id: `rp_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    player,
    interval: input.interval,
    intervalMs: mod.intervalToMs(input.interval),
    market: input.market,
    createdAt: new Date().toISOString(),
    timer: null,
    broker: createBrokerState(),
    deps: {
      getCandles: deps.getCandles,
      journalSync: deps.journalSync ?? defaultJournalSync,
      checkOrder: deps.checkOrder ?? defaultCheckOrder
    }
  }
  SESSIONS.set(rec.id, rec)
  return summaryOf(rec)
}

export function readReplaySession(id: string, cursor = 0): ReplayRead {
  const rec = getRec(id)
  return {
    session: summaryOf(rec),
    events: rec.player.takeEvents(cursor) as CandleEvent[],
    orders: rec.broker.orders,
    positions: rec.broker.positions
  }
}

export function playReplaySession(id: string, speed: unknown = undefined): ReplaySummary {
  const rec = getRec(id)
  if (speed !== undefined && speed !== null) {
    try {
      rec.player.setSpeed(Number(speed))
    } catch (e) {
      throw new ReplayError(e instanceof Error ? e.message : String(e), 400, 'replay_bad_speed')
    }
  }
  try {
    rec.player.play()
  } catch (e) {
    throw new ReplayError(e instanceof Error ? e.message : String(e), 409, 'replay_done')
  }
  clearTimer(rec)
  scheduleNext(rec)
  return summaryOf(rec)
}

export function pauseReplaySession(id: string): ReplaySummary {
  const rec = getRec(id)
  rec.player.pause()
  clearTimer(rec)
  return summaryOf(rec)
}

export async function stepReplaySession(id: string, candles: number): Promise<ReplayRead> {
  const rec = getRec(id)
  // Manual step takes over: pause the auto-timer first so play/step never race.
  clearTimer(rec)
  const events = playedEvents(rec.player.step(candles))
  if (rec.player.state().mode === 'playing') rec.player.pause()
  // Awaited: the response must already carry the post-cycle book (fills +
  // exits over the bars just played) — same read-your-writes the client gets
  // from the auto-timer's next poll.
  await advanceAfterStep(rec, events)
  return {
    session: summaryOf(rec),
    events,
    orders: rec.broker.orders,
    positions: rec.broker.positions
  }
}

// -----------------------------------------------------------------------------
//  POST /sessions/:id/orders — place a manual ticket into the replay book.
//
//  Same intake as POST /api/v1/orders (validateTicket, server/utils/orders.ts)
//  and the SAME gate the paper executor runs (exec/risk checkOrder, D7): the
//  session symbol wins the ticket's, and a gate reject surfaces 400 with the
//  gate's own code+message — nothing is queued. The qty the gate approved is
//  the qty the order carries (D21: the UI never sizes).
//
//  A market order placed BEFORE the first step has no quote yet (D17: no
//  future price) and stays 'working' until the first bar plays; once a quote
//  exists it is attempted immediately, then again on every advance.
// -----------------------------------------------------------------------------

export async function placeReplayOrder(
  id: string,
  body: unknown
): Promise<{ order: ReplayOrder; session: ReplaySummary }> {
  const rec = getRec(id)
  const st = rec.player.state()
  if (st.mode === 'done') throw new ReplayError('session already finished', 409, 'replay_done')

  const v = validateTicket(body)
  if (!v.ok) throw new ReplayError(v.error ?? 'invalid order', 400, 'replay_invalid_order')
  const t = body as TicketBody
  const bodySymbol = String(t.symbol ?? '').trim().toUpperCase()
  if (bodySymbol && bodySymbol !== st.symbol.toUpperCase()) {
    throw new ReplayError(`symbol ${bodySymbol} does not match session ${st.symbol}`, 400, 'replay_invalid_order')
  }

  const decision = await rec.deps.checkOrder({
    symbol: st.symbol,
    side: String(t.side),
    entry: Number(t.price),
    sl: Number(t.sl),
    tps: (t.tps as unknown[]).map(Number),
    ...(t.qty !== undefined && t.qty !== null ? { qty: Number(t.qty) } : {}),
    ...(t.riskPct !== undefined && t.riskPct !== null ? { pct: Number(t.riskPct) } : {})
  })
  if (!decision.ok) {
    throw new ReplayError(`${decision.code ?? 'GATE'}: ${decision.message ?? 'rejected by risk gate'}`, 400, 'replay_order_rejected')
  }
  const qty = Number(decision.qty)
  if (!(qty > 0)) {
    throw new ReplayError('risk gate approved without a usable qty', 400, 'replay_order_rejected')
  }

  // Legacy ticket default: the intent is "buy/sell now at the replay price"
  // (an ABSENT type on a live ticket means limit-at-SIGNAL for TV alerts —
  // there is no signal bar here, and a limit at the current price of a
  // healthy market would never fill).
  const type: ReplayOrder['type'] = t.type === 'limit' || t.type === 'stop' ? t.type : 'market'
  const quote = rec.player.quote()
  const now = quote?.time ?? st.now
  const order = queueOrder(
    rec.broker,
    { side: t.side as 'BUY' | 'SELL', type, price: Number(t.price), sl: Number(t.sl), tps: (t.tps as unknown[]).map(Number) },
    qty,
    now
  )
  if (quote) {
    // Entries-only pass over the current quote (no bars played by this call).
    const res = await advanceBroker(rec.broker, {
      symbol: st.symbol,
      tf: st.timeframe,
      account: REPLAY_ACCOUNT,
      bars: [],
      quote,
      now
    })
    for (const e of res.errors) console.warn(`[replay:${rec.id}] ${e}`)
  }
  return { order, session: summaryOf(rec) }
}

/** Test/GC hook: stop timers and drop every session. */
export function resetReplaySessions(): void {
  for (const rec of SESSIONS.values()) clearTimer(rec)
  SESSIONS.clear()
}
