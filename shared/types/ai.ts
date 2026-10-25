// =============================================================================
//  AI agent types (V3.4 Slice B observability + V3.5 §59.15 Slice D governance).
//
//  Slice B describes what exists at the gateway/output level. Slice D adds the
//  governed registry: agents, immutable versions, the autonomy ladder and the
//  append-only action ledger. The dashboard displays these; every decision is
//  made server-side by engine/agentPolicy.mjs.
// =============================================================================

export interface AiToolInfo {
  name: string
  description: string
}

export interface AiAgentsStatus {
  gateway: {
    provider: string
    model: string
    configured: boolean
  }
  tools: AiToolInfo[]
  counts: {
    proposals: number
    experiments: number
    agents: number
    blockedActions: number
  }
  mongo: 'up' | 'down'
}

export interface AiAgentsResponse {
  success: boolean
  data: AiAgentsStatus
}

export type AiAutonomyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4'

export type AiAgentState = 'draft' | 'validated' | 'active' | 'paused' | 'disabled'

export type AiAgentHealth = 'ok' | 'stale' | 'inactive' | 'unknown'

export type AiAgentActionType = 'advice' | 'proposal' | 'place-order' | 'cancel-order' | 'close-position'

/** One row of the server-side autonomy policy table. */
export interface AiPolicyLevel {
  level: AiAutonomyLevel
  label: string
  enabled: boolean
  maxAction: string | null
  tools: string[]
  requiresRiskIntegration: boolean
  reason: string | null
}

export interface AiAgent {
  _id: string
  agentId: string
  name: string
  description: string
  autonomy: AiAutonomyLevel
  accountId: string
  instruments: string[]
  state: AiAgentState
  activeVersionId: string | null
  versionCount: number
  startedAt: number | null
  disabledAt: number | null
  lastEventAt: number | null
  lastHeartbeatAt: number | null
  actionCounts: { allowed: number; blocked: number }
  createdBy: string | null
  createdAt?: string
  updatedAt?: string
  schemaVersion: string
}

export interface AiAgentVersion {
  versionId: string
  agentId: string
  version: number
  autonomy: AiAutonomyLevel
  model: Record<string, unknown> | null
  prompts: { system: string }
  tools: string[]
  policy: Record<string, unknown> | null
  riskIntegration: {
    passed: boolean
    at: number | null
    evidence: string | null
    tests: string[]
  }
  note: string
  hash: string
  immutable: boolean
  createdAt?: string
}

export interface AiAgentAction {
  actionId: string
  agentId: string
  agentVersionId: string | null
  autonomy: AiAutonomyLevel | null
  type: AiAgentActionType
  status: 'allowed' | 'blocked'
  code: string
  message: string
  sessionId: string | null
  idempotencyKey: string
  riskDecision: { ok: boolean | null; code: string | null; at: number | null; mongoDown: boolean | null } | null
  reason: string
  at: number | null
  createdAt?: string
}

export interface AiAgentDetail {
  agent: AiAgent
  activeVersion: AiAgentVersion | null
  versionIntegrity: { ok: boolean; code: string } | null
  health: AiAgentHealth
  policy: AiPolicyLevel | null
  versions: AiAgentVersion[]
  actions: AiAgentAction[]
  mongo: 'up' | 'down'
}

export interface AiAgentsListResponse {
  success: boolean
  data: AiAgent[]
  meta: { count: number; policy: AiPolicyLevel[] }
}

export interface AiAgentDetailResponse {
  success: boolean
  data: AiAgentDetail
}

export interface AiAgentActionsResponse {
  success: boolean
  data: AiAgentAction[]
  meta: { count: number }
}

export interface AiAgentValidation {
  ok: boolean
  versionId: string
  hash: string
  agentId: string
  autonomy: AiAutonomyLevel
  tools: string[]
  allowedTools: string[]
  riskIntegrationPassed: boolean
  errors: string[]
  /** Agent state after validation (a passing check promotes draft -> validated). */
  agentState: AiAgentState
  agentPromoted: boolean
}

export interface AiAgentValidationResponse {
  success: boolean
  data: AiAgentValidation
}
