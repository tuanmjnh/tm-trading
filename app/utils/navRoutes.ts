import type { RouteTreeNode } from '#shared/types/rbac'

/**
 * Collapsed sidebar menus render group children as a flat link list (popover),
 * so sub-groups deeper than one level would silently lose their descendants.
 * This dissolves groups into an ordered list of their leaf links.
 */
export function flattenNavGroups<T>(groups: unknown = []): T[] {
  const out: T[] = []
  if (!Array.isArray(groups)) return out
  for (const group of groups as Array<{ children?: unknown }>) {
    if (Array.isArray(group.children)) out.push(...(flattenNavGroups<T>(group.children) as T[]))
    else out.push(group as T)
  }
  return out
}

// =============================================================================
//  P0-5 — One shared loader for the Hub route catalog.
//
//  The nav plugin, the global auth middleware and `useNavMenu` all want the same
//  catalog at boot. Before this, the middleware awaited `fetchUser` and *then*
//  fetched the catalog, and the plugin warmed it separately — the same request
//  could be issued twice and the menu was gated on the whole chain.
//
//  A single in-flight promise collapses them: whoever asks first starts the
//  request, everyone else awaits the same one, and a cache hit resolves without
//  any round trip at all.
// =============================================================================

let inFlight: Promise<RouteTreeNode[]> | null = null

// A token that is present but already expired would only earn a 401, so the
// warm-up requires a *live* access token. When the access token has expired the
// refresh path (auth.fetchUser) runs first and the layout fetches the catalog
// afterwards — one extra round trip on an already-slow path, no failed request.
function accessTokenUsable(token: string | null | undefined): boolean {
  if (!token || !import.meta.client) return false
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof json?.exp !== 'number') return true
    return json.exp - Math.floor(Date.now() / 1000) > 5
  } catch {
    return false
  }
}

export function loadAllowedRoutes(options: { force?: boolean } = {}): Promise<RouteTreeNode[]> {
  const state = useState<RouteTreeNode[]>('nav:allowedRoutes', () => readNavCache())

  if (!options.force && state.value.length) return Promise.resolve(state.value)
  if (inFlight) return inFlight

  // `hubFetch` falls back to the cookie, so a live cookie token lets this run in
  // parallel with `auth.fetchUser()` instead of waiting for it.
  const auth = useAuth()
  const token = auth.accessToken.value || useCookie('accessToken').value
  if (!accessTokenUsable(token)) return Promise.resolve(state.value)

  const { hubFetch } = useHub()

  inFlight = (async () => {
    try {
      const { data } = await hubFetch<{ success: boolean, data: RouteTreeNode[] }>('/api/v1/auth/routes')
      state.value = data || []
      writeNavCache(state.value)
    } catch {
      // Fail-open: a menu fetch error is UX-only (the API enforces permissions
      // per request). Keep whatever catalog we already had on screen.
    } finally {
      inFlight = null
    }
    return state.value
  })()

  return inFlight
}
