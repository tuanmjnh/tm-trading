import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DASHBOARD_REPLACED_PREFIXES,
  isDashboardReplacedPath,
  selectNavRoutes
} from '../app/utils/navTree'
import { overlayFromQuery, overlayToQuery, OVERLAY_QUERY_KEY } from '../app/composables/useAppOverlay'
import { FRESH_MS, freshnessOf } from '../app/composables/useDashboardFeed'

/**
 * V5.0 acceptance coverage for the parts of the Dashboard that are pure:
 * overlay deep links, the menu-hiding rule, and the freshness contract.
 *
 * These are the three places where a silent regression is invisible in a
 * screenshot: a wrong deep link opens nothing, a prefix bug hides a menu the
 * operator needs, and a freshness bug labels old data as current.
 */

describe('V5.0 overlay deep links', () => {
  test('each panel survives a query round trip', () => {
    const cases = [
      { kind: 'signal', payload: { id: 'sig:abc' } },
      { kind: 'asset', payload: { symbol: 'BTCUSDT' } },
      { kind: 'news', payload: { id: 'news_123' } },
      { kind: 'control', payload: { section: 'diagnostics' } }
    ] as const

    for (const state of cases) {
      const query = overlayToQuery(state as never)
      assert.deepEqual(overlayFromQuery(query), state)
      assert.equal(query[OVERLAY_QUERY_KEY], state.kind)
    }
  })

  test('an unknown or incomplete panel request opens nothing', () => {
    assert.equal(overlayFromQuery({}), null)
    assert.equal(overlayFromQuery({ panel: 'nope' }), null)
    assert.equal(overlayFromQuery({ panel: 'signal' }), null) // no item id
    assert.equal(overlayFromQuery({ panel: 'asset' }), null) // no symbol
  })

  test('a control section that does not exist falls back to services', () => {
    assert.deepEqual(overlayFromQuery({ panel: 'control', section: 'nope' }), {
      kind: 'control',
      payload: { section: 'services' }
    })
    assert.deepEqual(overlayFromQuery({ panel: 'control' }), {
      kind: 'control',
      payload: { section: 'services' }
    })
  })

  test('no credential-shaped key is ever produced in the URL', () => {
    for (const query of [
      overlayToQuery({ kind: 'signal', payload: { id: 'x' } }),
      overlayToQuery({ kind: 'asset', payload: { symbol: 'BTCUSDT' } }),
      overlayToQuery({ kind: 'news', payload: { id: 'x' } }),
      overlayToQuery({ kind: 'control', payload: { section: 'ai' } })
    ]) {
      for (const key of Object.keys(query)) {
        assert.ok(
          ['panel', 'item', 'symbol', 'section'].includes(key),
          `unexpected query key ${key}`
        )
      }
    }
  })
})

describe('V5.0 menu hiding (content moved to the Dashboard)', () => {
  test('a replaced group is hidden, including its children', () => {
    assert.equal(isDashboardReplacedPath('/markets'), true)
    assert.equal(isDashboardReplacedPath('/markets/scanner'), true)
    assert.equal(isDashboardReplacedPath('/operations'), true)
    assert.equal(isDashboardReplacedPath('/wallet'), false)
  })

  test('prefix matching respects a segment boundary', () => {
    assert.equal(isDashboardReplacedPath('/marketssomething'), false)
    assert.equal(isDashboardReplacedPath('/newsroom'), false)
  })

  test('administration, research and auth surfaces are NOT hidden', () => {
    for (const path of ['/admin-system/users', '/data-research/data', '/login', '/test-center/runs', '/']) {
      assert.equal(isDashboardReplacedPath(path), false, path)
    }
  })

  test('selectNavRoutes drops hidden leaves and their empty groups only', () => {
    const tree = [
      {
        path: '/markets',
        name: 'markets',
        children: [{ path: '/markets/scanner', name: 'scanner' }]
      },
      {
        path: '/admin-system',
        name: 'administration',
        children: [{ path: '/admin-system/users', name: 'users' }]
      }
    ]

    const selected = selectNavRoutes(tree, {
      hasLocalPage: () => true,
      hiddenPathPrefixes: [...DASHBOARD_REPLACED_PREFIXES]
    })

    assert.deepEqual(selected.map(node => node.path), ['/admin-system'])
    assert.deepEqual(selected[0]?.children?.map(node => node.path), ['/admin-system/users'])
  })

  test('without the option the full tree is returned (rollback path)', () => {
    const tree = [{ path: '/markets', name: 'markets' }]
    assert.equal(selectNavRoutes(tree, { hasLocalPage: () => true }).length, 1)
  })
})

describe('V5.0 freshness contract', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()

  test('the market snapshot goes stale after its window, not before', () => {
    assert.equal(freshnessOf(at(1), 'intel', now), 'fresh')
    assert.equal(freshnessOf(at(FRESH_MS.intel / 60_000 + 1), 'intel', now), 'stale')
  })

  test('news keeps a longer window than the market snapshot', () => {
    assert.ok(FRESH_MS.news > FRESH_MS.intel)
    assert.equal(freshnessOf(at(60), 'news', now), 'fresh')
  })

  test('a missing or unparsable timestamp is "missing", never "fresh"', () => {
    assert.equal(freshnessOf(null, 'intel', now), 'missing')
    assert.equal(freshnessOf('', 'news', now), 'missing')
    assert.equal(freshnessOf('not-a-date', 'signals', now), 'missing')
  })
})
