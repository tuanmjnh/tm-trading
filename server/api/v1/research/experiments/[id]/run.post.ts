import { createError, getRouterParam, readBody } from 'h3'
import { researchHttpError, runExperimentArm } from '../../../../../utils/research'

// =============================================================================
//  POST /api/v1/research/experiments/:id/run — run one arm (roadmap §28 / §30.7).
//
//  Body: { role, params?, method?, symbols?, timeframes?, market? }
//    role  required — baseline | candidate | random | holdout (ARM_NAMES, D1)
//    other fields scope the backtest; symbols/timeframes default to the
//    proposal's recommendedTest, else BTCUSDT/15m.
//
//  Metrics come from the SAME summarizeRuns() block as every other run (D1),
//  run through the engine's own backtest (engine/run.mjs runOne). Arm recording
//  is $setOnInsert (D4) — a crash-resumed run never silently upgrades a number.
//
//  Fail-soft: bad role -> 400; unknown experiment -> 404; Mongo down -> 503.
// =============================================================================

interface RunArmBody {
  role?: unknown
  params?: unknown
  method?: unknown
  symbols?: unknown
  timeframes?: unknown
  market?: unknown
}

function asStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return undefined
  return v.map((x) => String(x)).filter(Boolean)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'experiment id is required' })
  }

  const body = (await readBody(event).catch(() => null)) as RunArmBody | null
  const role = String(body?.role ?? '').trim()
  if (!role) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_role', message: 'role is required' })
  }

  const params = (body?.params && typeof body.params === 'object' && !Array.isArray(body.params))
    ? (body.params as Record<string, unknown>)
    : {}

  try {
    const data = await runExperimentArm(id, {
      role,
      params,
      method: body?.method ? String(body.method) : undefined,
      symbols: asStringArray(body?.symbols),
      timeframes: asStringArray(body?.timeframes),
      market: body?.market ? String(body.market) : undefined
    })
    return { success: true, data }
  } catch (err) {
    throw researchHttpError(err)
  }
})
