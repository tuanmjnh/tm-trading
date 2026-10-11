import { listRecordings } from '../../../utils/dataCenter'

/**
 * GET /api/v1/data/recordings — recorded rows grouped by venue (Slice 4).
 * Covers `candles` (OHLCV bars) and the `market_feed` ledger (funding, ...).
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async () => {
  const { data, mongo } = await listRecordings()
  return { success: true, data, meta: { count: data.length, mongo } }
})
