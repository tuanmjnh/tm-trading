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
  '/',
  '/markets',
  '/trading',
  '/trading/signals',
  '/trading/positions',
  '/trading/accounts',
  '/test-center',
  '/test-center/runs',
  '/test-center/runs/compare',
  '/test-center/forward',
  '/test-center/replay',
  '/data-research/data',
  '/data-research/data/datasets',
  '/data-research/data/recordings',
  '/data-research/data/quality',
  '/data-research/data/lineage',
  '/data-research/journal',
  '/alerts/history',
  '/alerts/inbox',
  '/shared-resources',
  '/shared-resources/import',
  '/shared-resources/connections',
  '/shared-resources/queues',
  '/admin-system',
  '/admin-system/roles',
  '/admin-system/permissions',
  '/admin-system/routes',
  '/admin-system/configs',
  '/admin-system/logs',
  '/admin-system/profile',
  '/admin-system/docs',
  '/admin-system/settings',
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
