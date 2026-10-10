import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Types } from 'mongoose'
import { engineModel } from './engineModel'

// =============================================================================
//  POSITION ACTIONS — modify SL/TP and close (full or partial), Phase 7P D7e.
//
//  Every action an operator takes on an EXISTING position crosses the SAME
//  risk gate as an entry (exec/risk.mjs): checkModify re-validates the
//  resulting SL/TP ladder (side rules + D7a risk budget + minRR on the
//  result), and checkPartialClose validates the close qty. A gate reject
//  surfaces as 400 with the gate's own code+message — nothing is written.
//
//  Writes are CAS-guarded ({_id, status:'open'} and, for partials, qty too),
//  so a concurrent paper cycle that closes the position first turns into 409,
//  never a double-close or a qty/fee drift. Counters go through recordClose
//  (day counters + equity — the same numbers the paper executor writes), and
//  a FULL close follows the ENTRY alert to 'closed', exactly like
//  exec/paper.mjs closePosition does. A PARTIAL close never touches the alert
//  (the position is still alive) — it forks a CLOSED child document that
//  carries the realized slice, keeps `signalKey: null` (no journal-key
//  collision with the parent) and gets its own unique externalId (`pc-...`,
//  because {account, source, externalId} is a unique sparse index).
//
//  Pricing mirrors the paper exit path: latest 1m close, costed through
//  simulation partialCloseFill with the fill model as a taker 'market' event
//  (slippage + taker fee) — a manual close pays what an exit pays.
//  Gate runs BEFORE quote, quote BEFORE writes (paper order: check -> fill).
// =============================================================================

const MAX_TPS = 8

export interface ModifyPatch {
  sl?: number
  tps?: number[]
}

export interface CloseTarget {
  qty?: number
  pct?: number
}

export interface BodyValidation<T> {
  ok: boolean
  error?: string
  value?: T
}

/**
 * Transport validation for PATCH /positions/:id. Shape only (numbers are
 * numbers, ladder is non-empty and capped): the DOMAIN rules (SL side, TP
 * side, defective levels, empty patch) belong to the risk gate — the same
 * simulation validateModify the entry path runs, so entry and modify cannot
 * drift apart.
 */
export function validateModifyBody(o: unknown): BodyValidation<ModifyPatch> {
  const err = (m: string): BodyValidation<ModifyPatch> => ({ ok: false, error: m })
  if (o === undefined || o === null) return err('patch body is required')
  if (typeof o !== 'object' || Array.isArray(o)) return err('patch must be an object')
  const b = o as { sl?: unknown; tps?: unknown }
  const patch: ModifyPatch = {}

  if (b.sl !== undefined) {
    if (b.sl === null || typeof b.sl !== 'number' || !Number.isFinite(b.sl)) return err(`sl must be a number (got ${String(b.sl)})`)
    patch.sl = b.sl
  }
  if (b.tps !== undefined) {
    if (!Array.isArray(b.tps)) return err('tps must be an array')
    if (b.tps.length === 0) return err('tps must be a non-empty array (a position cannot be left without targets)')
    if (b.tps.length > MAX_TPS) return err(`tps limited to ${MAX_TPS} levels`)
    for (const t of b.tps) {
      if (typeof t !== 'number' || !Number.isFinite(t)) return err(`tp must be a number (got ${String(t)})`)
    }
    patch.tps = b.tps as number[]
  }
  if (patch.sl === undefined && patch.tps === undefined) return err('patch must include sl and/or tps')
  return { ok: true, value: patch }
}

/**
 * Transport validation for POST /positions/:id/close. No body (or an empty
 * object) means FULL close — mapped to { pct: 100 } here so the gate sees a
 * complete target (partialCloseQty rejects a missing target as MISSING).
 * Bounds (qty <= position, pct in (0,100], qty XOR pct) are the gate's job.
 */
export function validateCloseBody(o: unknown): BodyValidation<CloseTarget> {
  const full: CloseTarget = { pct: 100 }
  if (o === undefined || o === null) return { ok: true, value: full }
  if (typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'close body must be an object' }
  const b = o as { qty?: unknown; pct?: unknown }
  if (b.qty === undefined && b.pct === undefined) return { ok: true, value: full }

  const target: CloseTarget = {}
  if (b.qty !== undefined) {
    if (typeof b.qty !== 'number' || !Number.isFinite(b.qty)) return { ok: false, error: `qty must be a number (got ${String(b.qty)})` }
    target.qty = b.qty
  }
  if (b.pct !== undefined) {
    if (typeof b.pct !== 'number' || !Number.isFinite(b.pct)) return { ok: false, error: `pct must be a number (got ${String(b.pct)})` }
    target.pct = b.pct
  }
  return { ok: true, value: target }
}

// -----------------------------------------------------------------------------
//  Engine loaders — cwd-based dynamic imports, same rationale as engineModel():
//  Nitro bundles relative paths out of server/ incorrectly
//  (docs/app-inheritance.md). Memoized per process; import of exec/risk.mjs
//  also runs its loadEnv() so .env (MONGODB_URI, RISK_*) is in scope.
// -----------------------------------------------------------------------------

type Risk = typeof import('../../exec/risk.mjs')
type Sim = typeof import('../../simulation/engine.mjs')
type FillCfg = typeof import('../../simulation/fill.mjs')

interface KlinesModule {
  fetchKlines: (o: Record<string, unknown>) => Promise<{ bars?: Array<{ close: unknown }> }>
}

let riskPromise: Promise<Risk> | null = null
export function execRisk(): Promise<Risk> {
  if (!riskPromise) {
    const file = pathToFileURL(join(process.cwd(), 'exec', 'risk.mjs')).href
    riskPromise = import(/* @vite-ignore */ file) as Promise<Risk>
  }
  return riskPromise
}

let simPromise: Promise<Sim> | null = null
function simEngine(): Promise<Sim> {
  if (!simPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'engine.mjs')).href
    simPromise = import(/* @vite-ignore */ file) as Promise<Sim>
  }
  return simPromise
}

let fillPromise: Promise<FillCfg> | null = null
function fillConfig(): Promise<FillCfg> {
  if (!fillPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'fill.mjs')).href
    fillPromise = import(/* @vite-ignore */ file) as Promise<FillCfg>
  }
  return fillPromise
}

let klinesPromise: Promise<KlinesModule> | null = null
function klinesModule(): Promise<KlinesModule> {
  if (!klinesPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'data.mjs')).href
    klinesPromise = import(/* @vite-ignore */ file) as Promise<KlinesModule>
  }
  return klinesPromise
}

// -----------------------------------------------------------------------------
//  Shared: load the OPEN position or 404 / Mongo-down.
// -----------------------------------------------------------------------------

async function openPositionOr404(id: string): Promise<{ Position: any; pos: any }> {
  const Position = await engineModel('position.mjs', 'Position')
  if (!Position) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — action not applied' })
  }
  if (!Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 404, statusMessage: 'not_found', message: `Position ${id} not found` })
  }
  try {
    const pos = await Position.findOne({ _id: new Types.ObjectId(id), status: 'open' }).lean()
    if (!pos) {
      throw createError({ statusCode: 404, statusMessage: 'not_found', message: `Open position ${id} not found (already closed?)` })
    }
    return { Position, pos }
  } catch (e: unknown) {
    if ((e as { statusCode?: number })?.statusCode) throw e
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: `Position not readable: ${String((e as Error)?.message ?? e)}` })
  }
}

/**
 * Latest 1m close for the manual close price — the same quote the paper
 * executor uses for TIME_CLOSE (exec/paper.mjs). No usable quote -> 502, the
 * close is NOT applied (never invent a price).
 */
async function closeQuote(symbol: string): Promise<number> {
  const { fetchKlines } = await klinesModule()
  const apiSymbol = symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol
  // Same market source the paper executor quotes with (exec/paper.mjs
  // PAPER_DEFAULTS.market): PAPER_MARKET env, defaulting to fapi.
  const market = process.env.PAPER_MARKET || 'fapi'
  let px = NaN
  try {
    const { bars } = await fetchKlines({ symbol: apiSymbol, tf: '1', market, refresh: true, limit: 2 })
    px = bars?.length ? Number(bars[bars.length - 1]?.close) : NaN
  } catch {
    px = NaN
  }
  if (!(Number.isFinite(px) && px > 0)) {
    throw createError({ statusCode: 502, statusMessage: 'no_quote', message: `No 1m quote for ${symbol} — close not applied` })
  }
  return px
}

// -----------------------------------------------------------------------------
//  PATCH /api/v1/positions/:id — modify SL / TP
// -----------------------------------------------------------------------------

interface ModifyDecision {
  ok: boolean
  code?: string
  message?: string
  sl?: number
  tps?: number[]
  rr?: number
}

export async function modifyPositionAction(id: string, body: unknown) {
  const v = validateModifyBody(body)
  if (!v.ok || !v.value) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_patch', message: v.error ?? 'invalid patch' })
  }
  const { Position, pos } = await openPositionOr404(id)

  const risk = await execRisk()
  const config = risk.loadRiskConfig()
  const decision: ModifyDecision = await risk.checkModify(pos, v.value, config)
  if (!decision.ok) {
    throw createError({ statusCode: 400, statusMessage: 'modify_rejected', message: `${decision.code}: ${decision.message}` })
  }

  // CAS on status only (matchedCount, not modifiedCount: patching a field to
  // the value it already has is a SUCCESS, not a conflict).
  const res = await Position.updateOne(
    { _id: pos._id, status: 'open' },
    { $set: { sl: decision.sl, tps: decision.tps } },
  )
  if (!res.matchedCount) {
    throw createError({ statusCode: 409, statusMessage: 'conflict', message: 'Position changed since it was loaded — reload and retry' })
  }
  return {
    success: true,
    data: {
      id: String(pos._id),
      sl: decision.sl ?? null,
      tps: decision.tps ?? [],
      rr: decision.rr != null ? Number(decision.rr.toFixed(2)) : null,
    },
  }
}

// -----------------------------------------------------------------------------
//  POST /api/v1/positions/:id/close — full or partial
// -----------------------------------------------------------------------------

/**
 * The CLOSED child document a partial close forks off the parent: it carries
 * the realized slice (qty + pro-rata entry fees + this exit's round-trip
 * fees), keeps identity fields (account/source/symbol/dir/entry/entryTime/
 * stamp/tf),
 * drops the protection (sl null, tps []) and the alert link (signalKey null —
 * the PARENT still owns the alert and the journal identity), and gets its
 * own unique externalId so the {account, source, externalId} unique index
 * holds for BOTH rows.
 */
function buildPartialChild(pos: any, slice: { qty: number; feeShare: number | null }, fill: any, exitTime: Date) {
  const keep: Record<string, unknown> = {}
  for (const k of ['account', 'source', 'symbol', 'dir', 'entryPrice', 'entryTime', 'method', 'paramsHash', 'tf', 'stamp', 'stampUnknown']) {
    if (k in pos) keep[k] = pos[k]
  }
  return {
    ...keep,
    externalId: `pc-${pos.externalId ?? String(pos._id)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    qty: slice.qty,
    sl: null,
    tps: [],
    status: 'closed',
    exitPrice: fill.exitPrice,
    exitTime,
    pnlPct: fill.pnlPct,
    pnlAbs: fill.net,
    // Round-trip fees are only MEASURED when the entry share was known; a
    // legacy null-entry-fee position keeps null (never claimed as measured).
    fees: slice.feeShare === null ? null : fill.feesTotal,
    exitReason: 'manual:partial',
    signalKey: null,
    orderType: null,
    slippage: null,
  }
}

export async function closePositionAction(id: string, body: unknown) {
  const v = validateCloseBody(body)
  if (!v.ok || !v.value) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_close', message: v.error ?? 'invalid close body' })
  }
  const target = v.value
  const { Position, pos } = await openPositionOr404(id)

  const risk = await execRisk()
  const config = risk.loadRiskConfig()
  const decision: { ok: boolean; code?: string; message?: string } = await risk.checkPartialClose(pos, target, config)
  if (!decision.ok) {
    throw createError({ statusCode: 400, statusMessage: 'close_rejected', message: `${decision.code}: ${decision.message}` })
  }

  // Gate approved -> price it (paper order: check -> fill -> write).
  const price = await closeQuote(pos.symbol)
  const { partialCloseFill } = await simEngine()
  const { loadFillConfig } = await fillConfig()
  const filled = partialCloseFill(pos, target, { kind: 'market', price }, loadFillConfig())
  if (!filled.ok) {
    throw createError({ statusCode: 400, statusMessage: 'unpriceable', message: `${filled.code}: ${filled.message}` })
  }

  const fill = filled.fill
  if (!fill.ok) {
    // Unreachable in practice (partialCloseFill already refuses a bad fill),
    // but the type system — and belt-and-suspenders — both want it here.
    throw createError({ statusCode: 400, statusMessage: 'unpriceable', message: `${fill.code}: ${fill.message}` })
  }
  const exitTime = new Date()
  const equityBefore = await risk.equityNow(config)
  const pnlAbs = fill.net // gross - entry share - exit fee (fee-NET)
  const pnlPctOnEquity = equityBefore > 0 ? (pnlAbs / equityBefore) * 100 : 0
  const entryFeesKnown = pos.fees !== null && pos.fees !== undefined && Number.isFinite(Number(pos.fees))

  // --- FULL close (empty body / pct 100 / qty == position): the parent dies
  if (filled.isFull) {
    const res = await Position.updateOne(
      { _id: pos._id, status: 'open' },
      {
        $set: {
          status: 'closed',
          exitPrice: fill.exitPrice,
          exitTime,
          pnlAbs,
          pnlPct: fill.pnlPct,
          fees: entryFeesKnown ? fill.feesTotal : null,
          exitReason: 'manual',
        },
      },
    )
    if (!res.matchedCount) {
      throw createError({ statusCode: 409, statusMessage: 'conflict', message: 'Position was closed concurrently — nothing applied' })
    }
    await risk.recordClose({ config, symbol: pos.symbol, pnlAbs, pnlPctOnEquity, win: pnlAbs > 0, equity: equityBefore, reason: 'manual' })
    // Follow the ENTRY alert to 'closed' (received -> opened -> closed), the
    // same journey exec/paper.mjs gives every close.
    if (pos.signalKey) {
      const Alert = await engineModel('alert.mjs', 'Alert')
      if (Alert) await Alert.updateOne({ alertKey: pos.signalKey }, { $set: { status: 'closed' } })
    }
    return {
      success: true,
      data: {
        id: String(pos._id),
        status: 'closed',
        closedQty: filled.qty,
        exitPrice: fill.exitPrice,
        pnlAbs,
        exitReason: 'manual',
      },
    }
  }

  // --- PARTIAL close: CAS the remainder FIRST, fork the child SECOND --------
  const res = await Position.updateOne(
    { _id: pos._id, status: 'open', qty: pos.qty },
    { $set: { qty: filled.remainingQty, fees: filled.remainingFees } },
  )
  if (!res.matchedCount) {
    throw createError({ statusCode: 409, statusMessage: 'conflict', message: 'Position changed (closed or re-sized) since it was loaded — reload and retry' })
  }

  let child: any
  try {
    child = await Position.create(buildPartialChild(pos, filled, fill, exitTime))
  } catch (e: unknown) {
    // Child failed -> put the parent's qty/fees back, then fail loudly: a
    // partial close is ALL of it or NONE of it.
    await Position.updateOne({ _id: pos._id, status: 'open' }, { $set: { qty: pos.qty, fees: pos.fees } })
    throw createError({
      statusCode: 500,
      statusMessage: 'child_failed',
      message: `Partial close rolled back (child doc failed): ${String((e as Error)?.message ?? e)}`,
    })
  }

  await risk.recordClose({ config, symbol: pos.symbol, pnlAbs, pnlPctOnEquity, win: pnlAbs > 0, equity: equityBefore, reason: 'manual:partial' })
  return {
    success: true,
    data: {
      id: String(pos._id),
      status: 'open',
      closedQty: filled.qty,
      remainingQty: filled.remainingQty,
      remainingFees: filled.remainingFees,
      childId: String(child._id),
      exitPrice: fill.exitPrice,
      pnlAbs,
      exitReason: 'manual:partial',
    },
  }
}
