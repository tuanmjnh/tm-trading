export interface App {
  id: string
  name: string
  description?: string
  secretKey: string
  allowedOrigins: string[]
  isActive: boolean
  isPinned: boolean
  isSystem?: boolean
  sort: number
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  email: string
  username?: string
  name: string
  avatarUrl?: string
  isSuperAdmin: boolean
  createdAt: string
  updatedAt: string
}

export interface ModulePermission {
  module: string
  actions: ('read' | 'create' | 'update' | 'write' | 'delete' | 'send' | 'manage' | 'rotateSecret' | '*')[]
}

export interface Role {
  id: string
  appId: string
  name: string
  description?: string
  permissions: ModulePermission[]
  allowedRoutes: string[]
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface SystemRoute {
  id: string
  appId: string
  path: string
  name: string
  label: string
  icon?: string
  sort: number
  isVisible: boolean
  parentId?: string | null
  isDeleted?: boolean
  /** Phase 3 (ARCHITECTURE §5): required permission to access this route - null = unrestricted */
  requiredPermission?: string | null
  children?: SystemRoute[]
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
    username?: string | null
    appId: string
    roles: string[]
    permissions: string[]
    allowedRoutes: string[]
  }
}

export interface AppConfigItem {
  id?: string
  appId: string
  category?: string
  key: string
  value: string
  isSecret?: boolean
  isPublic?: boolean
  description?: string
  updatedAt?: string
}

export interface InAppNotification {
  id: string
  appId: string
  userId: string
  title: string
  body: string
  icon?: string
  url?: string
  isRead: boolean
  createdAt: string
}
