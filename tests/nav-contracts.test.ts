import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Compatibility contract: every route seeded as a *visible* leaf in
 * `createTradingRoutes` must resolve to an actual page file, otherwise the sidebar
 * links to a 404. This list mirrors the visible leaves of the V4.2 IA; update it
 * together with the seed when a hidden route is flipped on.
 *
 * A route that is a tab of a workspace (Discover, Watchlist, Intelligence, Alerts)
 * is seeded with `is_visible: false` and stays routable as a deep link, so it is
 * deliberately absent here. See docs/web-app/v4-route-migration-map.md.
 */
const EXPECTED_VISIBLE_LEAF_PATHS = [
  // 1. Overview
  '/',
  // 2. Operations
  '/operations',
  // 3. Discover (V4.2 S4b workspace shell) — `/markets`, `/markets/scanner` and
  //    `/markets/explorer` are tabs and stay routable as deep links; their nav rows
  //    are hidden in the seed, so they are not listed here.
  '/discover',
  // 4. Watchlist & Signals (V4.2 S4b) — `/trading/signals` + `/test-center/forward` are tabs.
  '/watchlist',
  // 5. Intelligence (V4.2 S4b) — `/news`, `/news/events`, `/markets/calendar` and
  //    `/outlook` are tabs. ('/news/sources' is hidden — V4.2 S4a, admin detail.)
  '/intelligence',
  // 6. Alerts (V4.2 S4c) — `/alerts/history` + `/alerts/inbox` are tabs.
  '/alerts',
  // 7. Advanced & Research (group `group_advanced`)
  // 7a. Trading
  '/trading',
  '/trading/paper',
  '/trading/orders',
  '/trading/positions',
  '/trading/accounts',
  // 7b. Strategy Lab
  '/strategy-lab',
  '/strategy-lab/indicators',
  '/strategy-lab/methods',
  '/strategy-lab/bots',
  // '/strategy-lab/bots/instances' — merged into /strategy-lab/bots (tabbed view)
  // 7c. Test Center
  '/test-center',
  '/test-center/runs',
  '/test-center/runs/compare',
  '/test-center/replay',
  '/sessions',
  // 7d. Data & Research (group `data_center`)
  '/data-research/data/datasets',
  '/data-research/data/recordings',
  '/data-research/data/quality',
  '/data-research/data/lineage',
  '/data-research/research',
  '/data-research/research/experiments',
  // '/data-research/research/news-impact' — V4.2 S4a: hidden (static shell, no data binding)
  '/data-research/journal',
  '/ai-agents',
  '/admin-system/ai-providers',
  // 8. Platform & Administration (group `group_admin_system`, incl. shared resources)
  '/shared-resources',
  '/shared-resources/import',
  '/shared-resources/connections',
  '/shared-resources/queues',
  '/admin-system',
  '/admin-system/roles',
  // '/admin-system/permissions' — hidden: permissions are edited from the role editor
  '/admin-system/routes',
  '/admin-system/configs',
  '/admin-system/data-sources',
  '/admin-system/health',
  '/admin-system/logs',
  '/admin-system/profile',
  '/admin-system/docs',
  '/admin-system/hub-integration',
  '/admin-system/settings',
  // 9. Tools (group `group_tools`)
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

/** Every directory under app/pages (recursive, absolute). */
function pageDirs(dir: string = PAGES_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    out.push(full, ...pageDirs(full))
  }
  return out
}

describe('navigation contracts — a page file never shadows its child routes', () => {
  // Nuxt nests `x.vue` + `x/` (legacy child routes): every child URL renders the
  // PARENT page unless the parent includes <NuxtPage>. This silently turned
  // /news/events into the News Desk until `news.vue` became `news/index.vue`.
  // A shadowing page is only legal when it is a layout host.
  for (const dir of pageDirs()) {
    const shadow = `${dir}.vue`
    if (!existsSync(shadow)) continue
    test(`${shadow.replace(process.cwd(), '')} is a layout host (<NuxtPage>)`, () => {
      const src = readFileSync(shadow, 'utf8')
      assert.match(
        src,
        /<NuxtPage\s*\/?>/,
        `${shadow} shadows the routes in ${dir}/ — either add <NuxtPage> (layout host) or move the page to ${dir}/index.vue`
      )
    })
  }
})

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
