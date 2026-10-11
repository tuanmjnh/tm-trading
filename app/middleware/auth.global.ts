import type { RouteTreeNode } from '~/types/rbac'
import { flattenVisiblePaths, navAllows } from '~/utils/navTree'

const PUBLIC_PATHS = new Set(['/login', '/register'])

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
    const paths = flattenVisiblePaths(accessible)
    if (paths.length > 0 && !paths.some(p => navAllows(p, path))) {
      return navigateTo({ path: '/' })
    }
  } catch {
    // Fail-open: menu fetch error is UX-only - API enforces permissions per-request
  }
})
