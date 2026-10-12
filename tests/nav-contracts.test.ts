import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Compatibility contract (V3.3 §58.2): every route seeded as a *visible* leaf in
 * `createTradingRoutes` must resolve to an actual page file, otherwise the sidebar
 * links to a 404. This list mirrors the visible leaves of the target IA; update it
 * together with the seed when a hidden route is flipped on. Paths were re-homed under
 * menu-matching folders (see docs/navigation-audit.md); legacy paths 301-redirect.
 */
const EXPECTED_VISIBLE_LEAF_PATHS = [
  // 1. Overview
  '/',
  // 2. Markets
  '/markets',
  '/markets/explorer',
  '/markets/scanner',
  '/markets/calendar',
  // 3. Trading
  '/trading',
  '/trading/signals',
  '/trading/paper',
  '/trading/orders',
  '/trading/positions',
  '/trading/accounts',
  // 4. Strategy Lab
  '/strategy-lab',
  '/strategy-lab/indicators',
  '/strategy-lab/methods',
  '/strategy-lab/bots',
  '/strategy-lab/bots/instances',
  // 5. Test Center
  '/test-center',
  '/test-center/runs',
  '/test-center/runs/compare',
  '/test-center/forward',
  '/test-center/replay',
  // 6. Data & Research
  '/data-research/data',
  '/data-research/data/datasets',
  '/data-research/data/recordings',
  '/data-research/data/quality',
  '/data-research/data/lineage',
  '/data-research/research',
  '/data-research/research/experiments',
  '/data-research/journal',
  // 7. Alerts & Notifications
  '/alerts',
  '/alerts/history',
  '/alerts/inbox',
  // 8. Shared Resources
  '/shared-resources',
  '/shared-resources/import',
  '/shared-resources/connections',
  '/shared-resources/queues',
  // 9. Administration & System
  '/admin-system',
  '/admin-system/roles',
  '/admin-system/permissions',
  '/admin-system/routes',
  '/admin-system/configs',
  '/admin-system/data-sources',
  '/admin-system/health',
  '/admin-system/logs',
  '/admin-system/profile',
  '/admin-system/docs',
  '/admin-system/settings',
  // Secondary Tools
  '/tools',
  '/tools/icons',
  '/tools/encode',
  '/tools/random',
  '/tools/editor'
]

const PAGES_DIR = join(process.cwd(), 'app', 'pages')

/** Resolves a Nuxt route path to its candidate page files under app/pages. */
function pageCandidates(routePath: string): string[] {
  const segments = routePath.split('/').filter(Boolean)
  if (segments.length === 0) return [join(PAGES_DIR, 'index.vue')]
  const base = join(PAGES_DIR, ...segments)
  return [`${base}.vue`, join(base, 'index.vue')]
}

describe('navigation contracts — visible routes resolve to a page', () => {
  for (const path of EXPECTED_VISIBLE_LEAF_PATHS) {
    test(`${path} has a page file`, () => {
      const candidates = pageCandidates(path)
      assert.ok(
        candidates.some(existsSync),
        `no page found for ${path}; checked ${candidates.join(', ')}`
      )
    })
  }
})
