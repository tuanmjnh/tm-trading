import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFidelity, formatFidelityBanner, fidelityRecord, FIDELITY_CODES } from '../simulation/fidelity.mjs'

// =============================================================================
//  §34 Fidelity Labels — precision tiers for execution simulation.
//  Pure, offline.
// =============================================================================

describe('fidelity (§34)', () => {
  test('levels and codes match the roadmap', () => {
    assert.deepEqual(FIDELITY_CODES, ['F0', 'F1', 'F2', 'F3', 'F4'])
  })

  test('resolveFidelity: broker/exchange/mt5 -> F4; depthActive -> F3; tradeStream -> F2; quoteAware paper -> F1; backtest no quote -> F0', () => {
    assert.equal(resolveFidelity({ mode: 'exchange' }), 'F4')
    assert.equal(resolveFidelity({ mode: 'mt5' }), 'F4')
    assert.equal(resolveFidelity({ mode: 'paper', brokerSync: true }), 'F4')
    assert.equal(resolveFidelity({ mode: 'paper', depthActive: true }), 'F3')
    assert.equal(resolveFidelity({ mode: 'paper', tradeStreamActive: true }), 'F2')
    assert.equal(resolveFidelity({ mode: 'paper', quoteAware: true }), 'F1')
    assert.equal(resolveFidelity({ mode: 'backtest', quoteAware: false }), 'F0')
  })

  test('formatFidelityBanner produces the terminal string', () => {
    assert.equal(formatFidelityBanner({ mode: 'PAPER', fidelity: 'F1', market: 'fapi' }), 'PAPER · F1 · BINANCE FUTURES')
    assert.equal(formatFidelityBanner({ mode: 'PAPER', fidelity: 'F1', market: 'spot' }), 'PAPER · F1 · BINANCE SPOT')
    assert.equal(formatFidelityBanner({ mode: 'paper', fidelity: 'F2', venue: 'BYBIT PERP' }), 'PAPER · F2 · BYBIT PERP')
  })

  test('fidelityRecord returns full info + banner', () => {
    const rec = fidelityRecord({ mode: 'paper', quoteAware: true })
    assert.equal(rec.code, 'F1')
    assert.equal(rec.banner, 'PAPER · F1 · BINANCE FUTURES')
    assert.equal(rec.name, 'Quote-aware')
  })
})