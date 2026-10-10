import { engineModel, simulationAccount } from './engineModel'
import type { LiveAccount } from '../../types/positions'
import type { LiveQuote } from './livePositions'

/**
 * §20 paper account view for the dashboard — READ-ONLY projection.
 *
 * Balance / realized / daily / drawdown are DERIVED from the persisted position
 * docs through the pure simulation core (simulation/account.mjs) — the account
 * survives refresh / reconnect / backend restart without changing history.
 * `initialBalance` is the seed the executor froze at first activity
 * (engine/models/account.mjs), falling back to RISK_EQUITY. Mongo or plane
 * down => null, the route keeps the base read fail-soft (D12).
 */
export interface PaperAccountArgs {
  account?: string
  quoteFor?: (symbol: string) => LiveQuote | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: any
  now?: number
}

export async function paperAccount(args: PaperAccountArgs = {}): Promise<LiveAccount | null> {
  const { account = 'default', quoteFor = () => null, model, now = Date.now() } = args
  const [Position, Account, sim] = await Promise.all([
    engineModel('position.mjs', 'Position'),
    engineModel('account.mjs', 'PaperAccount'),
    simulationAccount()
  ])
  if (!Position || !sim) return null
  try {
    const [seed, positions] = Account
      ? await Promise.all([
          Account.findOne({ accountId: account }).lean(),
          Position.find({ account }).sort({ entryTime: -1 }).limit(5000).lean()
        ])
      : [null, await Position.find({ account }).sort({ entryTime: -1 }).limit(5000).lean()]

    const fallback = Number(process.env.RISK_EQUITY)
    const base = Number(seed?.initialBalance ?? fallback) > 0
      ? Number(seed?.initialBalance ?? fallback)
      : 10000

    const view = sim.accountProjection({ accountId: account, base, positions, quoteFor, model, now })
    return {
      equity: view.equity,
      notional: view.notional,
      marginUsed: view.marginUsed,
      freeMargin: view.availableBalance,
      utilizationPct: view.utilizationPct,
      unrealized: view.unrealized,
      maintenance: view.maintenance,
      liquidated: view.liquidated,
      openPositions: view.openPositions,
      accountId: account,
      mode: view.mode as 'LIVE_PAPER' | 'REPLAY',
      currency: view.currency,
      initialBalance: view.initialBalance,
      balance: view.balance,
      realizedPnl: view.realizedPnl,
      availableBalance: view.availableBalance,
      dailyPnl: view.dailyPnl,
      maxDrawdown: view.maxDrawdown,
      maxDrawdownPct: view.maxDrawdownPct,
      drawdownBasis: view.drawdownBasis as 'realized',
      createdAt: seed?.createdAt instanceof Date ? seed.createdAt.toISOString() : null,
      updatedAt: view.updatedAt
    } satisfies LiveAccount
  } catch {
    return null
  }
}