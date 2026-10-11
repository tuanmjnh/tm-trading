// =============================================================================
//  Instrument Catalog projections (roadmap §7, §30.1, §57.4 B).
//
//  Mirrors server/utils/instruments.ts — the SINGLE canonical symbol source.
//  Market Explorer must consume these API projections, never a second
//  independent symbol list (§57.4 B).
// =============================================================================

/** One venue mapping for an instrument. */
export interface InstrumentVenue {
  venue: string
  native: string
  market?: 'spot' | 'futures'
}

/** Canonical instrument definition (server/utils/instruments.ts Instrument). */
export interface Instrument {
  id: string
  symbol: string
  type: 'spot' | 'perp' | 'future' | 'option'
  base: string
  quote: string
  venues: InstrumentVenue[]
  status: 'active' | 'inactive' | 'delisted'
  engineSymbol?: string
}

export interface InstrumentListResponse {
  success: boolean
  data: Instrument[]
  meta: { count: number }
}

/** Venue metadata: catalog presence vs registered market data provider. */
export interface VenueInfo {
  id: string
  inCatalog: boolean
  hasProvider: boolean
  instruments: string[]
}

export interface VenueListResponse {
  success: boolean
  data: VenueInfo[]
  meta: { count: number }
}
