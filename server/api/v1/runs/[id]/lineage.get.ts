import { getRouterParam } from 'h3'
import { buildSeriesId, parseSeriesId } from '../../../../utils/reports'
import { strategyProfileModel, strategyVersionModel } from '../../../../utils/engineModel'
import {
  buildLineageRows,
  lineageStrategyIds,
  type LeanProfileRow,
  type LeanVersionRow,
} from '../../../../utils/lineage'

// =============================================================================
//  GET /api/v1/runs/:id/lineage — reverse run -> strategy-version traceability
//  (roadmap §58.9 Slice 3). StrategyVersion.backtestRunId/holdoutRunId are the
//  forward version -> run pointer; this endpoint reads the REVERSE: which
//  versions cite this run as backtest/holdout evidence. Read-only; fail-soft
//  (store down -> 200 with an empty list, never 500).
//
//  Shape + join rules live in server/utils/lineage.ts (unit-tested offline);
//  this handler only parses the id, resolves models, and reads rows (D1).
//
//  id = `engineVersion~symbol~tf~paramsHash` (same format as GET /runs/:id).
// =============================================================================

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const rawId = getRouterParam(event, 'id') ?? ''
  const parsed = parseSeriesId(rawId)
  if (!parsed) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: 'Invalid run id' })
  }
  const canonical = buildSeriesId(parsed)

  const Version = await strategyVersionModel()
  if (!Version) return { success: true, data: [], meta: { count: 0, mongo: 'down' } }

  const own = ownerId ? { ownerId } : {}
  try {
    const rows = await Version.find({
      $or: [{ backtestRunId: canonical }, { holdoutRunId: canonical }],
      ...own,
    }).sort({ createdAt: -1 }).limit(50).lean() as unknown as LeanVersionRow[]

    // Profile display names are cosmetic — a missing profile must not break lineage.
    const profiles: Record<string, { name: string | null, status: string | null }> = {}
    const strategyIds = lineageStrategyIds(rows)
    if (strategyIds.length) {
      const Profile = await strategyProfileModel()
      if (Profile) {
        const found = await Profile.find({ _id: { $in: strategyIds }, ...own }).lean() as unknown as LeanProfileRow[]
        for (const p of found) profiles[p._id] = { name: p.name ?? null, status: p.status ?? null }
      }
    }

    const data = buildLineageRows(rows, canonical, profiles)
    return { success: true, data, meta: { count: data.length, mongo: 'up' } }
  } catch {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }
})
