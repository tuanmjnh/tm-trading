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
}

export const LEGACY_REDIRECTS: ReadonlyArray<LegacyRedirect> = [
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

  // `/utilities/text` was the old Text-tool page; its new home is the Tools index
  // (`/tools`). This exact rule MUST precede the generic `/utilities` prefix rule,
  // which would otherwise rewrite it to the non-existent `/tools/text`.
  { from: '/utilities/text', to: '/tools' },
  { from: '/utilities', to: '/tools' }
]

/** Matches `path` against a legacy prefix on a path-segment boundary. */
export function matchLegacy(path: string): { to: string, rest: string } | null {
  for (const { from, to } of LEGACY_REDIRECTS) {
    if (path === from) return { to, rest: '' }
    if (path.startsWith(`${from}/`)) return { to, rest: path.slice(from.length) }
  }
  return null
}
