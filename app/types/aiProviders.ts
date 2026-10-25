// Phase G / D35 — shared surfaces between the AI providers settings components.
// The client only ever sees redacted rows: the key is write-only.

export interface AiProviderDef {
  key: string
  name: string
  adapter: string
  baseUrl: string | null
  requiresBaseUrl: boolean
  keyless: boolean
  capabilities: Record<string, boolean>
}

export interface AiProviderConnectionRow {
  id: string
  name: string
  provider: string
  adapter: string
  baseUrl: string
  model: string
  enabled: boolean
  hasSecret: boolean
  keyless: boolean
  secretMask: string
  status: string
  lastTestedAt: number | null
  lastError: string | null
  lastErrorCode?: string | null
  testLatencyMs?: number | null
  hubConnectionId?: string | null
  hubProvider?: string | null
  hubSyncedAt?: number | null
}

// Per-connection model catalogue (Phase G.5) — mirrors tm-hub R147.
export interface AiProviderCatalogModel {
  model: string
  displayName?: string | null
  isEnabled: boolean
  isPrimary: boolean
  source: string
}

export interface AiProvidersResponse {
  providers: AiProviderDef[]
  connections: AiProviderConnectionRow[]
  env: { configured: boolean, provider: string | null, model: string | null }
}
