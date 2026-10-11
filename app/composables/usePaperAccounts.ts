import type { LiveAccount } from '~~/types/positions'
import type { RiskStatusData, RiskStatusResponse } from '~~/types/risk'

// =============================================================================
//  usePaperAccounts — persistent paper account + risk gate projections
//  (roadmap §20, §21, §30.5). Server derives every number from persisted
//  positions via the shared simulation core (D1); the dashboard only formats.
//  Fail-soft to null like the other data composables (D12 — never fabricate).
// =============================================================================

export interface PaperAccountSummary {
  accountId: string
  currency: string
  mode: string
  initialBalance: number
  createdAt: string | null
  updatedAt: string
}

interface PaperAccountListResponse {
  success: boolean
  data: PaperAccountSummary[]
  meta: { count: number, mongo: 'up' | 'down' }
}

interface PaperAccountDetailResponse {
  success: boolean
  data: LiveAccount | null
  meta: { mongo: 'up' | 'down' }
}

export const usePaperAccounts = () => {
  async function accounts(): Promise<{ items: PaperAccountSummary[], mongo: 'up' | 'down' }> {
    try {
      const res = await $fetch<PaperAccountListResponse>('/api/v1/paper/accounts')
      return { items: res.success ? res.data : [], mongo: res.meta?.mongo ?? 'down' }
    } catch {
      return { items: [], mongo: 'down' }
    }
  }

  async function account(id = 'default'): Promise<LiveAccount | null> {
    try {
      const res = await $fetch<PaperAccountDetailResponse>(`/api/v1/paper/accounts/${encodeURIComponent(id)}`)
      return res.success ? res.data : null
    } catch {
      return null
    }
  }

  async function riskStatus(): Promise<RiskStatusData | null> {
    try {
      const res = await $fetch<RiskStatusResponse>('/api/v1/risk/status')
      return res.success ? res.data : null
    } catch {
      return null
    }
  }

  return { accounts, account, riskStatus }
}
