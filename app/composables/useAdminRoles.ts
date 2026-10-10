import type { Role, ModulePermission, RouteTreeNode } from '~/types/rbac'

export const useAdminRoles = () => {
  const list = useAdminList<Role>({
    limit: 50,
    stateKey: 'admin:roles',
    fetchPage: async ({ appId, cursor, limit }) => {
      const res = await adminFetch<{ success: boolean, data: Role[], nextCursor: string | null }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/roles`,
        { query: { cursor: cursor || undefined, limit } }
      )
      return { items: res.data || [], nextCursor: res.nextCursor }
    }
  })

  const routes = ref<RouteTreeNode[]>([])
  const routeTree = ref<RouteTreeNode[]>([])
  const mutating = ref(false)

  const fetchRoutes = async (appId: string) => {
    const res = await adminFetch<{ success: boolean, data: { routes: RouteTreeNode[], tree: RouteTreeNode[] } }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/routes`
    )
    routes.value = res.data?.routes || []
    routeTree.value = res.data?.tree || []
  }

  const createRole = async (appId: string, body: { name: string, description?: string, permissions?: ModulePermission[], allowedRoutes?: string[] }) => {
    mutating.value = true
    try {
      const res = await adminFetch<{ success: boolean, data: Role }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/roles`,
        { method: 'POST', body }
      )
      if (res.data && list.targetAppId.value === appId) list.items.value.push(res.data)
      return res.data
    } finally {
      mutating.value = false
    }
  }

  const updateRole = async (appId: string, roleId: string, body: Partial<Pick<Role, 'name' | 'description' | 'permissions' | 'allowedRoutes'>>) => {
    mutating.value = true
    try {
      const res = await adminFetch<{ success: boolean, data: Role }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/roles`,
        { method: 'PUT', query: { id: roleId }, body }
      )
      const idx = list.items.value.findIndex(r => r.id === roleId)
      if (idx !== -1 && res.data) list.items.value[idx] = res.data
      return res.data
    } finally {
      mutating.value = false
    }
  }

  const deleteRole = async (appId: string, roleIds: string[]) => {
    mutating.value = true
    try {
      await adminFetch(`/api/v1/apps/${encodeURIComponent(appId)}/roles`, {
        method: 'DELETE',
        query: { id: roleIds.join(',') }
      })
      list.items.value = list.items.value.filter(r => !roleIds.includes(r.id))
    } finally {
      mutating.value = false
    }
  }

  return { ...list, routes, routeTree, mutating, fetchRoutes, createRole, updateRole, deleteRole }
}
