import { getRouterParam, readBody } from 'h3'
import { strategyService } from '../../../../utils/engineModel'
import type { CreateVersionResult } from '~~/types/strategy'

/**
 * POST /api/v1/strategies/:id/versions — create a new strategy version (§30.4).
 *
 * Body: {
 *   version: "1.4.0",
 *   paramsHash: "sha256...",
 *   engineVersion?: "0.9.0",
 *   indicatorVersions?: { "ema": "2.1" },
 *   methodVersions?: { "vsa": "3.0" },
 *   parameters?: { minRR: 1.5 },
 *   supersedes?: "tm-vsa@1.3.0",
 *   createdBy?: "user"
 * }
 */
export default defineEventHandler(async (event) => {
  const strategyId = getRouterParam(event, 'id')
  if (!strategyId) return { success: false, error: 'strategy id required' }

  const body = await readBody(event)
  const {
    version,
    paramsHash,
    engineVersion = null,
    indicatorVersions = {},
    methodVersions = {},
    parameters = {},
    supersedes = null,
    createdBy = null,
  } = body ?? {}

  if (!version || !paramsHash) {
    return { success: false, error: 'version and paramsHash are required' }
  }

  const { createVersion } = await strategyService()
  const r = await createVersion({
    strategyId,
    version,
    paramsHash,
    engineVersion,
    indicatorVersions,
    methodVersions,
    parameters,
    supersedes,
    createdBy,
    now: Date.now(),
  }) as CreateVersionResult

  if (!r.ok) return { success: false, error: r.code, detail: r.detail ?? null }
  return { success: true, data: r.version }
})