import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getUniverse,
  mergeUniverse,
  resetUniverseCache,
  type UniverseRow
} from '../server/utils/marketUniverse'

// =============================================================================
//  Live symbol universe — merge rules + fail-soft cache (offline, fetchImpl
//  injected; no network in tests).
// =============================================================================

const bybitBody = {
  result: {
    list: [
      { symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading', contractType: 'LinearPerpetual' },
      { symbol: 'PEPEUSDT', baseCoin: 'PEPE', quoteCoin: 'USDT', status: 'Trading', contractType: 'LinearPerpetual' },
      { symbol: 'BTCUSD', baseCoin: 'BTC', quoteCoin: 'USD', status: 'Trading', contractType: 'InversePerpetual' },
      { symbol: 'DOGEUSDT', baseCoin: 'DOGE', quoteCoin: 'USDT', status: 'Closed', contractType: 'LinearPerpetual' }
    ]
  }
}

const spotBody = {
  symbols: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
    { symbol: 'XRPBTC', baseAsset: 'XRP', quoteAsset: 'BTC', status: 'TRADING' },
    { symbol: 'FOOXYZ', baseAsset: 'FOO', quoteAsset: 'XYZ', status: 'TRADING' },
    { symbol: 'OLDBTC', baseAsset: 'OLD', quoteAsset: 'BTC', status: 'BREAK' }
  ]
}

const okxBody = {
  data: [
    { instId: 'BTC-USDT-SWAP', state: 'live' },
    { instId: 'PEPE-USDT-SWAP', state: 'live' },
    { instId: 'BTC-USD-SWAP', state: 'live' },
    { instId: 'ETH-USDT-SWAP', state: 'suspended' }
  ]
}

const bingxBody = {
  data: [
    { symbol: 'BTC-USDT', status: 1, asset: 'BTC', currency: 'USDT' },
    { symbol: 'ORDI-USDT', status: 1, asset: 'ORDI', currency: 'USDT' },
    { symbol: 'DEAD-USDT', status: 0, asset: 'DEAD', currency: 'USDT' }
  ]
}

const geckoBody = {
  data: {
    total_market_cap: { usd: 3000000000000 },
    market_cap_percentage: { btc: 60, eth: 10 }
  }
}

const bingxSpotBody = {
  data: {
    symbols: [
      { symbol: 'BTC-USDT', status: 1, apiStateBuy: true, apiStateSell: true },
      { symbol: 'SEI-USDT', status: 1, apiStateBuy: true, apiStateSell: true },
      { symbol: 'GONE-USDT', status: 0, apiStateBuy: true, apiStateSell: true },
      { symbol: 'FROZEN-USDT', status: 1, apiStateBuy: false, apiStateSell: true }
    ]
  }
}

// Gate keys on `contract_type` being EMPTY for crypto (non-empty = stocks,
// indices, commodities, forex, metals — must never reach a tradeable row).
const gateFutBody = [
  { name: 'BTC_USDT', status: 'trading', type: 'direct', in_delisting: false, contract_type: '' },
  { name: 'GATEROW_USDT', status: 'trading', type: 'direct', in_delisting: false, contract_type: '' },
  { name: 'AAPLX_USDT', status: 'trading', type: 'direct', in_delisting: false, contract_type: 'stocks' },
  { name: 'OLDCOIN_USDT', status: 'trading', type: 'direct', in_delisting: true, contract_type: '' },
  { name: 'BTC_USDT', status: 'delisted', type: 'direct', in_delisting: false, contract_type: '' }
]

const gateSpotBody = [
  { base: 'BTC', quote: 'USDT', trade_status: 'tradable' },
  { base: 'GTC', quote: 'USDT', trade_status: 'tradable' },
  { base: 'DEAD', quote: 'USDT', trade_status: 'untradable' },
  { base: 'FOO', quote: 'XYZ', trade_status: 'tradable' }
]

const bitgetFutBody = {
  data: [
    { symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', symbolStatus: 'normal', symbolType: 'perpetual' },
    { symbol: 'BGSUSDT', baseCoin: 'BGS', quoteCoin: 'USDT', symbolStatus: 'normal', symbolType: 'perpetual' },
    { symbol: 'BTCDOMUSDT', baseCoin: 'BTCDOM', quoteCoin: 'USDT', symbolStatus: 'halt', symbolType: 'perpetual' },
    { symbol: 'BTCUSDT_240329', baseCoin: 'BTC', quoteCoin: 'USDT', symbolStatus: 'normal', symbolType: 'delivery' }
  ]
}

const bitgetSpotBody = {
  data: [
    { symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'online' },
    { symbol: 'BSPUSDT', baseCoin: 'bsp', quoteCoin: 'USDT', status: 'online' },
    { symbol: 'HALTUSDT', baseCoin: 'HALT', quoteCoin: 'USDT', status: 'halt' }
  ]
}

const mexcFutBody = {
  data: [
    { symbol: 'BTC_USDT', baseCoin: 'BTC', quoteCoin: 'USDT', state: 0 },
    { symbol: 'MEXROW_USDT', baseCoin: 'MEXROW', quoteCoin: 'USDT', state: 0 },
    { symbol: 'BTC_USDT_PRE', baseCoin: 'BTC', quoteCoin: 'USDT', state: 0 },
    { symbol: 'OFF_USDT', baseCoin: 'OFF', quoteCoin: 'USDT', state: 2 }
  ]
}

const mexcSpotBody = {
  symbols: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true },
    { symbol: 'MXCUSDT', baseAsset: 'MXC', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true },
    { symbol: 'NOUSDT', baseAsset: 'NO', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: false },
    { symbol: 'GONEUSDT', baseAsset: 'GONE', quoteAsset: 'USDT', status: '3', isSpotTradingAllowed: true }
  ]
}

const okFetch = async (url: string) => ({
  ok: true,
  json: async () => (
    url.includes('contract.mexc') ? mexcFutBody
    : url.includes('api.mexc') ? mexcSpotBody
    : url.includes('gateio') && url.includes('futures') ? gateFutBody
    : url.includes('gateio') ? gateSpotBody
    : url.includes('bitget') && url.includes('mix') ? bitgetFutBody
    : url.includes('bitget') ? bitgetSpotBody
    : url.includes('bybit') ? bybitBody
    : url.includes('okx') ? okxBody
    : url.includes('bingx') && url.includes('swap') ? bingxBody
    : url.includes('bingx') ? bingxSpotBody
    : url.includes('coingecko') ? geckoBody
    : spotBody
  )
})

const staticRows: UniverseRow[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', type: 'perp', markets: ['futures'], venues: ['binance'], source: 'static' }
]

describe('mergeUniverse — static wins, live fills gaps, venues union', () => {
  test('static rows keep venue depth; live adds unseen symbol+type only', () => {
    const live: UniverseRow[] = [
      { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', type: 'perp', markets: ['futures'], venues: ['bybit'], source: 'bybit' },
      { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', type: 'spot', markets: ['spot'], venues: ['binance'], source: 'binance-spot' }
    ]
    const out = mergeUniverse(staticRows, live)
    assert.equal(out.length, 2)
    assert.equal(out.find((r) => r.type === 'perp')?.source, 'static')
    assert.deepEqual(out.find((r) => r.type === 'perp')?.venues, ['binance', 'bybit'])
    assert.equal(out.find((r) => r.type === 'spot')?.source, 'binance-spot')
    assert.deepEqual(out.map((r) => r.symbol), ['BTCUSDT', 'BTCUSDT'])
  })
})

describe('getUniverse — live fetch, filter, cache, degrade', () => {
  test('bybit keeps linear-trading only; spot keeps TRADING majors only', async () => {
    resetUniverseCache()
    const payload = await getUniverse({ fetchImpl: okFetch as never, now: () => 1_000 })
    const syms = payload.rows.map((r) => `${r.symbol}|${r.type}|${r.source}`)
    assert.ok(syms.some((s) => s === 'BTCUSDT|perp|static'), 'static perp wins, got: ' + syms.join(','))
    assert.ok(syms.some((s) => s === 'PEPEUSDT|perp|bybit'), 'live perp added, got: ' + syms.join(','))
    assert.ok(!syms.some((s) => s.startsWith('BTCUSD|')), 'inverse perp excluded')
    assert.ok(!syms.some((s) => s === 'DOGEUSDT|perp|bybit'), 'closed market excluded from live source')
    assert.ok(syms.some((s) => s === 'XRPBTC|spot|binance-spot'), 'spot BTC-quoted kept')
    assert.ok(!syms.some((s) => s.startsWith('FOOXYZ')), 'exotic quote excluded')
    assert.ok(!syms.some((s) => s.startsWith('OLDBTC')), 'halted market excluded')
    const pepe = payload.rows.find((r) => r.symbol === 'PEPEUSDT' && r.type === 'perp')
    assert.ok(pepe, 'bybit+okx linear present')
    assert.deepEqual(pepe!.venues, ['bybit', 'okx'], 'venues union across live sources')
    assert.ok(!syms.some((s) => s.includes('BTC-USD-SWAP')), 'okx inverse excluded')
    assert.ok(syms.some((s) => s === 'ORDIUSDT|perp|bingx'), 'bingx contract added')
    assert.ok(!syms.some((s) => s.startsWith('DEADUSDT')), 'inactive bingx excluded')
    assert.ok(syms.some((s) => s === 'BTC.D|index|coingecko'), 'dominance index present')
    assert.ok(syms.some((s) => s === 'TOTAL2|index|coingecko'), 'TOTAL2 present')
    assert.ok(syms.some((s) => s === 'TOTAL3|index|coingecko'), 'TOTAL3 present')
    const btcD = payload.rows.find((r) => r.symbol === 'BTC.D')
    assert.equal(btcD?.value, 60)
    const total2 = payload.rows.find((r) => r.symbol === 'TOTAL2')
    assert.equal(total2?.value, 3000000000000 * 0.4)
    assert.equal(payload.meta.degraded, false)
    assert.deepEqual(payload.meta.sources, [
      'bybit', 'okx', 'bingx', 'bingx-spot', 'binance-spot',
      'gate', 'gate-spot', 'bitget', 'bitget-spot', 'mexc', 'mexc-spot',
      'coingecko', 'static'
    ])
    assert.equal(payload.meta.counts.index, 4)
  })

  test('gate/bitget/mexc/bingx-spot rows are filtered, normalized and venued', async () => {
    resetUniverseCache()
    const payload = await getUniverse({ fetchImpl: okFetch as never, now: () => 1_000 })
    const syms = payload.rows.map((r) => `${r.symbol}|${r.type}|${r.source}`)

    // Gate: underscore-native -> engine symbol, crypto-only, delisted dropped.
    assert.ok(syms.includes('GATEROWUSDT|perp|gate'), 'gate perp added, got: ' + syms.join(','))
    assert.ok(syms.includes('GTCUSDT|spot|gate-spot'), 'gate spot added')
    assert.ok(!syms.some((s) => s.startsWith('AAPLX|')), 'gate non-crypto contract excluded')
    assert.ok(!payload.rows.some((r) => r.symbol === 'OLDCOINUSDT'), 'gate delisted excluded')

    // Bitget: `perp` symbolType only, offline pair dropped.
    assert.ok(syms.includes('BGSUSDT|perp|bitget'), 'bitget perp added')
    assert.ok(syms.includes('BSPUSDT|spot|bitget-spot'), 'bitget spot added + base upper-cased')
    assert.ok(!syms.some((s) => s.startsWith('BTCDOMUSDT|perp|bitget')), 'halted bitget contract excluded')
    assert.ok(!syms.some((s) => s === 'HALTUSDT|spot|bitget-spot'), 'halted bitget spot excluded')

    // MEXC: `BASE_USDT` only (never pre-market/index), disabled state dropped.
    assert.ok(syms.includes('MEXROWUSDT|perp|mexc'), 'mexc perp added')
    assert.ok(syms.includes('MXCUSDT|spot|mexc-spot'), 'mexc spot added')
    assert.ok(!payload.rows.some((r) => r.base === 'OFF'), 'mexc disabled contract excluded')
    assert.ok(!payload.rows.some((r) => r.base === 'NO'), 'mexc spot-disabled pair excluded')

    // BingX spot: dash-native, online + both sides open.
    assert.ok(syms.includes('SEIUSDT|spot|bingx-spot'), 'bingx spot added')
    assert.ok(!syms.some((s) => s.startsWith('GONEUSDT|spot')), 'offline bingx spot excluded')
    assert.ok(!syms.some((s) => s.startsWith('FROZENUSDT|spot')), 'one-sided bingx spot excluded')

    // Invariant: vendor-native separators never leak into engine symbols.
    assert.ok(!payload.rows.some((r) => /[_-]/.test(r.symbol)), 'symbols are normalized')
    // Pre-market / delivery contracts never survive the normalization.
    assert.ok(!payload.rows.some((r) => r.symbol.includes('PRE')), 'pre-market excluded')

    // Venue provenance stays per-source.
    const mexcRow = payload.rows.find((r) => r.symbol === 'MEXROWUSDT' && r.type === 'perp')
    assert.deepEqual(mexcRow?.venues, ['mexc'], 'per-venue provenance kept')
  })

  test('second call inside TTL serves cache without fetching', async () => {
    let calls = 0
    const counting = async (url: string) => {
      calls++
      return okFetch(url)
    }
    resetUniverseCache()
    await getUniverse({ fetchImpl: counting as never, now: () => 1_000 })
    await getUniverse({ fetchImpl: counting as never, now: () => 2_000 })
    assert.equal(calls, 12) // one sweep = 12 vendors, second call cached
  })

  test('one vendor failing only marks that source missing (per-source fail-soft)', async () => {
    resetUniverseCache()
    const partial = async (url: string) => {
      if (url.includes('gateio')) return { ok: false, status: 500, json: async () => ({}) }
      return okFetch(url)
    }
    const payload = await getUniverse({ fetchImpl: partial as never, now: () => 1_000 })
    assert.equal(payload.meta.degraded, true)
    assert.ok(!payload.meta.sources.includes('gate'), 'failed vendor reported missing')
    assert.ok(payload.meta.sources.includes('gate-spot') === false, 'both gate endpoints failed')
    assert.ok(payload.meta.sources.includes('bitget'), 'other vendors unaffected')
  })

  test('total outage degrades to static-only, never throws', async () => {
    resetUniverseCache()
    const down = async () => ({ ok: false, status: 418, json: async () => ({}) })
    const payload = await getUniverse({ fetchImpl: down as never, now: () => 1_000 })
    assert.equal(payload.meta.degraded, true)
    assert.ok(payload.rows.length > 0, 'static catalog keeps search alive')
    assert.ok(payload.rows.every((r) => r.source === 'static'))
  })
})
