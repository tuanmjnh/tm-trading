import { useStorage } from '@vueuse/core'

// =============================================================================
//  useAccountScope — the account the terminal is currently looking at
//  (roadmap §61.17 Phase B "account CRUD/switching", §61.5 one trading context).
//
//  One persisted value (`tm-account:v1`): the selected `accountId`, or null for
//  "all of my accounts". Orders / positions / fills read it to scope their
//  default view; the account switcher writes it. Null is the honest default —
//  an owner with no books yet filters nothing rather than inventing an account.
// =============================================================================

export const ACCOUNT_SCOPE_KEY = 'tm-account:v1'

export const useAccountScope = () => {
  const account = useStorage<string | null>(ACCOUNT_SCOPE_KEY, null)

  const setAccount = (id: string | null): void => {
    account.value = id && id.trim() ? id.trim() : null
  }

  return { account, setAccount }
}
