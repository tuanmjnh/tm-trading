import { getQuery } from 'h3'
import { listDatasetQuality, qualityCounts } from '../../../utils/dataCenter'

/**
 * GET /api/v1/data/quality — coverage/gap/staleness verdict per dataset (Slice 4).
 * Derived from the manifest's measured start/end/count (D12) — never guessed.
 * Query: ?kind=&symbol=&source=&timeframe=&q=&limit=
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const { data, mongo } = await listDatasetQuality({
    kind: q.kind ? String(q.kind) : undefined,
    symbol: q.symbol ? String(q.symbol) : undefined,
    source: q.source ? String(q.source) : undefined,
    timeframe: q.timeframe ? String(q.timeframe) : undefined,
    q: q.q ? String(q.q) : undefined,
    limit: q.limit ? Number(q.limit) : undefined
  })
  return { success: true, data, meta: { count: data.length, mongo, ...qualityCounts(data) } }
})
