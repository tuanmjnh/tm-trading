import type {
  AiAgent,
  AiAgentAction,
  AiAgentActionsResponse,
  AiAgentDetail,
  AiAgentDetailResponse,
  AiAgentsListResponse,
  AiAgentsResponse,
  AiAgentsStatus,
  AiAgentValidation,
  AiAgentValidationResponse,
  AiPolicyLevel
} from '~~/types/ai'

// =============================================================================
//  useAiAgents — AI agent client (Slice B read-only observability + Slice D
//  governance).
//
//  Reads are fail-soft (a down store returns null/[] and the page shows an
//  empty state, never a stack trace). Writes THROW, because a refused lifecycle
//  or action request must surface its policy code to the operator — a blocked
//  action that fails silently would defeat the audit (§59.16).
// =============================================================================

export interface CreateAgentBody {
  name: string
  description?: string
  autonomy?: string
  accountId?: string
  instruments?: string[]
}

export interface PublishVersionBody {
  autonomy?: string
  model?: Record<string, unknown> | null
  prompts: { system: string }
  tools: string[]
  note?: string
}

export interface RiskIntegrationBody {
  passed: boolean
  tests: string[]
  evidence?: string
}

export const useAiAgents = () => {
  async function status(): Promise<AiAgentsStatus | null> {
    try {
      const res = await $fetch<AiAgentsResponse>('/api/v1/ai/agents')
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function agents(options: { state?: string; limit?: number } = {}): Promise<{ agents: AiAgent[]; policy: AiPolicyLevel[] }> {
    try {
      const res = await $fetch<AiAgentsListResponse>('/api/v1/ai-agents', {
        params: { limit: options.limit ?? 100, state: options.state || undefined }
      })
      return { agents: res.data ?? [], policy: res.meta?.policy ?? [] }
    } catch {
      return { agents: [], policy: [] }
    }
  }

  async function agent(id: string): Promise<AiAgentDetail | null> {
    try {
      const res = await $fetch<AiAgentDetailResponse>(`/api/v1/ai-agents/${encodeURIComponent(id)}`)
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function activity(id: string, limit = 50): Promise<AiAgentAction[]> {
    try {
      const res = await $fetch<AiAgentActionsResponse>(`/api/v1/ai-agents/${encodeURIComponent(id)}/activity`, {
        params: { limit }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function create(body: CreateAgentBody): Promise<AiAgent> {
    const res = await $fetch<{ success: boolean; data: AiAgent }>('/api/v1/ai-agents', { method: 'POST', body })
    return res.data
  }

  async function publishVersion(id: string, body: PublishVersionBody): Promise<AiAgentDetail | null> {
    await $fetch(`/api/v1/ai-agents/${encodeURIComponent(id)}/versions`, { method: 'POST', body })
    return agent(id)
  }

  async function validateVersion(id: string): Promise<AiAgentValidation> {
    const res = await $fetch<AiAgentValidationResponse>(`/api/v1/ai-agents/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      body: {}
    })
    return res.data
  }

  async function move(id: string, action: 'start' | 'pause' | 'resume' | 'disable'): Promise<AiAgent | null> {
    await $fetch(`/api/v1/ai-agents/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
    return agent(id).then(d => d?.agent ?? null)
  }

  async function recordRiskIntegration(id: string, body: RiskIntegrationBody): Promise<AiAgentDetail | null> {
    await $fetch(`/api/v1/ai-agents/${encodeURIComponent(id)}/risk-integration`, { method: 'POST', body })
    return agent(id)
  }

  return { status, agents, agent, activity, create, publishVersion, validateVersion, move, recordRiskIntegration }
}
