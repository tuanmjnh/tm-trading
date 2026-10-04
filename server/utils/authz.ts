import { CAPABILITIES, type Capability, SYSTEM_CAPABILITIES } from './permissions'
import { requireAuthPayload, type AuthPayload } from './request'

export function hasCapability(payload: AuthPayload, capability: Capability): boolean {
  if (!payload) return false

  const perms = payload.permissions || []
  
  if (perms.includes('*')) return true
  if (perms.includes(capability)) return true

  // Dual-read window (ARCHITECTURE §41 Phase 0.5): legacy grants still satisfy renamed capabilities
  for (const legacy of perms) {
    if (LEGACY_PERMISSION_ALIASES[legacy]?.includes(capability)) return true
  }

  return false
}

/** Legacy grant (pre-v1.2 codes) -> new capabilities that it satisfies */
const LEGACY_PERMISSION_ALIASES: Record<string, string[]> = {
  'media.write': ['media.upload'],
  'users.manage': ['users.create', 'users.update', 'users.delete'],
  'logs.read': ['apps.logs.read']
}

export function hasAnyCapability(payload: AuthPayload, capabilities: Capability[]): boolean {
  return capabilities.some(c => hasCapability(payload, c))
}

export function hasAllCapabilities(payload: AuthPayload, capabilities: Capability[]): boolean {
  return capabilities.every(c => hasCapability(payload, c))
}

export function canAccessApp(payload: AuthPayload, targetAppId: string): boolean {
  if (!payload) return false

  const perms = payload.permissions || []
  
  if (perms.includes('*')) return true
  if (payload.appId === targetAppId) return true

  return false
}

export function isSystemApp(payload: AuthPayload): boolean {
  return payload.appId === (useRuntimeConfig().public.hubAppId as string) && permsIncludeWildcard(payload.permissions)
}

function permsIncludeWildcard(perms: string[]): boolean {
  return (perms || []).includes('*')
}

export function getAppCapabilities(payload: AuthPayload): Capability[] {
  if (!payload) return []
  return (payload.permissions || []).filter(p => 
    SYSTEM_CAPABILITIES.includes(p as Capability)
  ) as Capability[]
}

export function canAccessAllApps(payload: AuthPayload): boolean {
  if (!payload) return false
  return (payload.permissions || []).includes('*')
}

export function requireCapability(payload: AuthPayload | undefined, capability: Capability): void {
  if (!hasCapability(payload!, capability)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.missingCapability',
      message: `Missing required capability: ${capability}`
    })
  }
}

export function isRoot(payload: AuthPayload | undefined): boolean {
  if (!payload) return false
  return (payload.permissions || []).includes('*') || (payload.roles || []).includes('root')
}

/** Hard delete (row delete in DB / external store) — root only. Admin may only toggle status / soft-delete. */
export function requireRoot(payload: AuthPayload | undefined): void {
  if (!isRoot(payload)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.notRoot',
      message: 'Only root can perform this action'
    })
  }
}

export function requireAppAccess(payload: AuthPayload | undefined, targetAppId: string): void {
  if (!canAccessApp(payload!, targetAppId)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.cannotAccessApp',
      message: `Access denied to application: ${targetAppId}`
    })
  }
}

export function requireSystemApp(payload: AuthPayload | undefined): void {
  if (!payload || payload.appId !== (useRuntimeConfig().public.hubAppId as string) || !(payload.permissions || []).includes('*')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.forbidden',
      message: 'System application access required'
    })
  }
}