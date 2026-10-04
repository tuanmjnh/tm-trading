export type PermissionAction = 'read' | 'create' | 'update' | 'delete' | 'export' | 'import' | 'manage'
export type PermissionScope = 'own' | 'team' | 'app' | 'global'

export interface Permission {
  id: string
  appId: string
  name: string
  description: string
  module: string
  action: PermissionAction
  scope: PermissionScope
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

export interface PermissionCreateInput {
  name: string
  description: string
  module: string
  action: PermissionAction
  scope: PermissionScope
}

export interface PermissionUpdateInput {
  name?: string
  description?: string
  scope?: PermissionScope
}

export interface RolePermission {
  roleId: string
  permissionId: string
  grantedAt: Date
  grantedBy: string
}

export interface UserPermission {
  userId: string
  appId: string
  permissionId: string
  grantedAt: Date
  grantedBy: string
  expiresAt?: Date
}

export interface PermissionMatrix {
  roles: Array<{
    roleId: string
    roleName: string
    permissions: string[]
  }>
  permissions: Array<{
    permissionId: string
    permissionName: string
    module: string
    action: PermissionAction
    scope: PermissionScope
    roles: string[]
  }>
}

export interface PermissionCheckRequest {
  permissions: string[]
  scope?: PermissionScope
  resourceOwnerId?: string
}

export interface PermissionCheckResponse {
  allowed: boolean
  results: Array<{
    permission: string
    allowed: boolean
    reason?: string
  }>
}

export interface PermissionCheckResult {
  permission: string
  allowed: boolean
  reason?: string
}