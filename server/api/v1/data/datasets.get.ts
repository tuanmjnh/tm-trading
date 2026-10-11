import { getQuery } from 'h3'
import { listDatasets } from '../../../utils/dataCenter'

/**
 * GET /api/v1/data/datasets — the §23.4 dataset retention manifest (Slice 4).
 * Query: ?kind=&symbol=&source=&timeframe=&q=&limit=
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const { data, mongo } = await listDatasets({
    kind: q.kind ? String(q.kind) : undefined,
    symbol: q.symbol ? String(q.symbol) : undefined,
    source: q.source ? String(q.source) : undefined,
    timeframe: q.timeframe ? String(q.timeframe) : undefined,
    q: q.q ? String(q.q) : undefined,
    limit: q.limit ? Number(q.limit) : undefined
  })
  return { success: true, data, meta: { count: data.length, mongo } }
})
