import type { PaperAccountDetail, PaperAccountsListResponse, PaperAccountDetailResponse, PaperAccountSummary } from '~~/types/paper'
import type { PositionItem, PositionsListResponse } from '~~/types/positions'

// =============================================================================
//  useForwardTests — the Forward test monitor data source (§58.9 Slice 3).
//
//  A forward test IS a sustained live-paper session, so this reads the existing
//  §30.5 paper-account API (the single source of truth) rather than inventing a
//  parallel store. Everything is fail-soft: a down store yields empty data +
//  `mongo: 'down'`, never a thrown error in the UI.
// =============================================================================

export interface ForwardAccount {
  account: PaperAccountSummary
  detail: PaperAccountDetail | null
}

export const useForwardTests = () => {
  async function listAccounts(): Promise<{ items: PaperAccountSummary[]; mongo: 'up' | 'down' }> {
    try {
      const res = await $fetch<PaperAccountsListResponse>('/api/v1/paper/accounts')
      return { items: res.data ?? [], mongo: res.meta?.mongo ?? 'down' }
    } catch {
      return { items: [], mongo: 'down' }
    }
  }

  async function accountDetail(id: string): Promise<PaperAccountDetail | null> {
    try {
      const res = await $fetch<PaperAccountDetailResponse>(
        `/api/v1/paper/accounts/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function positions(
    id: string,
    opts: { limit?: number; status?: string } = {}
  ): Promise<{ items: PositionItem[]; total: number; mongo: 'up' | 'down' }> {
    try {
      const res = await $fetch<PositionsListResponse>(
        `/api/v1/paper/accounts/${encodeURIComponent(id)}/positions`,
        { params: { limit: opts.limit, status: opts.status } }
      )
      return { items: res.data ?? [], total: res.meta?.total ?? 0, mongo: res.meta?.mongo ?? 'down' }
    } catch {
      return { items: [], total: 0, mongo: 'down' }
    }
  }

  return { listAccounts, accountDetail, positions }
}
