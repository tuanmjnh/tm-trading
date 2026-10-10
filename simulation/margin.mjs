// =============================================================================
//  TM TRADING — SIMULATION MARGIN MODEL (roadmap v3 §17.1 margin.mjs, §20), PURE.
//
//  How the paper account LOCKS margin for open positions (isolated-style):
//    marginUsed      = Σ notional * initialMarginPct / 100      per open position
//    leverage        = 100 / initialMarginPct                   (20% initial = 5x)
//    maintenance     = Σ notional * maintenanceMarginPct / 100  (the liquidation floor)
//    freeMargin      = equity - marginUsed
//
//  Both percentages match the risk gate's D7 view: maxLeverage 5 = 20% initial
//  margin. The DEFAULT mmr (0.4%) is Binance-futures-like for BTC. No IO, no
//  clock; everything derived from position docs so it is golden-testable.
//
//  None of these functions PLACES an order — sizing/approval belongs to the risk
//  gate (exec/risk.mjs); this only prices the margin an already-approved open
//  position consumes (D7: gate authors quantity first).
// =============================================================================

export const MARGIN_DEFAULTS = Object.freeze({
  initialMarginPct: 20, // % of notional locked as position margin (20% = 5x)
  maintenanceMarginPct: 0.4, // % of notional kept as maintenance margin (liq floor)
})

const ENV_MAP = Object.freeze({
  MRG_INITIAL_MARGIN_PCT: ['initialMarginPct', Number],
  MRG_MAINTENANCE_MARGIN_PCT: ['maintenanceMarginPct', Number],
})

/** Defaults <- env. Invalid numbers keep the default (never crash the model). */
export function loadMarginConfig(env = process.env) {
  const cfg = { ...MARGIN_DEFAULTS }
  for (const [key, [field, type]] of Object.entries(ENV_MAP)) {
    const raw = env[key]
    if (raw === undefined || raw === '') continue
    if (type === Number) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0 && n <= 100) cfg[field] = n
    }
  }
  return cfg
}

const round8 = (n) => Math.round(n * 1e8) / 1e8

const reject = (code, message) => ({ ok: false, code, message })

/** Notional of a position doc: |qty * entryPrice|. */
export function positionNotional(pos) {
  const qty = Number(pos?.qty)
  const entry = Number(pos?.entryPrice)
  if (!(Number.isFinite(qty) && qty > 0)) return null
  if (!(Number.isFinite(entry) && entry > 0)) return null
  return round8(qty * entry)
}

/** Margin a position LOCKS while open (isolated initial margin). */
export function initialMarginFor(pos, model = MARGIN_DEFAULTS) {
  const notional = positionNotional(pos)
  if (notional === null) return null
  const m = { ...MARGIN_DEFAULTS, ...model }
  return round8((notional * m.initialMarginPct) / 100)
}

/** Maintenance margin floor for a position (built-in liquidation threshold). */
export function maintenanceMarginFor(pos, model = MARGIN_DEFAULTS) {
  const notional = positionNotional(pos)
  if (notional === null) return null
  const m = { ...MARGIN_DEFAULTS, ...model }
  return round8((notional * m.maintenanceMarginPct) / 100)
}

/**
 * Effective leverage the configured initial margin implies (100 / pct).
 * @returns {{ok:true, leverage} | {ok:false, code, message}}
 */
export function leverageOf(model = MARGIN_DEFAULTS) {
  const pct = Number(model?.initialMarginPct ?? MARGIN_DEFAULTS.initialMarginPct)
  if (!(Number.isFinite(pct) && pct > 0 && pct <= 100)) return reject('BAD_PCT', `initialMarginPct must be in (0, 100] (got ${String(pct)})`)
  return { ok: true, leverage: round8(100 / pct) }
}

/**
 * Margin health of the whole account (roadmap §20 view): how much is locked,
 * what the maintenance floor is, and whether equity has already crossed it
 * (cross-style liquidation trigger for the account, not per position).
 *
 * @param {object} args
 * @param {number} args.equity        current account equity (base + realized + unrealized)
 * @param {object[]} args.positions   open + closed position docs (open ones count)
 * @param {object} [args.model]       MARGIN_DEFAULTS overrides
 * @returns {{ok:true, marginUsed, maintenance, freeMargin, utilizationPct,
 *            liquidated} | {ok:false, code, message}}
 */
export function accountMarginHealth({ equity = 0, positions = [], model = MARGIN_DEFAULTS } = {}) {
  const eq = Number(equity)
  if (!Number.isFinite(eq)) return reject('BAD_EQUITY', `equity must be a number (got ${String(equity)})`)
  let marginUsed = 0
  let maintenance = 0
  for (const p of positions) {
    if (p?.status !== 'open') continue
    const im = initialMarginFor(p, model)
    const mm = maintenanceMarginFor(p, model)
    if (im === null || mm === null) continue // unknown legacy docs never block
    marginUsed += im
    maintenance += mm
  }
  marginUsed = round8(marginUsed)
  maintenance = round8(maintenance)
  return {
    ok: true,
    equity: eq,
    marginUsed,
    maintenance,
    freeMargin: round8(eq - marginUsed),
    utilizationPct: eq > 0 ? round8((marginUsed / eq) * 100) : 0,
    liquidated: eq <= maintenance,
  }
}