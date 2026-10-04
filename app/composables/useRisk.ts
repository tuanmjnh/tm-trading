import type { RiskStatusData, RiskStatusResponse } from '~~/types/risk'

// =============================================================================
//  Risk gate status API (Nitro internal route — does NOT go to tm-hub; D10 still
//  attaches the token like other modules).
// =============================================================================

export const useRisk = () => {
  async function status(): Promise<RiskStatusData> {
    const res = await $fetch<RiskStatusResponse>('/api/v1/risk/status')
    if (!res.data) throw new Error('risk.loadFailed')
    return res.data
  }

  return { status }
}
