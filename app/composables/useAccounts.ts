import type { AccountItem } from '~~/types/accounts'

// =============================================================================
//  Accounts API (Nitro internal route — no tm-hub hop). Fail-soft: Mongo down
//  still returns 200 with an empty list + meta.mongo='down'.
// =============================================================================

export interface AccountsListResponse {
  success: boolean
  data: AccountItem[]
  meta: { total: number; mongo: 'up' | 'down' }
}

export const useAccounts = () => {
  async function list(): Promise<{
    items: AccountItem[]
    meta: AccountsListResponse['meta'] | null
  }> {
    const res = await $fetch<AccountsListResponse>('/api/v1/accounts')
    return {
      items: res.data ?? [],
      meta: res.meta ?? null
    }
  }

  return { list }
}
