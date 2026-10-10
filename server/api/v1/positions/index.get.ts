import { getQuery } from 'h3'
import { listPositions } from '../../../utils/positions'
import { enrichPosition, type LiveQuote } from '../../../utils/livePositions'
import { paperAccount } from '../../../utils/paperAccount'
import { simulationMargin } from '../../../utils/engineModel'

/**
 * GET /api/v1/positions - vi the (paper / MT5 / san / tay) - collection `positions`.
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Chi DOC
 * engine model (D1); Mongo khong ket noi duoc tra 200 + meta.mongo='down'.
 *
 * Roadmap v3 §19/§20: OPEN rows carry `live` (mark / unrealized / liq / margin /
 * leverage) and `meta.account` (locked margin, free, utilization, net unrealized),
 * computed server-side off CURRENT plane quotes + stored docs through the SAME
 * simulation core the executor uses (D21/D25). Any missing quote / unknown doc
 * stays null — never a fabricated number (D12). Mongo or plane down -> the
 * base read still returns, just without live fields.
 *
 * Query: ?limit=&cursor=&status=(open|closed|cancelled)&symbol=&source=&account=
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 50, 200)
  const query = getQuery(event)

  const { items, total, open, closed, realizedPnlAbs, mongo } = await listPositions({
    limit,
    cursor,
    status: query.status ? String(query.status) : undefined,
    symbol: query.symbol ? String(query.symbol) : undefined,
    source: query.source ? String(query.source) : undefined,
    account: query.account ? String(query.account) : undefined
  })

  // Live numbers (v3 §19/§20): best-effort, never blocking. Plane rows carry
  // { bid, ask, last, eventTime } — map eventTime -> time for the fill model.
  let quoteFor: (symbol: string) => LiveQuote | null = () => null
  try {
    const { getMarketPlane } = await import('../../../utils/market-plane')
    const plane = await getMarketPlane()
    const rows = plane.quoteStore.all() as Array<{
      symbol: string
      bid?: number
      ask?: number
      last?: number
      eventTime?: number
    }>
    const bySymbol = new Map<string, LiveQuote>()
    for (const r of rows) {
      bySymbol.set(r.symbol, {
        bid: typeof r.bid === 'number' ? r.bid : null,
        ask: typeof r.ask === 'number' ? r.ask : null,
        last: typeof r.last === 'number' ? r.last : null,
        time: typeof r.eventTime === 'number' ? r.eventTime : null
      })
    }
    if (bySymbol.size > 0) {
      quoteFor = (symbol: string) => bySymbol.get(symbol) ?? null
    }
  } catch { /* plane/config unavailable — keep base read fail-soft */ }

  const margin = await simulationMargin()
  const MARGIN_DEFAULTS = margin.MARGIN_DEFAULTS

  const data = items.map((p) =>
    p.status === 'open'
      ? { ...p, live: enrichPosition(p, quoteFor(p.symbol), MARGIN_DEFAULTS) }
      : p
  )

  const {
    data: paged,
    nextCursor
  } = cursorPage(data, limit, (item) => item.id)

  return {
    success: true,
    data: paged,
    nextCursor,
    meta: {
      total,
      open,
      closed,
      realizedPnlAbs,
      mongo,
      // §20 paper account: READ projection of the persisted positions (survives
      // refresh / reconnect / backend restart). Realized-based numbers never
      // need a quote; unrealized/margin are null when the plane is down.
      account: mongo === 'up' ? await paperAccount({
        account: query.account ? String(query.account) : undefined,
        quoteFor,
        model: MARGIN_DEFAULTS,
        now: Date.now()
      }) : null
    }
  }
})