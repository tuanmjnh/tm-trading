import { getSupabaseAdmin } from '#server/modules/database/supabase'
import type { PermissionScope } from '#server/types/permission'

/**
 * RBAC scope enforcement (E.1.4 — own/team/app/global).
 *
 * Scope is an attribute of PERMISSION (catalog permissions.code -> scope column),
 * default 'app' preserves backward compatibility until updated by admin
 in permission management UI.
 *
 * 'team': treated as 'own' as a safe default.
 */

const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, team: 1, app: 2, global: 3 }
const VALID_SCOPES = new Set<string>(['own', 'team', 'app', 'global'])

interface ScopePayload {
  sub: string
  appId: string
  permissions?: string[]
}

interface CachedScope {
  scope: PermissionScope
  ts: number
}

const scopeCache = new Map<string, CachedScope>()
const SCOPE_TTL_MS = 60_000

/** Effective capability scope for app - cached 60s. */
export async function getCapabilityScope(appId: string, capability: string): Promise<PermissionScope> {
  const cacheKey = `${appId}:${capability}`
  const hit = scopeCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < SCOPE_TTL_MS) return hit.scope

  let scope: PermissionScope = 'app'
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('permissions')
      .select('scope, app_id')
      .eq('code', capability)
      .limit(10)

    if (!error && data?.length) {
      const row = data.find(r => r.app_id === appId) ?? data.find(r => !r.app_id) ?? data[0]
      if (row?.scope && VALID_SCOPES.has(row.scope)) scope = row.scope as PermissionScope
    }
  } catch {
    // fail-open: retain default 'app'
  }

  scopeCache.set(cacheKey, { scope, ts: Date.now() })
  return scope
}

export function invalidateScopeCache(): void {
  scopeCache.clear()
}

/** own/team -> restrict to user's own resources. */
export function isOwnScoped(scope: PermissionScope): boolean {
  return scope === 'own' || scope === 'team'
}

export function scopeRank(scope: PermissionScope): number {
  return SCOPE_RANK[scope] ?? SCOPE_RANK.app
}

/**
 * Assert scoped permission on a specific resource:
 * - root ('*') always passes
 * - scope app/global passes (app-access handled by requireAppAccess)
 * - scope own/team requires resourceOwnerId === payload.sub
 */
export async function assertScope(
  payload: ScopePayload,
  capability: string,
  opts?: { appId?: string; resourceOwnerId?: string }
): Promise<void> {
  if (payload.permissions?.includes('*')) return
  const appId = opts?.appId ?? payload.appId
  const scope = await getCapabilityScope(appId, capability)
  if (!isOwnScoped(scope)) return
  if (opts?.resourceOwnerId && opts.resourceOwnerId === payload.sub) return

  throw createError({
    statusCode: 403,
    statusMessage: 'error.insufficientScope',
    message: `Permission '${capability}' has scope '${scope}' — limited to your own resources`,
  })
}

/**
 * Filter for LIST endpoints: returns enforced userId (payload.sub) if scope own/team,
 * otherwise undefined (unrestricted). Root ('*') is unrestricted.
 */
export async function ownScopeFilter(
  payload: ScopePayload,
  capability: string,
  opts?: { appId?: string }
): Promise<string | undefined> {
  if (payload.permissions?.includes('*')) return undefined
  const appId = opts?.appId ?? payload.appId
  const scope = await getCapabilityScope(appId, capability)
  return isOwnScoped(scope) ? payload.sub : undefined
}
