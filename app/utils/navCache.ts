import type { RouteTreeNode } from '~/types/rbac'

// =============================================================================
//  P0-4 — Sidebar catalog cache.
//
//  The Hub route catalog is fetched on every hard reload, so the menu could not
//  paint until a round trip finished. Persisting it lets `plugins/nav.client.ts`
//  hydrate the state before the first navigation and refresh in the background.
//
//  The entry is versioned and short-lived (6h) so a catalog the Hub changed can
//  never shadow the menu for long; the auth middleware still verifies the current
//  user against whatever catalog is on screen, and a signed-out session clears it.
// =============================================================================

const NAV_CACHE_KEY = 'tm-nav-routes:v1'
const NAV_CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface NavCachePayload {
  ts: number
  routes: RouteTreeNode[]
}

// The store is THE dependency (not the build target), so a browser, a server
// import and a plain Node test all take a correct path.
function navStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readPayload(): NavCachePayload | null {
  const store = navStore()
  if (!store) return null
  try {
    const raw = store.getItem(NAV_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as NavCachePayload
    if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.routes)) return null
    return parsed
  } catch {
    return null
  }
}

/** Cached catalog, or `[]` when absent/expired. Expired entries are evicted. */
export function readNavCache(): RouteTreeNode[] {
  const payload = readPayload()
  if (!payload) return []
  if (Date.now() - payload.ts > NAV_CACHE_TTL_MS) {
    navStore()?.removeItem(NAV_CACHE_KEY)
    return []
  }
  return payload.routes
}

/** True when there is nothing usable to hydrate the menu from. */
export function isNavCacheStale(): boolean {
  return readNavCache().length === 0
}

/** Best-effort write; an empty catalog is never cached (it means a failed fetch). */
export function writeNavCache(routes: RouteTreeNode[]): void {
  if (!routes.length) return
  try {
    navStore()?.setItem(NAV_CACHE_KEY, JSON.stringify({ ts: Date.now(), routes }))
  } catch {
    /* quota exceeded / private mode — the cache is an optimisation, not a source of truth */
  }
}

export function clearNavCache(): void {
  navStore()?.removeItem(NAV_CACHE_KEY)
}
