// =============================================================================
//  Bot API types (roadmap §57.4 G/H, §58.6). A Bot Profile is reusable config
//  pointing at an immutable strategy version; a Bot Instance is one concrete
//  running/completed session. They are distinct entities — never collapse.
//
//  The dashboard reads these read-only from /api/v1/bots/* (fail-soft: an
//  unavailable store returns an empty list, never a 500).
// =============================================================================

export type BotProfileMode = 'BACKTEST' | 'REPLAY' | 'LIVE_ANALYSIS' | 'LIVE_PAPER'
export type BotProfileStatus = 'draft' | 'enabled' | 'disabled' | 'archived'

export interface BotProfile {
  _id: string
  profileId: string
  name: string
  description: string
  strategyVersionId: string | null
  mode: BotProfileMode
  instruments: string[]
  timeframes: string[]
  riskProfileId: string | null
  simulatedAccountId: string | null
  maxConcurrentPositions: number
  effectiveParamsHash: string | null
  enabled: boolean
  status: BotProfileStatus
  createdBy: string | null
  createdAt: number | null
  updatedAt: number
  schemaVersion: string
}

export type BotInstanceState =
  | 'queued' | 'starting' | 'running' | 'paused'
  | 'stopping' | 'completed' | 'failed' | 'halted'

export interface BotInstanceCounts {
  signals: number
  orders: number
  trades: number
}

export interface BotInstance {
  _id: string
  instanceId: string
  botProfileId: string | null
  strategyVersionId: string | null
  strategyFingerprint: string | null
  mode: BotProfileMode | string
  source: Record<string, unknown>
  instruments: string[]
  timeframes: string[]
  state: BotInstanceState
  startedAt: number | null
  stoppedAt: number | null
  lastEventAt: number | null
  eventLagMs: number | null
  counts: BotInstanceCounts
  paperEquity: number | null
  paperPnl: number | null
  riskState: Record<string, unknown>
  health: string
  lastError: string | null
  createdAt: number | null
  updatedAt: number
  schemaVersion: string
}

export interface BotProfilesResponse {
  success: boolean
  data: BotProfile[]
  meta: { count: number; mongo?: 'up' | 'down' }
}

export interface BotInstancesResponse {
  success: boolean
  data: BotInstance[]
  meta: { count: number; mongo?: 'up' | 'down' }
}
