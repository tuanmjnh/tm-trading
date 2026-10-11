import type { Instrument, InstrumentListResponse, VenueInfo, VenueListResponse } from '~~/types/instruments'

// =============================================================================
//  useMarketCatalog — canonical Instrument Catalog reads (roadmap §30.1,
//  §57.4 B). Market Explorer must consume these projections; no page may keep
//  its own symbol list. Fail-soft to [] like the other data composables.
// =============================================================================

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

  async function venues(): Promise<VenueInfo[]> {
    try {
      const res = await $fetch<VenueListResponse>('/api/v1/venues')
      return res.success ? res.data : []
    } catch {
      return []
    }
  }

  return { instruments, venues }
}
