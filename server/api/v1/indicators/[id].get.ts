import { getRouterParam } from 'h3'
import { loadIndicator } from '../../../utils/indicators'

/**
 * GET /api/v1/indicators/:id - one indicator definition (roadmap §30.3).
 *
 * Returns the same meta shape as the catalog plus `def` flag; unknown id or
 * unavailable registry -> 404 (matches runs/:id convention). The definition
 * body itself lives ONLY in engine/indicators.mjs (D1).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const def = await loadIndicator(id)

  if (!def) {
    throw createError({
      statusCode: 404,
      statusMessage: 'error.notFound',
      message: `Indicator not found: ${id}`
    })
  }

  return {
    success: true,
    data: {
      id: def.id,
      version: def.version,
      kind: def.kind,
      paramsSchema: def.paramsSchema,
      warmup: def.warmup,
      outputs: def.outputs
    }
  }
})