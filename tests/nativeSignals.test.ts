import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { listNativeSignals } from '../server/utils/nativeSignals'

// =============================================================================
//  Native signal read path (roadmap §61.17 Phase D — D5).
//
//  The dashboard must be able to display engine signals WITHOUT going through the
//  TradingView webhook. This file pins the read contract (owner-scoped, keyed to
//  native rows only, cursor-paginated, fail-soft) and guards that the native path
//  never imports the legacy webhook receiver.
// =============================================================================

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const NATIVE_UTIL = read('../server/utils/nativeSignals.ts')
const NATIVE_ROUTE = read('../server/api/v1/signals/native.get.ts')
const NATIVE_COMPOSABLE = read('../app/composables/useNativeSignals.ts')
const NATIVE_PANEL = read('../app/components/trading/EngineSignalsPanel.vue')
const SIGNALS_PAGE = read('../app/pages/trading/signals.vue')
const WEBHOOK = read('../server/webhook.mjs')

// Every file on the native read/generate path — none may depend on the webhook.
const NATIVE_PATH = [
  '../server/utils/nativeSignals.ts',
  '../server/api/v1/signals/native.get.ts',
  '../app/composables/useNativeSignals.ts',
  '../app/components/trading/EngineSignalsPanel.vue',
  '../engine/signalContract.mjs',
  '../engine/signalEngine.mjs',
  '../services/signalStore.mjs'
]

describe('listNativeSignals contract', () => {
  test('is an exported function', () => {
    assert.equal(typeof listNativeSignals, 'function')
  })

  test('is owner-scoped and serves native (signalKey) rows only', () => {
    assert.match(NATIVE_UTIL, /ownerId: q\.ownerId/)
    assert.match(NATIVE_UTIL, /signalKey:\s*\{\s*\$type:\s*'string'\s*\}/)
  })

  test('paginates deterministically on ts+_id and validates the cursor', () => {
    assert.match(NATIVE_UTIL, /\.sort\(\{\s*ts:\s*-1,\s*_id:\s*-1\s*\}\)/)
    assert.match(NATIVE_UTIL, /Types\.ObjectId\.isValid\(q\.cursor\)/)
    assert.match(NATIVE_UTIL, /\$lt:\s*new Types\.ObjectId\(q\.cursor\)/)
    assert.match(NATIVE_UTIL, /statusCode:\s*400/)
  })

  test('fails soft when Mongo is unavailable (no 500)', () => {
    assert.match(NATIVE_UTIL, /mongo:\s*'down'/)
    assert.match(NATIVE_UTIL, /catch\s*\{/)
    assert.match(NATIVE_UTIL, /countDocuments/)
  })
})

describe('native route', () => {
  test('mirrors the list convention: pagination params, cursor page, owner gate', () => {
    assert.match(NATIVE_ROUTE, /getListParams\(event,\s*50,\s*200\)/)
    assert.match(NATIVE_ROUTE, /cursorPage\(items,\s*limit/)
    assert.match(NATIVE_ROUTE, /requireOwnerId\(event\)/)
    assert.match(NATIVE_ROUTE, /listNativeSignals\(/)
  })
})

describe('native UI wiring', () => {
  test('the composable hits the native endpoint', () => {
    assert.match(NATIVE_COMPOSABLE, /'\/api\/v1\/signals\/native'/)
  })

  test('the Signals page offers a source switch (webhook vs engine)', () => {
    assert.match(SIGNALS_PAGE, /source_engine/)
    assert.match(SIGNALS_PAGE, /source_alerts/)
    assert.match(SIGNALS_PAGE, /TradingEngineSignalsPanel/)
  })

  test('the engine panel is self-contained (pagination + honest states)', () => {
    assert.match(NATIVE_PANEL, /useCursorPagination/)
    assert.match(NATIVE_PANEL, /useResourceState/)
    assert.match(NATIVE_PANEL, /SharedRefreshNotice/)
    assert.match(NATIVE_PANEL, /defineExpose/)
  })
})

describe('webhook is legacy inbound (D5)', () => {
  test('is marked LEGACY and no longer a dependency of the native path', () => {
    assert.match(WEBHOOK, /LEGACY INBOUND/)
    for (const rel of NATIVE_PATH) {
      const src = read(rel)
      assert.doesNotMatch(src, /from\s+['"][^'"]*webhook/i, `${rel} imports the webhook`)
      assert.doesNotMatch(src, /require\(\s*['"][^'"]*webhook/i, `${rel} requires the webhook`)
    }
  })

  test('keeps serving historical alerts (not deleted)', () => {
    assert.match(WEBHOOK, /export function toSignalDoc|function toSignalDoc/)
    assert.match(WEBHOOK, /SIGNAL_TYPES/)
  })
})
