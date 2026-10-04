import type { RouteTreeNode } from '~/types/rbac'

const PUBLIC_PATHS = new Set(['/login', '/register'])

/**
 * Route membership check.
 * Matches URL path with nav routes (exact, param pattern, or prefix).
 */
function navAllows(navPath: string, urlPath: string): boolean {
  if (!navPath || navPath.startsWith('#')) return false
  if (navPath === '*') return true
  if (navPath === '/') return urlPath === '/'

  const navSegs = navPath.replace(/\/+$/, '').split('/')
  const urlSegs = urlPath.replace(/\/+$/, '').split('/')

  if (navSegs.length === urlSegs.length) {
    let ok = true
    for (let i = 0; i < navSegs.length; i++) {
      const seg = navSegs[i] ?? ''
      if (seg.startsWith(':') && seg.length > 1) continue
      if (seg !== (urlSegs[i] ?? '')) { ok = false; break }
    }
    if (ok) return true
  }

  const prefix = navPath.replace(/\/+$/, '')
  return urlPath === prefix || urlPath.startsWith(`${prefix}/`)
}

/** Flatten RouteTreeNode[] into flat paths for membership validation. */
function flattenPaths(nodes: RouteTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: RouteTreeNode[]) => {
    for (const n of list) {
      out.push(n.path)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const path = to.path.replace(/\/+$/, '') || '/'
  if (PUBLIC_PATHS.has(path)) return

  const auth = useAuth()

  if (!auth.isAuthenticated.value) {
    const token = useCookie('accessToken').value
    const refresh = useCookie('refreshToken').value
    if (!token && !refresh) {
      return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    }
    // Hydrate user on hard reload before checking membership.
    // Shared auth state - layout does not need to refetch.
    try { await auth.fetchUser() } catch { /* ignore — fallthrough */ }
    if (!auth.isAuthenticated.value) {
      return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    }
  }

  // Home route always passes membership check to prevent redirect loops.
  if (path === '/') return

  try {
    // Do not use useNavMenu() here - it calls useI18n() which throws outside component setup.
    // Read state and fetch directly.
    const allowedRoutes = useState<RouteTreeNode[]>('nav:allowedRoutes', () => [])
    let accessible = allowedRoutes.value
    if (!accessible.length) {
      const { hubFetch } = useHub()
      const { data } = await hubFetch<{ success: boolean, data: RouteTreeNode[] }>('/api/v1/auth/routes')
      accessible = data || []
      allowedRoutes.value = accessible
    }
    const paths = flattenPaths(accessible)
    if (paths.length > 0 && !paths.some(p => navAllows(p, path))) {
      return navigateTo({ path: '/' })
    }
  } catch {
    // Fail-open: menu fetch error is UX-only - API enforces permissions per-request
  }
})
