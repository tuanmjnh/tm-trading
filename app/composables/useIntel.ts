import type { IntelData, IntelResponse } from '~~/types/intel'

// =============================================================================
//  Market intelligence API (Nitro internal route — Phase 8). Fail-soft: Mongo
//  down / services chua chay van tra 200 + mongo='down' + mang rong.
// =============================================================================

export const useIntel = () => {
  async function get(): Promise<IntelData> {
    const res = await $fetch<IntelResponse>('/api/v1/intel')
    if (!res.data) throw new Error('intel.loadFailed')
    return res.data
  }

  return { get }
}
