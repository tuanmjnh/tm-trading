import type { MarketSourceHealthResponse, SystemHealthResponse } from '#shared/types/health'

// =============================================================================
//  useSystemHealth — read-only health projections (roadmap §58 acceptance #6).
//
//  `marketSources()` probes each market data venue via the local Nitro route
//  (DISTINCT from the tm-hub connection catalogue rendered by
//  shared-resources/connections.vue). `system()` aggregates DB + background
//  service heartbeats. Both make INTERNAL calls under /api/v1.
// =============================================================================

export const useSystemHealth = () => {
  async function marketSources(): Promise<MarketSourceHealthResponse> {
    return await $fetch<MarketSourceHealthResponse>('/api/v1/market-sources/health')
  }

  async function system(): Promise<SystemHealthResponse> {
    return await $fetch<SystemHealthResponse>('/api/v1/health')
  }

  /** Trigger an immediate re-probe of all services (or one specific service). */
  async function reprobeServices(service?: string): Promise<{ success: boolean; data?: any }> {
    return await $fetch<{ success: boolean; data?: any }>('/api/v1/admin/health/services/reprobe', {
      method: 'POST',
      body: service ? { service } : {}
    })
  }

  return { marketSources, system, reprobeServices }
}
