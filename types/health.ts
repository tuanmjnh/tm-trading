import type { IntelServiceRow } from './intel'

// =============================================================================
//  Health projections (roadmap §58 acceptance #6).
//
//  MARKET DATA PROVIDER health (per-venue public REST probes) is DISTINCT from
//  generic tm-hub connection records. Provider probes live in
//  server/api/v1/market-sources/health.get.ts; the generic connection catalogue
//  lives in tm-hub (/api/v1/apps/:appId/connections) and is surfaced by
//  app/pages/shared-resources/connections.vue.
// =============================================================================

/** Health probe of a single market data venue. */
export interface MarketSourceHealth {
  venue: string
  status: 'up' | 'down' | 'unknown'
  latencyMs?: number
  error?: string
  /** Number of instruments that list this venue. */
  instruments: number
}

export interface MarketSourceHealthResponse {
  success: boolean
  data: MarketSourceHealth[]
  meta: { total: number, healthy: number }
}

/** Aggregate platform health: database + background services + runtime. */
export interface SystemHealth {
  status: 'healthy' | 'degraded'
  db: 'ok' | 'unconfigured' | 'error'
  services: IntelServiceRow[]
  version: string
  uptimeSec: number
  latencyMs: number
  time: string
}

export interface SystemHealthResponse {
  success: boolean
  data: SystemHealth
}
