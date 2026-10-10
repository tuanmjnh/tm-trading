import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineModel } from './engineModel'

// =============================================================================
//  TRADE TICKET -> alerts collection (roadmap Phase 7T, D3/D7).
//
//  The ticket is a MANUAL signal source: it builds the same `alerts` document
//  the TradingView webhook creates (status 'received', action ENTRY) and lets
//  the existing paper pipeline do the rest — exec/paper.mjs runs checkOrder
//  (risk gate, D7) before any position opens. The UI never sizes or fills
//  anything (D21); it only submits intent.
//
//  Validation mirrors server/webhook.mjs validate(): SL must sit on the right
//  side of the entry and every TP on the wrong (target) side — a ladder that
//  would trivially fill is rejected at the door, same as the fail-closed TP
//  rules in exec/paper.mjs.
// =============================================================================

export interface TicketBody {
  symbol?: unknown
  side?: unknown
  price?: unknown
  sl?: unknown
  tps?: unknown
  tf?: unknown
  conf?: unknown
  /** Phase 7P order type: how the intent should fill on the book. */
  type?: unknown
  /** Phase 7P sizing intent (v3 §16.1-16.2): qty XOR riskPct, max one. The
   *  risk gate sizes/verifies (D7/D21) — these only ride the raw payload. */
  qty?: unknown
  riskPct?: unknown
}

export interface TicketValidation {
  ok: boolean
  error?: string
}

const SIDES = ['BUY', 'SELL']
// Phase 7P: the same set simulation/fill.mjs prices (attemptFill refuses
// anything else) — the ticket must reject unknown types at the door too.
export const ORDER_TYPES = ['market', 'limit', 'stop'] as const
const MAX_TPS = 8

/** Validate a ticket payload. Pure — returns { ok:false, error } on first flaw. */
export function validateTicket(o: unknown): TicketValidation {
  const err = (m: string): TicketValidation => ({ ok: false, error: m })
  if (!o || typeof o !== 'object' || Array.isArray(o)) return err('payload must be an object')
  const b = o as TicketBody

  if (typeof b.symbol !== 'string' || !b.symbol.trim()) return err('symbol is required')
  if (b.symbol.trim().length > 32) return err('symbol is too long')
  if (typeof b.side !== 'string' || !SIDES.includes(b.side)) return err(`side must be one of ${SIDES.join('/')}`)
  if (typeof b.tf !== 'string') return err('tf must be a string')

  // Phase 7P: order type travels in the payload -> raw -> paper fill model.
  // Absent/null keeps the legacy limit-at-signal default (exec/paper.mjs
  // orderTypeOf); anything present must be one of the modelled types.
  if (b.type !== undefined && b.type !== null && (typeof b.type !== 'string' || !ORDER_TYPES.includes(b.type as typeof ORDER_TYPES[number]))) {
    return err(`type must be one of ${ORDER_TYPES.join('/')} (got ${String(b.type)})`)
  }

  // Raw-type checks like webhook validate(): Number.isFinite('100') must not pass.
  const price = b.price
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return err(`price must be > 0 (got ${String(b.price)})`)
  const sl = b.sl
  if (typeof sl !== 'number' || !Number.isFinite(sl)) return err(`sl must be a number (got ${String(b.sl)})`)

  if (!Array.isArray(b.tps) || b.tps.length === 0) return err('tps must be a non-empty array')
  if (b.tps.length > MAX_TPS) return err(`tps limited to ${MAX_TPS} levels`)
  for (const t of b.tps) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return err(`tp must be > 0 (got ${String(t)})`)
  }
  const tps = b.tps as number[]

  if (b.side === 'BUY') {
    if (sl >= price) return err(`BUY but sl ${sl} >= price ${price}`)
    for (const t of tps) if (t <= price) return err(`BUY but tp ${t} <= price ${price}`)
  } else {
    if (sl <= price) return err(`SELL but sl ${sl} <= price ${price}`)
    for (const t of tps) if (t >= price) return err(`SELL but tp ${t} >= price ${price}`)
  }

  if (b.conf !== undefined && b.conf !== null && (typeof b.conf !== 'number' || !Number.isFinite(b.conf))) {
    return err(`conf must be a number (got ${String(b.conf)})`)
  }

  // Phase 7P sizing intent: qty XOR riskPct, at most one. Absent = the gate
  // sizes from config/kelly (D7a). Present = the gate verifies the intent
  // against every cap before a fill — never trusted here (D21).
  const hasQty = b.qty !== undefined && b.qty !== null
  const hasRiskPct = b.riskPct !== undefined && b.riskPct !== null
  if (hasQty && hasRiskPct) return err('qty and riskPct are mutually exclusive')
  if (hasQty) {
    const q = b.qty as unknown
    if (typeof q !== 'number' || !Number.isFinite(q) || !(q > 0)) return err(`qty must be > 0 (got ${String(b.qty)})`)
  }
  if (hasRiskPct) {
    const p = b.riskPct as unknown
    if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0 && p <= 100)) return err(`riskPct must be in (0, 100] (got ${String(b.riskPct)})`)
  }

  return { ok: true }
}

export interface TicketAlertDoc {
  source: string
  v: number
  ts: Date
  symbol: string
  tf: string
  mode: string
  action: string
  level: null
  side: string
  price: number
  sl: number
  tps: number[]
  atr: null
  conf: number | null
  status: string
  raw: string
}

/**
 * Build the alert document for a validated ticket. Server owns the clock (D2)
 * and the `received` status — the paper executor transitions it to opened /
 * closed / rejected.
 */
export function buildTicketAlert(body: TicketBody, ts: Date): TicketAlertDoc {
  const conf = body.conf === undefined || body.conf === null ? null : Number(body.conf)
  return {
    source: 'manual',
    v: 1,
    ts,
    symbol: String(body.symbol).trim(),
    tf: typeof body.tf === 'string' ? body.tf : '',
    mode: 'ticket',
    action: 'ENTRY',
    level: null,
    side: String(body.side),
    price: Number(body.price),
    sl: Number(body.sl),
    tps: (body.tps as unknown[]).map(Number),
    atr: null,
    conf: conf !== null && Number.isFinite(conf) ? conf : null,
    status: 'received',
    raw: JSON.stringify(body),
  }
}

// -----------------------------------------------------------------------------
//  engine/keys.mjs loader — same cwd-based dynamic import as engineModel():
//  Nitro bundles relative paths out of server/ incorrectly (docs/app-inheritance.md).
// -----------------------------------------------------------------------------

interface EngineKeys {
  alertKey: (payload: Record<string, unknown>, source?: string) => string
}

let keysPromise: Promise<EngineKeys> | null = null

export function engineKeys(): Promise<EngineKeys> {
  if (!keysPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'keys.mjs')).href
    keysPromise = import(/* @vite-ignore */ file) as Promise<EngineKeys>
  }
  return keysPromise
}

/** Alert model via the shared engineModel() (memo + fail-soft, D1). */
export function ticketAlertModel(): ReturnType<typeof engineModel> {
  return engineModel('alert.mjs', 'Alert')
}
