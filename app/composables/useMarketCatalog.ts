import type { Instrument, InstrumentListResponse, VenueInfo, VenueListResponse } from '#shared/types/instruments'

// =============================================================================
//  useMarketCatalog — canonical Instrument Catalog reads (roadmap §30.1,
//  §57.4 B). Market Explorer must consume these projections; no page may keep
//  its own symbol list. Fail-soft to [] like the other data composables.
// =============================================================================

export interface UniverseRow {
  symbol: string
  base: string
  quote: string
  type: 'perp' | 'spot' | 'index'
  markets: string[]
  venues: string[]
  source: string
  value?: number | null
  unit?: string | null
}

export interface UniverseMeta {
  updatedAt: number | null
  counts: { perp: number; spot: number; index: number }
  sources: string[]
  degraded: boolean
  cached: boolean
}

export const useMarketCatalog = () => {
  async function instruments(opts: { type?: string, status?: string } = {}): Promise<Instrument[]> {
    try {
      const res = await $fetch<InstrumentListResponse>('/api/v1/instruments', {
        query: { type: opts.type || undefined, status: opts.status || undefined }
      })
      return res.success ? res.data : []
    } catch {
      return []
    }
  }

  /**
   * Live symbol universe (Bybit/OKX/BingX perps + Binance spot + static
   * catalog + CoinGecko indices). Fail-soft to null — callers fall back to
   * the served-symbols list so search never breaks when vendors are down.
   */
  async function universe(): Promise<{ rows: UniverseRow[]; meta: UniverseMeta } | null> {
    try {
      const res = await $fetch<{ success: boolean; data: UniverseRow[]; meta: UniverseMeta }>(
        '/api/v1/instruments/universe'
      )
      if (!res.success) return null
      return { rows: res.data ?? [], meta: res.meta }
    } catch {
      return null
    }
  }

  async function venues(): Promise<VenueInfo[]> {
    try {
      const res = await $fetch<VenueListResponse>('/api/v1/venues')
      return res.success ? res.data : []
    } catch {
      return []
    }
  }

  return { instruments, venues, universe }
}
