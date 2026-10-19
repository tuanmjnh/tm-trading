import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// =============================================================================
//  C4 workspace invalidation (§61.17 Phase C) — SOURCE-level guards.
//
//  The server exposes the owner-scoped outbox; the client drains it and refetches
//  only the screens a relevant event touched. These guards pin that contract so a
//  refactor cannot silently drop the owner scope or the shared context.
// =============================================================================

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const eventsRoute = read('../server/api/v1/workspace/events.get.ts')
const ackRoute = read('../server/api/v1/workspace/events/ack.post.ts')
const ws = read('../app/composables/useTradingWorkspace.ts')

describe('GET /api/v1/workspace/events', () => {
  test('is owner-scoped', () => {
    assert.match(eventsRoute, /requireOwnerId\(event\)/)
    assert.match(eventsRoute, /pendingForOwner\(ownerId/)
  })

  test('returns the invalidated view ids', () => {
    assert.match(eventsRoute, /viewsForEvents\(events\)/)
  })
})

describe('POST /api/v1/workspace/events/ack', () => {
  test('acks through the owner-guarded store call (cannot ack another owner)', () => {
    assert.match(ackRoute, /markDeliveredForOwner\(ownerId, ids\)/)
    assert.doesNotMatch(ackRoute, /(^|[^.\w])markDelivered\(/) // not the unscoped variant
  })
})

describe('useTradingWorkspace', () => {
  test('drains the outbox then acks the batch', () => {
    assert.match(ws, /\/api\/v1\/workspace\/events'/)
    assert.match(ws, /\/api\/v1\/workspace\/events\/ack'/)
  })

  test('polls only while visible and authenticated', () => {
    assert.match(ws, /useVisibleInterval\(/)
    assert.match(ws, /isAuthenticated/)
  })

  test('exposes one version counter per view and bumps them', () => {
    assert.match(ws, /WORKSPACE_VIEWS = \['accounts', 'orders', 'positions', 'paper', 'signals'\]/)
    assert.match(ws, /bumpWorkspaceViews/)
  })

  test('only the per-book views are account-scoped (accounts/signals always refresh)', () => {
    assert.match(ws, /const SCOPED_VIEWS = new Set\(\['orders', 'positions'\]\)/)
    assert.match(ws, /function viewsToBump\(e: TradingWorkspaceEvent\)/)
    assert.match(ws, /!SCOPED_VIEWS\.has\(v\) \|\| e\.accountId === scope/)
  })
})

describe('trade screens subscribe to their view', () => {
  for (const [path, view] of [
    ['../app/pages/trading/orders.vue', 'orders'],
    ['../app/pages/trading/positions.vue', 'positions'],
    ['../app/pages/trading/accounts.vue', 'accounts'],
    ['../app/pages/trading/paper.vue', 'paper'],
    ['../app/pages/trading/signals.vue', 'signals'],
  ] as const) {
    test(`${path} watches workspaceVersion('${view}')`, () => {
      const src = read(path)
      assert.match(src, /useTradingWorkspace\(\)/)
      assert.match(src, new RegExp(`workspaceVersion\\('${view}'\\)`))
    })
  }
})

// =============================================================================
//  C5 — honest screen state (§61.17 Phase C). An EMPTY result must never be
//  shown when the load FAILED, and a failed refresh must flag the data stale
//  instead of blanking it. Pinned at source level (no DOM harness in this repo).
// =============================================================================

const resourceState = read('../app/composables/useResourceState.ts')
const refreshNotice = read('../app/components/shared/RefreshNotice.vue')

describe('useResourceState', () => {
  test('tracks loading / error / lastUpdated and never throws', () => {
    assert.match(resourceState, /export function useResourceState\(\)/)
    assert.match(resourceState, /const loading = ref\(false\)/)
    assert.match(resourceState, /const error = ref<unknown>\(null\)/)
    assert.match(resourceState, /const lastUpdated = ref<number \| null>\(null\)/)
    assert.match(resourceState, /error\.value = err/)
    assert.match(resourceState, /lastUpdated\.value = Date\.now\(\)/)
  })

  test('isStale is true only when a failure follows a successful load', () => {
    assert.match(resourceState, /const isStale = computed\(\(\) => error\.value != null && lastUpdated\.value != null\)/)
  })
})

describe('SharedRefreshNotice', () => {
  test('renders only when stale and emits retry', () => {
    assert.match(refreshNotice, /v-if="stale"/)
    assert.match(refreshNotice, /defineEmits<\{ retry: \[\] \}>/)
    assert.match(refreshNotice, /emit\('retry'\)/)
  })
})

describe('trade screens are honest about empty vs error', () => {
  for (const path of [
    '../app/pages/trading/orders.vue',
    '../app/pages/trading/positions.vue',
    '../app/pages/trading/accounts.vue',
    '../app/pages/trading/paper.vue',
    '../app/pages/trading/signals.vue',
  ] as const) {
    test(`${path} uses the shared resource state + error/stale surfaces`, () => {
      const src = read(path)
      assert.match(src, /useResourceState\(\)/)
      assert.match(src, /hasError/)
      assert.match(src, /SharedRefreshNotice/)
      assert.match(src, /common\.loadErrorTitle/)
      assert.match(src, /common\.staleData/)
    })
  }
})
