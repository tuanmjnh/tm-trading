import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  Hub-driven provider preset catalog (R147 companion).
//
//  The hub owns a GLOBAL preset catalog (`provider_definitions`, managed from
//  the hub UI via `POST /api/v1/apps/:id/ai/providers`). This loader pulls it
//  app-keyed (X-App-Id + X-App-Secret — same identity as the relay catalog)
//  with a 5-minute cache and FAIL-SOFT semantics: hub unreachable, not yet
//  deployed, or a malformed payload simply yields an empty merge — the builtin
//  engine catalog keeps working offline.
//
//  Merge rules (applied by the caller):
//    - adapters not implemented by the engine are dropped (hub presets are
//      metadata; the engine decides what it can execute)
//    - a hub preset with the same key as a builtin OVERRIDES it (central
//      baseUrl correction without a code change)
// =============================================================================

export interface HubPreset {
  key: string
  name: string
  adapter: string
  baseUrl: string | null
  capabilities: string[]
  discovery: string | null
  docsUrl: string | null
  isBuiltin: boolean
}

type HubEnvModule = { hubRelayEnv: (env?: unknown) => { url: string, appId: string, secret: string } | null }

let hubEnvP: Promise<HubEnvModule> | null = null
function loadHubEnv(): Promise<HubEnvModule> {
  // Reuse the relay env resolution (same three vars, same rules).
  hubEnvP ??= import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'ai', 'providerStore.mjs')).href) as Promise<HubEnvModule>
  return hubEnvP
}

const CACHE_TTL_MS = 5 * 60 * 1000
let cache: HubPreset[] | null = null
let cacheExpiresAt = 0
let inFlight: Promise<HubPreset[]> | null = null

function hubUrl(relay: { url: string, appId: string }): string {
  return `${relay.url}/api/v1/apps/${relay.appId}/ai/provider-presets`
}

export async function fetchHubProviderPresets(fetchImpl: typeof fetch = globalThis.fetch): Promise<HubPreset[]> {
  if (cache && cacheExpiresAt > Date.now()) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const mod = await loadHubEnv()
      const relay = mod.hubRelayEnv()
      if (!relay) return cache ?? []

      const res = await fetchImpl(hubUrl(relay), {
        headers: { accept: 'application/json', 'x-app-id': relay.appId, 'x-app-secret': relay.secret }
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(body?.data?.presets)) {
        return cache ?? []
      }
      cache = body.data.presets as HubPreset[]
      cacheExpiresAt = Date.now() + CACHE_TTL_MS
      return cache
    } catch {
      return cache ?? []
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
