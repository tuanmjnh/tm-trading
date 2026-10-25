// types/strategy.ts — Strategy Profile & Version types (roadmap §26.1/§26.2 + §29/§30.4)

export const STRATEGY_VERSION_STATES = Object.freeze([
  'draft', 'backtest', 'holdout', 'paper', 'stable_paper', 'archived',
])

export const PROFILE_STATUSES = Object.freeze(['draft', 'active', 'paused', 'retired'])

export const VERSION_STATES = STRATEGY_VERSION_STATES

export type StrategyVersionState = typeof STRATEGY_VERSION_STATES[number]
export type ProfileStatus = typeof PROFILE_STATUSES[number]

export interface StrategyProfile {
  _id: string
  profileId: string
  name: string
  status: ProfileStatus
  strategyVersionId: string | null
  instruments: string[]
  timeframes: string[]
  riskProfileId: string | null
  history: Array<{ from: string | null; to: string; at: number; by: string | null }>
  createdAt: number | null
  updatedAt: number
  schemaVersion: string
}

export interface StrategyVersion {
  _id: string
  strategyVersionId: string
  strategyId: string
  version: string
  engineVersion: string | null
  paramsHash: string
  referenceHash: string | null
  indicatorVersions: Record<string, string>
  methodVersions: Record<string, string>
  parameters: Record<string, unknown>
  supersedes: string | null
  changes: Array<{ parameter: string; from: unknown; to: unknown }>
  status: StrategyVersionState
  backtestRunId: string | null
  holdoutRunId: string | null
  acceptedExperimentId: string | null
  paperTrades: number | null
  history: Array<{ from: string; to: string; at: number; by: string | null }>
  createdBy: string | null
  createdAt: number | null
  updatedAt: number
  fingerprint: string | null
  schemaVersion: string
}

export interface CreateStrategyVersionInput {
  strategyId: string
  version: string
  paramsHash: string
  engineVersion?: string | null
  indicatorVersions?: Record<string, string>
  methodVersions?: Record<string, string>
  parameters?: Record<string, unknown>
  supersedes?: string | null
  createdBy?: string | null
}

export interface PromoteVersionInput {
  evidence?: Record<string, unknown>
  by?: string | null
}

export interface PlanNewVersionInput {
  strategyVersionId: string
  changes: Array<{ parameter: string; from: unknown; to: unknown }>
  bump?: 'major' | 'minor' | 'patch'
  engineVersion?: string | null
  createdBy?: string | null
}

export interface ActivatePaperInput {
  profileId: string
  strategyVersionId: string
  by?: string | null
}

export interface CreateProfileInput {
  profileId: string
  name: string
  status: ProfileStatus
  strategyVersionId?: string | null
  instruments?: string[]
  timeframes?: string[]
  riskProfileId?: string | null
}

export interface StrategyListResponse {
  success: boolean
  data: StrategyProfile[]
  meta: { count: number }
}

export interface StrategyDetailResponse {
  success: boolean
  data: StrategyProfile
}

export interface VersionsListResponse {
  success: boolean
  data: StrategyVersion[]
  meta: { count: number }
}

export interface VersionDetailResponse {
  success: boolean
  data: StrategyVersion
}

export interface VersionPlanResponse {
  ok: boolean
  baseVersion?: string
  candidateVersionId?: string
  nextVersion?: string
  newParamsHash?: string
  engineVersion?: string | null
  parameters?: Record<string, unknown>
  changes?: Array<{ parameter: string; from: unknown; to: unknown }>
  refused?: Array<{ parameter: string | null; expected: unknown; actual: unknown; reason: string }>
  supersedes?: string
  createdBy?: string | null
  code?: string
  detail?: string
}

export interface ActivateResponse {
  ok: boolean
  code: string
  profileId?: string
  strategyVersionId?: string
  detail?: string
}

/** Return type for createVersion. */
export interface CreateVersionResult {
  ok: boolean
  code: string
  version: StrategyVersion | null
  replay?: boolean
  detail?: string
}

/** Return type for promoteVersion. */
export interface PromoteVersionResult {
  ok: boolean
  code: string
  version: StrategyVersion | null
  missing?: string[]
}

/** Return type for activatePaper. */
export interface ActivatePaperResult {
  ok: boolean
  code: string
  profileId?: string
  strategyVersionId?: string
  detail?: string
}

/** Return type for planNewVersion. */
export interface PlanNewVersionResult {
  ok: boolean
  baseVersion?: string
  candidateVersionId?: string
  nextVersion?: string
  newParamsHash?: string
  engineVersion?: string | null
  parameters?: Record<string, unknown>
  changes?: Array<{ parameter: string; from: unknown; to: unknown }>
  refused?: Array<{ parameter: string | null; expected: unknown; actual: unknown; reason: string }>
  supersedes?: string
  createdBy?: string | null
  code?: string
  detail?: string
}