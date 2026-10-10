import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INSTRUMENTS, INSTRUMENT_BY_ID, getInstrument, getInstrumentVenues,
  listInstruments, VENUE_IDS, CATALOG_VENUES,
} from '../server/utils/instruments'

// =============================================================================
//  §30.1 Canonical Instrument Catalog & APIs.
//  Pure unit tests for catalog structure and helpers.
// =============================================================================

describe('instrument catalog (§26, §30.1)', () => {
  test('catalog contains active BTC and ETH perps with venues', () => {
    const btc = getInstrument('crypto:perp:BTC/USDT')
    assert.ok(btc)
    assert.equal(btc.symbol, 'BTC/USDT')
    assert.equal(btc.type, 'perp')
    assert.equal(btc.status, 'active')
    assert.ok(btc.venues.length >= 3)
    const venues = btc.venues.map((v) => v.venue)
    assert.ok(venues.includes('binance'))
    assert.ok(venues.includes('bybit'))
    assert.ok(venues.includes('okx'))
  })

  test('listInstruments filters by type and status', () => {
    const perps = listInstruments({ type: 'perp' })
    assert.ok(perps.length >= 2)
    assert.ok(perps.every((i) => i.type === 'perp'))

    const spots = listInstruments({ type: 'spot' })
    assert.ok(spots.length >= 2)
    assert.ok(spots.every((i) => i.type === 'spot'))

    const active = listInstruments({ status: 'active' })
    assert.equal(active.length, INSTRUMENTS.length)
  })

  test('getInstrumentVenues returns mapped venues for an instrument', () => {
    const v = getInstrumentVenues('crypto:perp:BTC/USDT')
    assert.ok(v.length >= 3)
    const binance = v.find((x) => x.venue === 'binance')
    assert.equal(binance?.native, 'BTCUSDT')
  })

  test('unknown instrument returns empty venues / undefined', () => {
    assert.equal(getInstrument('crypto:perp:UNKNOWN/USDT'), undefined)
    assert.deepEqual(getInstrumentVenues('crypto:perp:UNKNOWN/USDT'), [])
  })

  test('VENUE_IDS matches catalog venues', () => {
    for (const v of CATALOG_VENUES) {
      assert.ok(VENUE_IDS.includes(v as typeof VENUE_IDS[number]), `catalog venue ${v} in VENUE_IDS`)
    }
  })
})