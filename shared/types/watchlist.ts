// =============================================================================
//  Watchlist (S8 chunk 1) — shared types for named, server-persisted watchlists.
//
//  One row per named list, owned by a hub user (`ownerId = sub`). The default
//  list is the one the trading panel reads; additional lists are user-created
//  and switchable from the Lists tab on /watchlist. `symbols` is an ordered
//  array of uppercase symbol strings (e.g. BTCUSDT, ETHUSDT).
// =============================================================================

export interface WatchlistItem {
  _id: string
  ownerId: string
  name: string
  symbols: string[]
  /** Denormalized UI-stability hint (0-based). Mirrors `symbols` order. */
  order?: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface WatchlistListResponse {
  success: true
  data: WatchlistItem[]
  meta: {
    count: number
    mongo: 'up' | 'down'
  }
}

export interface WatchlistResponse {
  success: true
  data: WatchlistItem
}

export interface WatchlistCreateBody {
  name: string
  symbols?: string[]
}

export interface WatchlistUpdateBody {
  name?: string
  symbols?: string[]
  /** Full ordered array of symbols (the new order). Same set as stored, else 400. */
  order?: string[]
}