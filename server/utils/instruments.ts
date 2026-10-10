// =============================================================================
//  TM TRADING — Canonical Instrument Catalog (roadmap §26, §30.1).
//
//  This is the SINGLE SOURCE of truth for instrument metadata. It maps the
//  engine's internal symbols (e.g. 'BTCUSDT') to canonical identifiers
//  (e.g. 'crypto:perp:BTC/USDT') and declares which venues serve each.
//
//  §30.1 Instrument APIs serve this catalog.
//  §36 Cross-Exchange Scanner reads the `venues` array for native symbols.
// =============================================================================

/** Canonical instrument type. */
export const INSTRUMENT_TYPES = Object.freeze([
  'spot', 'perp', 'future', 'option',
])

/** Canonical venue identifiers (matching market/providers/*.mjs `id`). */
export const VENUE_IDS = Object.freeze([
  'binance', 'bybit', 'okx',
])

/** One venue mapping for an instrument. */
export interface InstrumentVenue {
  venue: string
  native: string
  market?: 'spot' | 'futures'
}

/** Canonical instrument definition. */
export interface Instrument {
  id: string // e.g. 'crypto:perp:BTC/USDT'
  symbol: string // e.g. 'BTC/USDT' (human-readable)
  type: 'spot' | 'perp' | 'future' | 'option'
  base: string // e.g. 'BTC'
  quote: string // e.g. 'USDT'
  venues: InstrumentVenue[]
  status: 'active' | 'inactive' | 'delisted'
  /** Engine-internal symbol (e.g. 'BTCUSDT') for backward compat. */
  engineSymbol?: string
}

/** The master instrument catalog. Single source of truth. */
export const INSTRUMENTS: Instrument[] = [
  {
    id: 'crypto:perp:BTC/USDT',
    symbol: 'BTC/USDT',
    type: 'perp',
    base: 'BTC',
    quote: 'USDT',
    venues: [
      { venue: 'binance', native: 'BTCUSDT', market: 'futures' },
      { venue: 'bybit', native: 'BTCUSDT', market: 'futures' },
      { venue: 'okx', native: 'BTC-USDT-SWAP', market: 'futures' },
    ],
    status: 'active',
    engineSymbol: 'BTCUSDT',
  },
  {
    id: 'crypto:perp:ETH/USDT',
    symbol: 'ETH/USDT',
    type: 'perp',
    base: 'ETH',
    quote: 'USDT',
    venues: [
      { venue: 'binance', native: 'ETHUSDT', market: 'futures' },
      { venue: 'bybit', native: 'ETHUSDT', market: 'futures' },
      { venue: 'okx', native: 'ETH-USDT-SWAP', market: 'futures' },
    ],
    status: 'active',
    engineSymbol: 'ETHUSDT',
  },
  {
    id: 'crypto:spot:BTC/USDT',
    symbol: 'BTC/USDT',
    type: 'spot',
    base: 'BTC',
    quote: 'USDT',
    venues: [
      { venue: 'binance', native: 'BTCUSDT', market: 'spot' },
    ],
    status: 'active',
    engineSymbol: 'BTCUSDT',
  },
  {
    id: 'crypto:spot:ETH/USDT',
    symbol: 'ETH/USDT',
    type: 'spot',
    base: 'ETH',
    quote: 'USDT',
    venues: [
      { venue: 'binance', native: 'ETHUSDT', market: 'spot' },
    ],
    status: 'active',
    engineSymbol: 'ETHUSDT',
  },
]

/** Fast lookup by id. */
export const INSTRUMENT_BY_ID = Object.freeze(
  Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]))
)

/** Fast lookup by engine symbol (e.g. 'BTCUSDT'). */
export const INSTRUMENT_BY_ENGINE_SYMBOL = Object.freeze(
  Object.fromEntries(
    INSTRUMENTS.filter((i) => i.engineSymbol).map((i) => [i.engineSymbol!, i])
  )
)

/** All venue ids present in the catalog. */
export const CATALOG_VENUES = Object.freeze(
  [...new Set(INSTRUMENTS.flatMap((i) => i.venues.map((v) => v.venue)))]
)

/** Lookup by id (returns undefined if not found). */
export function getInstrument(id: string): Instrument | undefined {
  return INSTRUMENT_BY_ID[id]
}

/** Lookup by engine symbol (e.g. 'BTCUSDT'). */
export function getInstrumentByEngineSymbol(sym: string): Instrument | undefined {
  return INSTRUMENT_BY_ENGINE_SYMBOL[sym]
}

/** All active instruments (optionally filtered by type). */
export function listInstruments(opts: { type?: string; status?: string } = {}): Instrument[] {
  return INSTRUMENTS.filter((i) => {
    if (opts.type && i.type !== opts.type) return false
    if (opts.status && i.status !== opts.status) return false
    return true
  })
}

/** Venues for a given instrument id. */
export function getInstrumentVenues(id: string): InstrumentVenue[] {
  return getInstrument(id)?.venues ?? []
}