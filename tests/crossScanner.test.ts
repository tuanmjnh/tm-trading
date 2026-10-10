import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { scanAll, compareVenues, formatScanLine, topSpreads, relSpread, absSpread, SCANNER_VERSION } from '../market/crossScanner.mjs'

// =============================================================================
//  §36 Cross-Exchange Scanner — pure core: compare venues, compute spreads.
//  NEVER presents as guaranteed arbitrage (§36 warning in output).
// =============================================================================

const q = (last, bid = null, ask = null) => last != null ? { last, bid, ask } : null
const f = (rate, next = null) => rate != null ? { rate, nextFundingTime: next } : null
const o = (value) => value != null ? { value } : null

describe('crossScanner (§36)', () => {
  test('relSpread / absSpread handle null and zero base', () => {
    assert.equal(relSpread(100, 101), 0.01)
    assert.equal(relSpread(null, 101), null)
    assert.equal(relSpread(100, null), null)
    assert.equal(relSpread(0, 101), null) // base 0 -> null (not Infinity)
    assert.equal(absSpread(100, 105), 5)
    assert.equal(absSpread(null, 105), null)
  })

  test('compareVenues computes all §36 metrics for a pair', () => {
    const v1 = { quote: q(120100, 120090, 120110), funding: f(0.0001), oi: o(50000) }
    const v2 = { quote: q(120115, 120105, 120125), funding: f(0.00012), oi: o(52000) }
    const cmp = compareVenues(v1, v2, { label1: 'binance', label2: 'bybit' })
    // quote
    assert.ok(Math.abs(cmp.quote.relative - 0.0001248) < 1e-5) // (120115-120100)/120100
    assert.equal(cmp.quote.absolute, 15)
    // funding: relSpread uses first arg as base -> 0.0001
    assert.ok(Math.abs(cmp.funding.relative - 0.2) < 1e-4) // (0.00012-0.0001)/0.0001 = 0.2
    // oi: relSpread uses first arg as base -> 50000
    assert.ok(Math.abs(cmp.oi.relative - 0.04) < 1e-4) // 2000/50000 = 0.04
    // venue labels
    assert.equal(cmp.binance.quote, 120100)
    assert.equal(cmp.bybit.quote, 120115)
  })

  test('scanAll builds venueData + pairwise comparisons', async () => {
    const instruments = [
      { symbol: 'BTC/USDT', type: 'perp', venues: [{ venue: 'binance', native: 'BTCUSDT' }, { venue: 'bybit', native: 'BTCUSDT' }] },
    ]
    const adapters = {
      binance: { fetch: async () => ({ quote: q(120100), funding: f(0.0001), oi: o(50000) }) },
      bybit: { fetch: async () => ({ quote: q(120115), funding: f(0.00012), oi: o(52000) }) },
    }
    const scans = await scanAll(instruments, adapters)
    assert.equal(scans.length, 1)
    assert.equal(scans[0].instrument, 'BTC/USDT')
    assert.ok(scans[0].venues.binance)
    assert.ok(scans[0].venues.bybit)
    assert.ok(scans[0].comparisons.binance_bybit)
    assert.equal(scans[0].comparisons.binance_bybit.binance.quote, 120100)
  })

  test('scanAll tolerates a failed venue (recorded as error, other venues compared)', async () => {
    const instruments = [
      { symbol: 'BTC/USDT', type: 'perp', venues: [{ venue: 'binance', native: 'BTCUSDT' }, { venue: 'bybit', native: 'BTCUSDT' }, { venue: 'okx', native: 'BTC-USDT-SWAP' }] },
    ]
    const adapters = {
      binance: { fetch: async () => ({ quote: q(120100), funding: f(0.0001), oi: o(50000) }) },
      bybit: { fetch: async () => { throw new Error('bybit down') } },
      okx: { fetch: async () => ({ quote: q(120108), funding: f(0.00011), oi: o(48000) }) },
    }
    const scans = await scanAll(instruments, adapters)
    assert.equal(scans[0].errors.length, 1)
    assert.equal(scans[0].errors[0].venue, 'bybit')
    assert.ok(scans[0].venues.binance)
    assert.ok(scans[0].venues.okx)
    // okx vs binance should still be compared
    assert.ok(scans[0].comparisons.binance_okx)
  })

  test('formatScanLine matches §36 example format', () => {
    const r = {
      instrument: 'BTC/USDT', type: 'perp',
      venues: { binance: { quote: { last: 120100 } }, bybit: { quote: { last: 120115 } }, okx: { quote: { last: 120108 } } },
    }
    const line = formatScanLine(r)
    assert.match(line, /^BTC\/USDT PERP/)
    assert.match(line, /BINANCE 120,100/)
    assert.match(line, /BYBIT 120,115/)
    assert.match(line, /OKX 120,108/)
  })

  test('topSpreads returns widest relative spreads across all scans', () => {
    const scans = [
      { instrument: 'BTC/USDT', comparisons: { binance_bybit: { quote: { relative: 0.001 } }, binance_okx: { quote: { relative: 0.005 } } } },
      { instrument: 'ETH/USDT', comparisons: { binance_bybit: { quote: { relative: 0.002 } } } },
    ]
    const top = topSpreads(scans, { limit: 2 })
    assert.equal(top.length, 2)
    assert.equal(top[0].spread, 0.005)
    assert.equal(top[0].instrument, 'BTC/USDT')
    assert.equal(top[1].spread, 0.002)
  })

  test('SCANNER_VERSION stamp present', () => {
    assert.equal(typeof SCANNER_VERSION, 'string')
    assert.match(SCANNER_VERSION, /^crossScanner\./)
  })
})