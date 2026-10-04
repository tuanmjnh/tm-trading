import type { Permission, PermissionScope } from '#server/types/permission'
import type { Role, ModulePermission } from '~/types/rbac'
import { adminFetch } from '~/composables/useAdminList'

export interface PermissionRow {
  id: string
  code: string
  name: string
  description: string | null
  module: string
  action: string
  scope: PermissionScope
  isSystem: boolean
  roles: string[]
}

export interface MatrixRole {
  roleId: string
  roleName: string
  permissions: string[]
}

export interface MatrixPermission {
  permissionId: string
  permissionName: string
  module: string
  action: string
  scope: PermissionScope
  roles: string[]
}

export interface PermissionMatrix {
  roles: MatrixRole[]
  permissions: MatrixPermission[]
}

export interface CreatePermissionInput {
  name: string
  description: string
  module: string
  action: string
  scope: PermissionScope
}

export interface UpdatePermissionInput {
  name?: string
  description?: string
  scope?: PermissionScope
}

export type { PermissionScope }

const MODULE_ACTIONS: Record<string, string[]> = {
  apps: ['read', 'create', 'update', 'delete', 'manage', 'rotateSecret', 'logs.read'],
  configs: ['read', 'write'],
  connections: ['read', 'write'],
  imports: ['read', 'write'],
  media: ['read', 'upload', 'delete'],
  notifications: ['read', 'send', 'manage'],
  mail: ['send', 'manage', 'analytics.read'],
  users: ['read', 'create', 'update', 'delete', 'export', 'import'],
  roles: ['read', 'manage'],
  routes: ['read', 'manage'],
  permissions: ['read', 'create', 'update', 'delete', 'manage'],
  platform: ['apps.manage', 'crossapp.read', 'crossapp.write', 'audit.read'],
}

const SCOPES: PermissionScope[] = ['own', 'team', 'app', 'global']

export const usePermissions = (appId: string) => {
  const items = ref<PermissionRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const loadPermissions = async () => {
    if (!appId) return
    loading.value = true
    error.value = null
    try {
      const res = await adminFetch<{ success: boolean, data: Permission[] }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/permissions`
      )
      items.value = (res.data || []).map(mapPermission)
    } catch (err: any) {
      error.value = err.message || 'Failed to load permissions'
      items.value = []
    } finally {
      loading.value = false
    }
  }

  const createPermission = async (input: CreatePermissionInput) => {
    const res = await adminFetch<{ success: boolean, data: Permission }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/permissions`,
      { method: 'POST', body: input }
    )
    if (res.data) {
      items.value.push(mapPermission(res.data))
    }
    return res.data
  }

  const updatePermission = async (id: string, input: UpdatePermissionInput) => {
    const res = await adminFetch<{ success: boolean, data: Permission }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/permissions/${encodeURIComponent(id)}`,
      { method: 'PUT', body: input }
    )
    if (res.data) {
      const idx = items.value.findIndex(p => p.id === id)
      if (idx !== -1) items.value[idx] = mapPermission(res.data)
    }
    return res.data
  }

  const deletePermission = async (id: string) => {
    await adminFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/permissions/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    items.value = items.value.filter(p => p.id !== id)
  }

  const getModuleActions = (module: string) => MODULE_ACTIONS[module] || ['read', 'create', 'update', 'delete', 'manage']
  const getScopes = () => SCOPES
  const getAllModules = () => Object.keys(MODULE_ACTIONS)

  return {
    items,
    loading,
    error,
    loadPermissions,
    createPermission,
    updatePermission,
    deletePermission,
    getModuleActions,
    getScopes,
    getAllModules,
  }
}

export const usePermissionMatrix = (appId: string) => {
  const matrix = ref<PermissionMatrix | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const loadMatrix = async () => {
    if (!appId) return
    loading.value = true
    error.value = null
    try {
      const res = await adminFetch<{ success: boolean, data: PermissionMatrix }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/permissions/matrix`
      )
      matrix.value = res.data || { roles: [], permissions: [] }
    } catch (err: any) {
      error.value = err.message || 'Failed to load permission matrix'
      matrix.value = { roles: [], permissions: [] }
    } finally {
      loading.value = false
    }
  }

  const saveMatrix = async (updates: { roleId: string; permissionId: string; checked: boolean }[]) => {
    if (!appId) return
    saving.value = true
    error.value = null
    try {
      for (const update of updates) {
        if (update.checked) {
          await adminFetch(
            `/api/v1/apps/${encodeURIComponent(appId)}/roles/${encodeURIComponent(update.roleId)}/permissions`,
            { method: 'POST', body: { permissionIds: [update.permissionId] } }
          )
        } else {
          await adminFetch(
            `/api/v1/apps/${encodeURIComponent(appId)}/roles/${encodeURIComponent(update.roleId)}/permissions/${encodeURIComponent(update.permissionId)}`,
            { method: 'DELETE' }
          )
        }
      }
      await loadMatrix()
    } catch (err: any) {
      error.value = err.message || 'Failed to save permission matrix'
      await loadMatrix()
      throw err
    } finally {
      saving.value = false
    }
  }

  const assignToRole = async (roleId: string, permissionId: string) => {
    await adminFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/roles/${encodeURIComponent(roleId)}/permissions`,
      { method: 'POST', body: { permissionIds: [permissionId] } }
    )
    if (matrix.value) {
      const perm = matrix.value.permissions.find(p => p.permissionId === permissionId)
      if (perm && !perm.roles.includes(roleId)) {
        perm.roles.push(roleId)
      }
    }
  }

  const removeFromRole = async (roleId: string, permissionId: string) => {
    await adminFetch(
      `/api/v1/apps/${encodeURIComponent(appId)}/roles/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: 'DELETE' }
    )
    if (matrix.value) {
      const perm = matrix.value.permissions.find(p => p.permissionId === permissionId)
      if (perm) {
        perm.roles = perm.roles.filter(r => r !== roleId)
      }
    }
  }

  const toggleRolePermission = async (roleId: string, permissionId: string, checked: boolean) => {
    if (checked) {
      await assignToRole(roleId, permissionId)
    } else {
      await removeFromRole(roleId, permissionId)
    }
  }

  const isPermissionInRole = (roleId: string, permissionId: string) => {
    return matrix.value?.permissions.find(p => p.permissionId === permissionId)?.roles.includes(roleId) ?? false
  }

  const getRolePermissions = (roleId: string) => {
    return matrix.value?.roles.find(r => r.roleId === roleId)?.permissions ?? []
  }

  return {
    matrix,
    loading,
    saving,
    error,
    loadMatrix,
    saveMatrix,
    assignToRole,
    removeFromRole,
    toggleRolePermission,
    isPermissionInRole,
    getRolePermissions,
  }
}

function mapPermission(p: Permission): PermissionRow {
  return {
    id: p.id,
    code: p.name,
    name: p.name,
    description: p.description,
    module: p.module,
    action: p.action,
    scope: p.scope,
    isSystem: p.isSystem,
    roles: [],
  }
}