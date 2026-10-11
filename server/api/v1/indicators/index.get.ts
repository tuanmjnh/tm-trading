import { loadIndicatorCatalog } from '../../../utils/indicators'

/**
 * GET /api/v1/indicators - indicator catalog (roadmap §30.3).
 *
 * Meta only (id/version/kind/paramsSchema/warmup/outputs) from the CANONICAL
 * engine registry (engine/indicators.mjs, D1). The engine is the single source
 * of definitions and math; this just lists what can be computed.
 * Registry unavailable -> [] (fail-soft, never 500).
 */
export default defineEventHandler(async () => {
  const indicators = await loadIndicatorCatalog()
  return { success: true, data: indicators, meta: { count: indicators.length } }
})