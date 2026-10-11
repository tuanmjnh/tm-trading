// =============================================================================
//  Legacy route redirects (V3.3 §58.2 route re-home).
//
//  The trading sidebar IA moved every page under menu-matching folders (see
//  docs/navigation-audit.md). This middleware keeps old bookmarks/links working
//  by 301-redirecting the legacy paths to their new locations, preserving any
//  sub-path (dynamic ids) and the query string.
//
//  Implemented as Nitro middleware rather than `routeRules.redirect` because
//  route rules cannot re-emit a captured dynamic segment (e.g. `/runs/:id`).
//
//  `/markets` is intentionally NOT redirected: the old explorer path and the new
//  markets index share the same URL, so the new page wins.
// =============================================================================

const LEGACY_REDIRECTS: ReadonlyArray<{ from: string, to: string }> = [
  { from: '/intel', to: '/markets' },
  { from: '/scanner', to: '/markets/scanner' },
  { from: '/calendar', to: '/markets/calendar' },

  { from: '/trade', to: '/trading' },
  { from: '/signals', to: '/trading/signals' },
  { from: '/paper', to: '/trading/paper' },
  { from: '/orders', to: '/trading/orders' },
  { from: '/positions', to: '/trading/positions' },
  { from: '/accounts', to: '/trading/accounts' },

  { from: '/strategies', to: '/strategy-lab' },
  { from: '/indicators', to: '/strategy-lab/indicators' },
  { from: '/methods', to: '/strategy-lab/methods' },
  { from: '/bots', to: '/strategy-lab/bots' },

  { from: '/lab/new', to: '/test-center' },
  { from: '/runs', to: '/test-center/runs' },
  { from: '/forward-tests', to: '/test-center/forward' },
  { from: '/replay', to: '/test-center/replay' },

  { from: '/data', to: '/data-research/data' },
  { from: '/research', to: '/data-research/research' },
  { from: '/journal', to: '/data-research/journal' },

  { from: '/resources/notifications', to: '/alerts/history' },
  { from: '/resources/inbox', to: '/alerts/inbox' },
  { from: '/resources/media', to: '/shared-resources' },
  { from: '/resources', to: '/shared-resources' },

  { from: '/administration/users', to: '/admin-system' },
  { from: '/administration', to: '/admin-system' },

  { from: '/system', to: '/admin-system' },
  { from: '/health', to: '/admin-system/health' },

  { from: '/utilities', to: '/tools' }
]

/** Matches `path` against a legacy prefix on a path-segment boundary. */
function matchLegacy(path: string): { to: string, rest: string } | null {
  for (const { from, to } of LEGACY_REDIRECTS) {
    if (path === from) return { to, rest: '' }
    if (path.startsWith(`${from}/`)) return { to, rest: path.slice(from.length) }
  }
  return null
}

export default defineEventHandler((event) => {
  const method = event.method
  if (method !== 'GET' && method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname

  // Never touch API, build assets, or files with an extension.
  if (path.startsWith('/api/') || path.startsWith('/_nuxt') || path.startsWith('/__nuxt')) return
  if (/\.[a-z0-9]+$/i.test(path)) return

  const match = matchLegacy(path)
  if (!match) return

  return sendRedirect(event, `${match.to}${match.rest}${url.search}`, 301)
})
