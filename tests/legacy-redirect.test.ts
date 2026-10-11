import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_REDIRECTS, matchLegacy } from '../server/utils/legacy-redirect'

/**
 * V3.3 §58.10: the route re-home must not break legacy deep links. The redirect
 * table is pure (server/utils/legacy-redirect.ts); the Nitro middleware only adds
 * the 301 transport. These tests guard the matcher AND that every redirect target
 * still resolves to a real page (regression for `/utilities/text` -> `/tools/text`).
 */

const PAGES_DIR = join(process.cwd(), 'app', 'pages')

/** Resolves a Nuxt route path to its candidate page files under app/pages. */
function pageCandidates(routePath: string): string[] {
  const segments = routePath.split('/').filter(Boolean)
  if (segments.length === 0) return [join(PAGES_DIR, 'index.vue')]
  const base = join(PAGES_DIR, ...segments)
  return [`${base}.vue`, join(base, 'index.vue')]
}

describe('legacy redirects — matcher', () => {
  test('exact legacy path maps with empty rest', () => {
    assert.deepEqual(matchLegacy('/runs'), { to: '/test-center/runs', rest: '' })
  })

  test('sub-path is preserved (dynamic ids)', () => {
    assert.deepEqual(matchLegacy('/runs/order-123'), { to: '/test-center/runs', rest: '/order-123' })
  })

  test('matching is on a segment boundary (/runner is not /runs)', () => {
    assert.equal(matchLegacy('/runner'), null)
  })

  test('a non-legacy path is left untouched', () => {
    assert.equal(matchLegacy('/test-center/runs'), null)
  })

  test('/utilities/text goes to the Tools index, not the non-existent /tools/text', () => {
    assert.deepEqual(matchLegacy('/utilities/text'), { to: '/tools', rest: '' })
  })

  test('other utilities keep their sub-path', () => {
    assert.deepEqual(matchLegacy('/utilities/icons'), { to: '/tools', rest: '/icons' })
  })
})

describe('legacy redirects — every target resolves to a page', () => {
  for (const { from, to } of LEGACY_REDIRECTS) {
    test(`${from} -> ${to} has a page file`, () => {
      const candidates = pageCandidates(to)
      assert.ok(
        candidates.some(existsSync),
        `legacy target ${to} (from ${from}) has no page; checked ${candidates.join(', ')}`
      )
    })
  }
})
