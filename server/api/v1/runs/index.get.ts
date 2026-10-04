import { getQuery } from 'h3'
import { loadRunSeries, toSeriesListItem } from '../../../utils/reports'

/**
 * GET /api/v1/runs - danh sach series backtest (moi bo tham so x symbol x TF).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Doc truc tiep
 * reports/*.ndjson, khong chay engine, khong tinh lai so (D1: so lieu qua
 * `summarizeRuns()` cua engine).
 */
export default defineEventHandler(async (event) => {
  const { limit, cursor } = getListParams(event, 20, 100)
  const query = getQuery(event)
  const symbol = query.symbol ? String(query.symbol) : undefined
  const method = query.method ? String(query.method) : undefined
  const tf = query.tf ? String(query.tf) : undefined

  const { series, filesMissing, skippedRuns, skippedTrades } = await loadRunSeries()

  let list = series
  if (symbol) list = list.filter(s => s.symbol === symbol)
  if (method) list = list.filter(s => s.method === method)
  if (tf) list = list.filter(s => s.tf === tf)

  let start = 0
  if (cursor) {
    const idx = list.findIndex(s => s.id === cursor)
    start = idx >= 0 ? idx + 1 : 0
  }
  const page = list.slice(start, start + limit)
  const nextCursor = start + limit < list.length
    ? (page[page.length - 1]?.id ?? null)
    : null

  return {
    success: true,
    data: page.map(toSeriesListItem),
    nextCursor,
    meta: { total: list.length, filesMissing, skippedRuns, skippedTrades }
  }
})
