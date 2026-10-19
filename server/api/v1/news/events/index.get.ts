// GET /api/v1/news/events — normalized market events (V3.5 §60 Slice C).
// One event, many source items, all retained with provenance. Read-only.
import { listMarketEvents } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const status = String(query.status || '')
  const corroboration = String(query.corroboration || '')
  return listMarketEvents({
    limit: Number(query.limit || 50),
    marketGroup: query.group ? String(query.group) : undefined,
    status: status === 'active' || status === 'corrected' || status === 'retracted' ? status : undefined,
    corroboration:
      corroboration === 'single_source' || corroboration === 'multi_source' || corroboration === 'contradicted'
        ? corroboration
        : undefined,
    symbol: query.symbol ? String(query.symbol) : undefined,
  })
})
