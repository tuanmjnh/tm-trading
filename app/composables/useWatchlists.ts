import type { WatchlistItem, WatchlistListResponse, WatchlistResponse } from '#shared/types/watchlist'

// =============================================================================
//  useWatchlists — client for the server-persisted watchlists (S8 chunk 1).
//
//  Reads are fail-soft (a down store returns [] so the UI shows an empty state,
//  never a stack trace — D12). Writes THROW, because a refused create/rename/
//  delete must surface its policy code to the operator.
//
//  The trading panel reads the DEFAULT list from here; the Lists tab on
//  /watchlist manages the rest. localStorage `tm-term:v1` is only a seed/fallback
//  during migration (handled server-side in seedDefaultWatchlist).
// =============================================================================

export function useWatchlists() {
  const lists = ref<WatchlistItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchLists() {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<WatchlistListResponse>('/api/v1/watchlists', { method: 'GET' }).catch(() => null)
      lists.value = res?.data ?? []
    } catch {
      lists.value = []
      error.value = 'Failed to load watchlists'
    } finally {
      loading.value = false
    }
  }

  async function fetchList(id: string): Promise<WatchlistItem | null> {
    try {
      const res = await $fetch<WatchlistResponse>(`/api/v1/watchlists/${id}`, { method: 'GET' })
      return res?.data ?? null
    } catch {
      return null
    }
  }

  async function createList(name: string, symbols?: string[]): Promise<WatchlistItem> {
    const res = await $fetch<WatchlistResponse>('/api/v1/watchlists', {
      method: 'POST',
      body: { name, symbols }
    })
    await fetchLists()
    return res.data
  }

  async function renameList(id: string, name: string): Promise<WatchlistItem> {
    const res = await $fetch<WatchlistResponse>(`/api/v1/watchlists/${id}`, {
      method: 'PATCH',
      body: { name }
    })
    await fetchLists()
    return res.data
  }

  async function updateSymbols(id: string, symbols: string[]): Promise<WatchlistItem> {
    const res = await $fetch<WatchlistResponse>(`/api/v1/watchlists/${id}`, {
      method: 'PATCH',
      body: { symbols }
    })
    await fetchLists()
    return res.data
  }

  async function deleteList(id: string): Promise<void> {
    await $fetch(`/api/v1/watchlists/${id}`, { method: 'DELETE' })
    await fetchLists()
  }

  async function seedDefault(symbols: readonly string[]): Promise<void> {
    await $fetch('/api/v1/watchlists/seed', {
      method: 'POST',
      body: { symbols: [...symbols] }
    })
    await fetchLists()
  }

  async function addSymbol(id: string, symbol: string): Promise<WatchlistItem | null> {
    const res = await $fetch<WatchlistResponse>(`/api/v1/watchlists/${id}/symbols`, {
      method: 'POST',
      body: { symbol }
    })
    await fetchLists()
    return res.data
  }

  async function removeSymbol(id: string, symbol: string): Promise<WatchlistItem | null> {
    const res = await $fetch<WatchlistResponse>(`/api/v1/watchlists/${id}/symbols/${symbol}`, {
      method: 'DELETE'
    })
    await fetchLists()
    return res.data
  }

  /** The default list (the one the trading panel shows). */
  const defaultList = computed(() => lists.value.find((l) => l.isDefault) ?? lists.value[0] ?? null)

  return {
    lists,
    loading,
    error,
    defaultList,
    fetchLists,
    fetchList,
    createList,
    renameList,
    updateSymbols,
    deleteList,
    seedDefault,
    addSymbol,
    removeSymbol
  }
}