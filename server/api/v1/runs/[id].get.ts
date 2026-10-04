import { buildSeriesId, loadRunSeries, parseSeriesId } from '../../../utils/reports'

/**
 * GET /api/v1/runs/:id - chi mot series: stamp phien ban (D1), tong hop va
 * danh sach lenh da khui trung.
 *
 * id = `engineVersion~symbol~tf~paramsHash` (xem utils/reports.ts).
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10).
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'id') ?? ''
  const parsed = parseSeriesId(rawId)
  if (!parsed) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: 'Invalid run id' })
  }

  const { series } = await loadRunSeries()
  // h3 co the tra param da decode hoac chua decode - tim ca 2 kieu cho chac.
  const canonical = buildSeriesId(parsed)
  const found = series.find(s => s.id === rawId) ?? series.find(s => s.id === canonical)
  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Run series not found' })
  }

  return { success: true, data: found }
})
