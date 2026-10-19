import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// =============================================================================
//  C3 writer wiring (§61.17 Phase C).
//
//  The writers that own a Mongo handle publish typed trading events so every
//  view reconciles without a hard refresh. These are SOURCE-level guards (the
//  live path needs Mongo/klines) that pin the wiring and — critically — that
//  the offline executor keeps its DB-free import graph and stays tenancy-safe.
// =============================================================================

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const paper = read('../exec/paper.mjs')
const alertRules = read('../services/alertRules.mjs')
const paperAccount = read('../server/utils/paperAccount.ts')

describe('exec/paper.mjs emits order / fill / position events', () => {
  for (const type of [
    'order.created',
    'order.risk-rejected',
    'order.partially-filled',
    'order.filled',
    'order.expired',
    'fill.recorded',
    'position.opened',
    'position.updated',
    'position.closed',
  ]) {
    test(`emits ${type}`, () => {
      assert.match(paper, new RegExp(`'${type.replace('.', '\\.')}'`))
    })
  }

  test('publishes through the emit helper (never inline in the pure builders)', () => {
    assert.match(paper, /async function emit\(m, input\)/)
    assert.ok((paper.match(/await emit\(m, \{/g) || []).length >= 9, 'each state change calls emit()')
  })

  test('never statically imports the store (offline suite keeps a DB-free graph)', () => {
    assert.doesNotMatch(paper, /^import[^\n]*workspaceStore/m)
    assert.match(paper, /await import\('\.\.\/services\/workspaceStore\.mjs'\)/)
  })

  test('an ownerless legacy desk cannot publish (tenancy §61.3)', () => {
    // emit gates on the outbox model and lets tradingDomainEvent reject a null
    // owner; assert the guard is present so a null owner never lands a row.
    assert.match(paper, /if \(!m\?\.TradingDomainEvent\) return/)
  })
})

describe('services/alertRules.mjs emits signal.received', () => {
  test('publishes on a NEW in-app signal only', () => {
    assert.match(alertRules, /type: 'signal\.received'/)
    assert.match(alertRules, /upsertedId/)
    assert.match(alertRules, /import \{ emitTradingEvent \} from '\.\/workspaceStore\.mjs'/)
  })
})

describe('server/utils/paperAccount.ts emits account lifecycle events', () => {
  for (const type of ['account.created', 'account.renamed', 'account.archived', 'account.unarchived', 'account.deleted']) {
    test(`emits ${type}`, () => {
      assert.match(paperAccount, new RegExp(`'${type.replace('.', '\\.')}'`))
    })
  }

  test('reaches the store through the lazy resolver, not a static import', () => {
    assert.match(paperAccount, /import \{ engineModel, simulationAccount, workspaceStore \} from '\.\/engineModel'/)
  })
})
