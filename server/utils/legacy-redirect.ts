// =============================================================================
//  Legacy route redirect table (V3.3 §58.2 route re-home).
//
//  Pure data + matcher, kept free of Nuxt/Nitro globals so it can be unit-tested
//  without a runtime (tests/legacy-redirect.test.ts). The Nitro middleware in
//  server/middleware/legacy-redirect.ts applies these with a 301, preserving any
//  sub-path (dynamic ids) and the query string.
//
//  `/markets` is intentionally NOT redirected: the old explorer path and the new
//  markets index share the same URL, so the new page wins (docs/navigation-audit.md).
// =============================================================================

export interface LegacyRedirect {
  from: string
  to: string
  /**
   * Keep the remaining sub-path (default true). Set false when the whole subtree
   * is retired and every child must land on the same target (V5.0 execution UI).
   */
  keepRest?: boolean
}

export const LEGACY_REDIRECTS: ReadonlyArray<LegacyRedirect> = [
  // V5.0: the intel/scanner surfaces are Dashboard panels now.
  { from: '/intel', to: '/', keepRest: false },
  { from: '/scanner', to: '/', keepRest: false },
  { from: '/calendar', to: '/markets/calendar' },

  // V5.0 §9: the execution workspace (order entry, positions, paper accounts) is
  // retired from the active product. The page files stay in the tree for audit
  // and rollback, but no route reaches them. See docs/web-app/v5-route-migration-map.md.
  { from: '/trade', to: '/', keepRest: false },
  { from: '/trading', to: '/', keepRest: false },
  { from: '/signals', to: '/', keepRest: false },
  { from: '/paper', to: '/', keepRest: false },
  { from: '/orders', to: '/', keepRest: false },
  { from: '/positions', to: '/', keepRest: false },
  { from: '/accounts', to: '/', keepRest: false },

  // The Operations page is now the Control Center slideover.
  { from: '/operations', to: '/?panel=control&section=services', keepRest: false },

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

  // `/utilities/text` was the old Text-tool page; its new home is the Tools index
  // (`/tools`). This exact rule MUST precede the generic `/utilities` prefix rule,
  // which would otherwise rewrite it to the non-existent `/tools/text`.
  { from: '/utilities/text', to: '/tools' },
  { from: '/utilities', to: '/tools' }
]

/** Matches `path` against a legacy prefix on a path-segment boundary. */
export function matchLegacy(path: string): { to: string, rest: string } | null {
  for (const { from, to, keepRest } of LEGACY_REDIRECTS) {
    if (path === from) return { to, rest: '' }
    if (path.startsWith(`${from}/`)) return { to, rest: keepRest === false ? '' : path.slice(from.length) }
  }
  return null
}
