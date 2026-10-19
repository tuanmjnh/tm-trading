import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARGIN_DEFAULTS,
  initialMarginFor,
  modelForPosition,
  positionLeverage
} from '../simulation/margin.mjs'
import { liquidationPrice } from '../simulation/liquidation.mjs'

// =============================================================================
//  Per-position leverage (v3 §17.1b) — golden math.
//
//  A position doc carrying `leverage` prices ITS OWN isolated margin +
//  liquidation distance (initialMarginPct = 100/lev). Docs without it use the
//  account model EXACTLY as before (D1: legacy numbers are byte-identical).
//  Maintenance stays a flat account policy either way.
// =============================================================================

const pos = (over: Record<string, unknown> = {}) => ({
  dir: 1,
  qty: 1,
  entryPrice: 100,
  ...over
})

describe('positionLeverage — intent parsing', () => {
  test('accepts integers 1..125', () => {
    assert.equal(positionLeverage(pos({ leverage: 1 })), 1)
    assert.equal(positionLeverage(pos({ leverage: 5 })), 5)
    assert.equal(positionLeverage(pos({ leverage: 125 })), 125)
  })

  test('anything else falls back to the account model (null)', () => {
    assert.equal(positionLeverage(pos()), null)
    assert.equal(positionLeverage(pos({ leverage: null })), null)
    assert.equal(positionLeverage(pos({ leverage: 0 })), null)
    assert.equal(positionLeverage(pos({ leverage: -3 })), null)
    assert.equal(positionLeverage(pos({ leverage: 126 })), null)
    assert.equal(positionLeverage(pos({ leverage: 2.5 })), null)
    assert.equal(positionLeverage(pos({ leverage: '5' })), null)
    assert.equal(positionLeverage(pos({ leverage: Number.NaN })), null)
  })
})

describe('modelForPosition — override rule', () => {
  test('legacy docs keep the account model untouched', () => {
    assert.deepEqual(modelForPosition(pos()), { ...MARGIN_DEFAULTS })
    assert.deepEqual(
      modelForPosition(pos(), { ...MARGIN_DEFAULTS, initialMarginPct: 10 }),
      { ...MARGIN_DEFAULTS, initialMarginPct: 10 }
    )
  })

  test('leverage overrides ONLY initialMarginPct', () => {
    const m = modelForPosition(pos({ leverage: 10 }))
    assert.equal(m.initialMarginPct, 10)
    assert.equal(m.maintenanceMarginPct, MARGIN_DEFAULTS.maintenanceMarginPct)
  })
})

describe('initialMarginFor — per-position lock', () => {
  test('legacy: notional 100 × 20% = 20', () => {
    assert.equal(initialMarginFor(pos({ qty: 1, entryPrice: 100 })), 20)
  })

  test('10x locks a tenth: 100 × 10% = 10', () => {
    assert.equal(initialMarginFor(pos({ qty: 1, entryPrice: 100, leverage: 10 })), 10)
  })

  test('custom account model still wins when the doc carries no leverage', () => {
    assert.equal(
      initialMarginFor(pos({ qty: 1, entryPrice: 100 }), { ...MARGIN_DEFAULTS, initialMarginPct: 50 }),
      50
    )
  })
})

describe('liquidationPrice — per-position distance', () => {
  test('legacy LONG 5x: 100 × (1 − 19.6%) = 80.4', () => {
    const lp = liquidationPrice(pos({ dir: 1, qty: 1, entryPrice: 100 }))
    assert.equal(lp.ok, true)
    if (lp.ok) assert.equal(lp.liqPrice, 80.4)
  })

  test('10x LONG tolerates half the adverse move: 100 × (1 − 9.6%) = 90.4', () => {
    const lp = liquidationPrice(pos({ dir: 1, qty: 1, entryPrice: 100, leverage: 10 }))
    assert.equal(lp.ok, true)
    if (lp.ok) {
      assert.equal(lp.liqPrice, 90.4)
      assert.equal(lp.marginUsed, 10)
    }
  })

  test('1x SHORT: 100 × (1 + 99.6%) = 199.6', () => {
    const lp = liquidationPrice(pos({ dir: -1, qty: 1, entryPrice: 100, leverage: 1 }))
    assert.equal(lp.ok, true)
    if (lp.ok) assert.equal(lp.liqPrice, 199.6)
  })
})
