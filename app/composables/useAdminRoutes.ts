import type { SystemRoute } from '~~/types'
import { buildRouteTree } from '#shared/utils/routeTree'

export const useAdminRoutes = () => {
  const tree = useState<SystemRoute[]>('admin:routes:tree', () => [])

  const list = useAdminList<SystemRoute>({
    limit: 50,
    stateKey: 'admin:routes',
    fetchPage: async ({ appId, cursor, limit }) => {
      const res = await adminFetch<{ success: boolean, data: { routes: SystemRoute[], tree: SystemRoute[] }, nextCursor: string | null }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/routes`,
        { query: { cursor: cursor || undefined, limit } }
      )
      tree.value = res.data?.tree || []
      return { items: res.data?.routes || [], nextCursor: res.nextCursor }
    }
  })

  const flat = list.items

  const syncTree = () => {
    list.items.value = [...list.items.value].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    tree.value = buildRouteTree(list.items.value)
  }

  const createRoute = async (appId: string, body: Partial<SystemRoute> & { id: string, path: string, name: string }) => {
    const res = await adminFetch<{ success: boolean, data: SystemRoute }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/routes`,
      { method: 'POST', body }
    )
    if (res.data && list.targetAppId.value === appId) {
      list.items.value = [...list.items.value, res.data]
      syncTree()
    }
    return res.data
  }

  const updateRoute = async (routeId: string, body: Partial<SystemRoute> & { parentId?: string | null }) => {
    const res = await adminFetch<{ success: boolean, data?: SystemRoute }>(
      `/api/v1/apps/${encodeURIComponent(list.targetAppId.value)}/routes`,
      { method: 'PUT', query: { id: routeId }, body }
    )
    const idx = list.items.value.findIndex(r => r.id === routeId)
    if (idx !== -1) {
      list.items.value[idx] = res.data
        ? res.data
        : ({ ...list.items.value[idx], ...body } as SystemRoute)
      syncTree()
    }
    return res.data
  }

  const deleteRoute = async (routeId: string) => {
    await adminFetch(`/api/v1/apps/${encodeURIComponent(list.targetAppId.value)}/routes`, {
      method: 'DELETE',
      query: { id: routeId }
    })
    list.items.value = list.items.value.filter(r => r.id !== routeId)
    syncTree()
  }

  const reorderRoutes = async (ordered: Array<{ id: string, sort: number, parentId?: string | null }>) => {
    await adminFetch(`/api/v1/apps/${encodeURIComponent(list.targetAppId.value)}/routes/reorder`, {
      method: 'POST',
      body: { ordered }
    })

    const updates = new Map(ordered.map(o => [o.id, o]))
    list.items.value = list.items.value.map((r) => {
      const u = updates.get(r.id)
      if (!u) return r
      return {
        ...r,
        sort: u.sort,
        parentId: u.parentId !== undefined ? (u.parentId || null) : r.parentId
      }
    })
    syncTree()
  }

  return {
    flat,
    tree,
    nextCursor: list.nextCursor,
    hasMore: list.hasMore,
    loading: list.loading,
    initialLoading: list.initialLoading,
    targetAppId: list.targetAppId,
    load: list.load,
    refresh: list.refresh,
    loadMore: list.loadMore,
    setApp: list.setApp,
    createRoute,
    updateRoute,
    deleteRoute,
    reorderRoutes
  }
}
