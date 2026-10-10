import { simulationEngine, simulationFill, simulationMargin, simulationLiquidation } from './engineModel'
import type { LiveAccount, LivePositionFields, PositionItem } from '../../types/positions'

// =============================================================================
//  TM TRADING — LIVE position + account numbers (roadmap v3 §19/§20), PURE.
//
//  The dashboard may DISPLAY a live mark / unrealized / liq price / margin per
//  open position and the account's locked margin — but it may never invent
//  them (D21/D25). Every number here is computed server-side from the stored
//  position doc (engine owns state) + a CURRENT quote off the live market
//  plane, through the SAME pure simulation core the executor uses:
//    - mark + unrealized ..... simulation/engine.mjs markUnrealized (exit side)
//    - liquidation price ..... simulation/liquidation.mjs liquidationPrice
//    - margin / leverage ..... simulation/margin.mjs (isolated initial margin)
//
//  Fail-soft contract (D12): any missing quote / unknown legacy doc yields
//  nulls, never a fabricated number. Callers build the quote shape from the
//  plane's quote rows: { bid, ask, last, time: eventTime }.
//
//  Imports are RUNTIME dynamic (see engineModel.ts): Nitro dev bundles
//  `server/utils/*.ts` into `.nuxt/dev/index.mjs`, and a static relative import
//  of `../../simulation/*.mjs` (which lives OUTSIDE `server/`) gets its
//  depth mangled by the bundler — e.g. `../../simulation/order.mjs` becomes
//  `../../../../../../../../../simulation/order.mjs`, which resolves to
//  `D:\simulation\order.mjs` (NOT `D:\Applications\tm-trading\...`).
//  `pathToFileURL(join(process.cwd(), ...))` + `@vite-ignore` sidesteps that.
// =============================================================================

export type { LiveAccount, LivePositionFields } from '../../types/positions'

/** Quote shape accepted by the enrichment (mirrors simulation normalizeQuote). */
export interface LiveQuote {
  bid?: number | null
  ask?: number | null
  last?: number | null
  /** Epoch ms — quoteStore rows store it as `eventTime`; map before calling. */
  time?: number | null
}

/**
 * Enrich ONE open position with live numbers priced off a current quote.
 * Null quote / unusable doc -> every field null (fail-soft, never a guess).
 */
export async function enrichPosition(
  item: PositionItem,
  quote: LiveQuote | null | undefined,
  model: any = null,
): Promise<LivePositionFields> {
  const empty: LivePositionFields = {
    mark: null,
    unrealized: null,
    unrealizedPct: null,
    liqPrice: null,
    marginUsed: null,
    leverage: null,
  }
  if (!quote) return empty
  if (item.status !== 'open') return empty

  const [engine, fill, margin, liquidation] = await Promise.all([
    simulationEngine(),
    simulationFill(),
    simulationMargin(),
    simulationLiquidation(),
  ])
  const m = model ?? margin.MARGIN_DEFAULTS
  const f = fill.FILL_DEFAULTS

  const out = { ...empty }
  const mark = engine.markUnrealized(item, quote, f)
  if (mark.ok) {
    out.mark = typeof mark.markPrice === 'number' ? mark.markPrice : null
    out.unrealized = typeof mark.net === 'number' ? mark.net : null
    out.unrealizedPct = typeof mark.pnlPct === 'number' ? mark.pnlPct : null
  }

  const lp = liquidation.liquidationPrice(item, m)
  if (lp.ok) out.liqPrice = typeof lp.liqPrice === 'number' ? lp.liqPrice : null

  const marginUsed = margin.initialMarginFor(item, m)
  if (marginUsed !== null) out.marginUsed = marginUsed

  const lev = margin.leverageOf(m)
  if (lev.ok) out.leverage = lev.leverage

  return out
}

export interface SummarizeArgs {
  /** Starting / config equity (risk gate `equity`). */
  base: number
  /** OPEN PositionItems only. */
  items: PositionItem[]
  /** Per-symbol current quote (plane rows mapped to LiveQuote). */
  quoteFor?: (symbol: string) => LiveQuote | null
  model?: any
}

/**
 * Account portrait (§20) from the open positions + live quotes:
 * locked initial margin, free margin, utilization, net unrealized, and the
 * maintenance floor (cross-style liq check). All nulls are honest: a legacy
 * doc without a usable qty/entry is skipped, it never corrupts the totals.
 */
export async function summarizeLive({ base, items, quoteFor = () => null, model = null }: SummarizeArgs): Promise<LiveAccount> {
  const eq = Number(base)
  const usable = Number.isFinite(eq) ? eq : 0

  const [engine, fill, margin] = await Promise.all([
    simulationEngine(),
    simulationFill(),
    simulationMargin(),
  ])
  const m = model ?? margin.MARGIN_DEFAULTS
  const f = fill.FILL_DEFAULTS

  let notional = 0
  let notionalUsable = false
  let unrealized = 0
  for (const p of items) {
    const n = margin.positionNotional(p)
    if (n !== null) { notional += n; notionalUsable = true }
    const quote = quoteFor(p.symbol)
    if (quote) {
      const mark = engine.markUnrealized(p, quote, f)
      if (mark.ok) unrealized += Number(mark.net) || 0
    }
  }

  const health = margin.accountMarginHealth({ equity: usable, positions: items, model: m })

  return {
    equity: usable,
    notional: notionalUsable ? Math.round(notional * 1e8) / 1e8 : null,
    marginUsed: health.ok ? health.marginUsed : 0,
    freeMargin: health.ok ? health.freeMargin : 0,
    utilizationPct: health.ok ? health.utilizationPct : 0,
    unrealized: Math.round(unrealized * 1e8) / 1e8,
    maintenance: health.ok ? health.maintenance : 0,
    liquidated: health.ok ? health.liquidated : false,
    openPositions: items.filter((p) => p.status === 'open').length,
  }
}