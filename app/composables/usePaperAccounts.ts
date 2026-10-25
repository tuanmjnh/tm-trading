import type { LiveAccount } from '#shared/types/positions'
import type { RiskStatusData, RiskStatusResponse } from '#shared/types/risk'

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
  /** Soft-removed: hidden from the switcher, skipped by the runtime. */
  archived: boolean
  createdAt: string | null
  updatedAt: string
}

/** Body for create / patch (§61.17 Phase B account CRUD). */
export interface PaperAccountPatch {
  accountId?: string
  archived?: boolean
  currency?: string
  initialBalance?: number
}

interface PaperAccountMutationResponse {
  success: boolean
  data: PaperAccountSummary
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

  /** Create a new (empty) paper account. Server rejects duplicates with 409. */
  async function create(patch: PaperAccountPatch & { accountId: string }): Promise<PaperAccountSummary> {
    const res = await $fetch<PaperAccountMutationResponse>('/api/v1/paper/accounts', {
      method: 'POST',
      body: patch
    })
    return res.data
  }

  /** Rename / archive / adjust the seed of an account. */
  async function update(accountId: string, patch: PaperAccountPatch): Promise<PaperAccountSummary> {
    const res = await $fetch<PaperAccountMutationResponse>(`/api/v1/paper/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      body: patch
    })
    return res.data
  }

  /** Remove an empty account (the server refuses one that still owns a book). */
  async function remove(accountId: string): Promise<void> {
    await $fetch(`/api/v1/paper/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })
  }

  return { accounts, account, riskStatus, create, update, remove }
}
