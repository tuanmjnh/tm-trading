// =============================================================================
//  Pure run -> strategy-version lineage shaping (roadmap §58.9 Slice 3).
//  Extracted from server/api/v1/runs/[id]/lineage.get.ts so the mapping + join
//  rules are unit-testable offline (tests/lineage.test.ts) — the endpoint only
//  resolves the model and reads rows; every shape/fallback rule lives here.
//  No engine/Mongo import: models are injected as plain lean rows.
// =============================================================================

export interface LeanVersionRow {
  _id: string
  strategyVersionId?: string
  strategyId?: string
  version?: string
  status?: string
  engineVersion?: string | null
  paramsHash?: string
  backtestRunId?: string | null
  holdoutRunId?: string | null
  createdAt?: number | null
}

export interface LeanProfileRow {
  _id: string
  name?: string
  status?: string
}

export interface LineageRow {
  strategyVersionId: string
  strategyId: string | null
  version: string | null
  status: string | null
  engineVersion: string | null
  paramsHash: string | null
  backtest: boolean
  holdout: boolean
  profileName: string | null
  profileStatus: string | null
  createdAt: number | null
}

/** Distinct, non-empty strategy ids referenced by the version rows (join key). */
export function lineageStrategyIds(rows: readonly LeanVersionRow[]): string[] {
  return [...new Set(rows.map(r => r.strategyId).filter((v): v is string => Boolean(v)))]
}

/**
 * Shape version rows into LineageRow[], resolving profile display names from a
 * pre-fetched id -> profile map. Profile names are COSMETIC: a missing profile
 * must never break lineage (name/status fall back to null).
 */
export function buildLineageRows(
  rows: readonly LeanVersionRow[],
  canonicalRunId: string,
  profiles: Record<string, { name: string | null; status: string | null }> = {},
): LineageRow[] {
  return rows.map(r => ({
    strategyVersionId: r.strategyVersionId ?? r._id,
    strategyId: r.strategyId ?? null,
    version: r.version ?? null,
    status: r.status ?? null,
    engineVersion: r.engineVersion ?? null,
    paramsHash: r.paramsHash ?? null,
    backtest: r.backtestRunId === canonicalRunId,
    holdout: r.holdoutRunId === canonicalRunId,
    profileName: profiles[r.strategyId ?? '']?.name ?? null,
    profileStatus: profiles[r.strategyId ?? '']?.status ?? null,
    createdAt: r.createdAt ?? null,
  }))
}
