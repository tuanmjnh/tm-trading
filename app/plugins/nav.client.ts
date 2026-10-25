import type { RouteTreeNode } from '#shared/types/rbac'
import { clearNavCache, isNavCacheStale, readNavCache } from '~/utils/navCache'
import { loadAllowedRoutes } from '~/utils/navRoutes'

// =============================================================================
//  P0-4 / P0-5 — Sidebar catalog: hydrate, refresh, and clear.
//
//  Runs before the auth middleware (plugins → middleware), so by the time the
//  middleware checks membership the catalog is already on screen from cache and
//  the network refresh is in flight. The middleware therefore never blocks the
//  first paint on a Hub round trip.
// =============================================================================
export default defineNuxtPlugin(() => {
  const auth = useAuth()
  const allowedRoutes = useState<RouteTreeNode[]>('nav:allowedRoutes', () => readNavCache())

  // A signed-out session must never leave the previous user's catalog (or its
  // cache entry) for the next sign-in on the same browser.
  watch(() => auth.user.value, (user) => {
    if (!user) {
      allowedRoutes.value = []
      clearNavCache()
    }
  })

  // Fire-and-forget warm-up; `loadAllowedRoutes` dedupes with the middleware and
  // resolves instantly from cache when the entry is still fresh.
  if (isNavCacheStale()) {
    void loadAllowedRoutes()
  }
})
