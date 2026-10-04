import type { AuthUser } from '~/types/auth'
import type { Role, ModulePermission } from '~/types/rbac'
import type { SystemRoute } from '~/types/rbac'

export interface AdminListState<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  loading: boolean
}

export function useAdminList<T>(options: {
  fetchPage: (params: { appId: string, cursor: string | null, limit: number, q?: string }) => Promise<{ items: T[], nextCursor: string | null }>
  limit?: number
  /** When provided, list state (items/cursor/targetAppId/...) is shared app-wide via useState so every composable instance (page + modals) reads/writes the same data. */
  stateKey?: string
}) {
  const state = <U>(ns: string, init: () => U): Ref<U> =>
    options.stateKey
      ? useState<U>(`${options.stateKey}:${ns}`, init)
      : (ref(init()) as Ref<U>)

  const items = state<T[]>('items', () => [])
  const nextCursor = state<string | null>('nextCursor', () => null)
  const hasMore = state<boolean>('hasMore', () => true)
  const loading = state<boolean>('loading', () => false)
  const initialLoading = state<boolean>('initialLoading', () => false)
  const targetAppId = state<string>('targetAppId', () => '')
  const searchQuery = ref('')

  const load = async (reset = false) => {
    if (loading.value) return
    if (!reset && !hasMore.value) return
    if (!targetAppId.value) return

    loading.value = true
    if (reset) {
      initialLoading.value = true
      items.value = []
      nextCursor.value = null
      hasMore.value = true
    }

    try {
      const res = await options.fetchPage({
        appId: targetAppId.value,
        cursor: reset ? null : nextCursor.value,
        limit: options.limit ?? 20,
        q: searchQuery.value.trim() || undefined
      })
      const itemKey = (i: T) => (i as any).id ?? (i as any)._id ?? (i as any).key
      const existing = new Set(items.value.map(itemKey).filter(Boolean))
      const newItems = res.items.filter(i => {
        const k = itemKey(i)
        return !k || !existing.has(k)
      })
      items.value = reset ? res.items : [...items.value, ...newItems]
      nextCursor.value = res.nextCursor
      hasMore.value = !!res.nextCursor
    } catch (err) {
      if (reset) {
        items.value = []
        nextCursor.value = null
        hasMore.value = false
      }
      throw err
    } finally {
      loading.value = false
      initialLoading.value = false
    }
  }

  const refresh = () => load(true)
  const loadMore = () => load(false)

  const setApp = async (appId: string) => {
    if (targetAppId.value === appId) return
    targetAppId.value = appId
    await load(true)
  }

  return { items, nextCursor, hasMore, loading, initialLoading, searchQuery, targetAppId, load, refresh, loadMore, setApp }
}

export async function adminFetch<T>(path: string, options?: any): Promise<T> {
  const { hubFetch } = useHub()
  return hubFetch<T>(path, options)
}
