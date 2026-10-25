import { fetchHubProviderPresets } from './aiProviderHubCatalog'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineDb } from './engineModel'

// =============================================================================
//  AI provider connections (Phase G, D35 — app-owned).
//
//  The store decrypts secrets; this layer must only ever return redacted rows.
//  The catalog is public metadata (no credentials), so it is safe to send to the
//  settings UI.
// =============================================================================

type AnyFn = (...args: any[]) => any
type Loose<T> = { [K in keyof T]: T[K] extends AnyFn ? AnyFn : T[K] }
type StoreModule = Loose<typeof import('../../ai/providerStore.mjs')>
type PureModule = Loose<typeof import('../../engine/aiProviders.mjs')>

let storeP: Promise<StoreModule> | null = null
let pureP: Promise<PureModule> | null = null

async function ensureDb() {
  const db = await engineDb()
  const mongoose = await db.connectMongo()
  if (!mongoose) {
    throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })
  }
}

function loadStore(): Promise<StoreModule> {
  if (!storeP) {
    storeP = (async () => {
      await ensureDb()
      const href = pathToFileURL(join(process.cwd(), 'ai', 'providerStore.mjs')).href
      return import(/* @vite-ignore */ href) as Promise<StoreModule>
    })().catch((err) => {
      storeP = null
      throw err
    })
  }
  return storeP
}

function loadPure(): Promise<PureModule> {
  if (!pureP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'aiProviders.mjs')).href
    pureP = import(/* @vite-ignore */ href) as Promise<PureModule>
  }
  return pureP
}

export async function providerCatalog() {
  const pure = await loadPure()
  const env = pure.envConnection ? pure.envConnection(process.env) : null

  // Hub-driven presets (R147 companion): merged behind the builtin catalog —
  // fail-soft (hub down / not deployed → builtin-only), adapter-filtered to
  // what this engine can execute, same-key hub preset overrides the builtin
  // (central baseUrl correction without a code change).
  let hubPresets: Awaited<ReturnType<typeof fetchHubProviderPresets>> = []
  try {
    hubPresets = await fetchHubProviderPresets()
  } catch {
    hubPresets = []
  }
  const builtinKeys = new Set(pure.AI_PROVIDER_CATALOG.map((p: { key: string }) => p.key))
  const implementedAdapters = new Set(pure.AI_ADAPTER_TYPES as string[])
  const fromHub = hubPresets
    .filter(p => implementedAdapters.has(p.adapter))
    .map(p => ({
      key: p.key,
      name: p.name,
      adapter: p.adapter,
      baseUrl: p.baseUrl ?? null,
      requiresBaseUrl: !p.baseUrl,
      keyless: false,
      privacy: 'vendor' as const,
      capabilities: { chat: true, tools: true, structured: true, streaming: true },
      origin: 'hub' as const
    }))
    .filter(p => !builtinKeys.has(p.key))

  return {
    schemaVersion: pure.AI_PROVIDER_SCHEMA_VERSION,
    providers: [...pure.AI_PROVIDER_CATALOG, ...fromHub],
    adapterTypes: pure.AI_ADAPTER_TYPES,
    capabilityKeys: pure.AI_CAPABILITY_KEYS,
    env: env
      ? { provider: env.provider, model: env.model, baseUrl: env.baseUrl, configured: true, source: 'env' }
      : { provider: null, model: null, baseUrl: null, configured: false, source: 'env' },
  }
}

export async function listAiConnections(ownerId: string) {
  const store = await loadStore()
  return store.listConnections({ ownerId })
}

export async function saveAiConnection(ownerId: string, input: Record<string, unknown>) {
  const store = await loadStore()
  return store.upsertConnection(
    {
      id: typeof input.id === 'string' ? input.id : undefined,
      name: typeof input.name === 'string' ? input.name : undefined,
      provider: typeof input.provider === 'string' ? input.provider : undefined,
      baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
      model: typeof input.model === 'string' ? input.model : undefined,
      apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
      enabled: input.enabled !== false,
      ownerId,
    },
    { actor: ownerId },
  )
}

export async function testAiConnection(ownerId: string, id: string) {
  const store = await loadStore()
  const row = await store.getConnectionRow(id, { ownerId })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'error.not_found', message: 'connection not found' })
  return store.testConnection(row, { actor: ownerId })
}

export async function exportAiConnections(ownerId: string, includeSecrets: boolean) {
  const store = await loadStore()
  return store.exportConnections({ ownerId, includeSecrets })
}

export async function parseAiProviderImport(payload: unknown, defaultModel: string) {
  const pure = await loadPure()
  return pure.parseConnectionImport(payload, { defaultModel })
}

export async function discoverAiModels(ownerId: string, input: Record<string, unknown>) {
  const store = await loadStore()
  // Edit mode: no key in the form → fall back to the connection's STORED key
  // (decrypted server-side, never returned to the client — D35).
  let apiKey = typeof input.apiKey === 'string' ? input.apiKey : undefined
  const connectionId = typeof input.connectionId === 'string' ? input.connectionId : undefined
  if (!apiKey && connectionId) {
    const row = await store.getConnectionRow(connectionId, { ownerId })
    if (!row) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'connection not found' })
    if (!row.secretEnc && !store.providerDefinition(row.provider)?.keyless) {
      throw createError({ statusCode: 400, statusMessage: 'error.ai_no_key', message: 'connection has no stored key' })
    }
    try { apiKey = (await getStoredAiKey(ownerId, connectionId)) ?? undefined } catch { apiKey = undefined }
  }
  return store.discoverModelsForInput({
    provider: typeof input.provider === 'string' ? input.provider : undefined,
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
    apiKey,
    model: typeof input.model === 'string' ? input.model : undefined,
  })
}

export async function importAiConnections(ownerId: string, rows: unknown[], overwrite: boolean) {
  const store = await loadStore()
  return store.importConnections(rows, { ownerId, overwrite, actor: ownerId })
}

/** Existing `provider:name` keys among `rows` — used by the import preview. */
export async function findExistingAiConnections(ownerId: string, rows: unknown[]) {
  const store = await loadStore()
  return store.existingConnectionKeys({ ownerId, rows: rows as any[] })
}

/** Decrypt a stored envelope server-side (never crosses back to the client). */
export async function getStoredAiKey(ownerId: string, connectionId: string): Promise<string | undefined> {
  const store = await loadStore()
  const row = await store.getConnectionRow(connectionId, { ownerId })
  if (!row?.secretEnc) return undefined
  try { return store.decryptStored(row.secretEnc) ?? undefined } catch { return undefined }
}

// =============================================================================
//  Model catalogue (Phase G.5) — many saved models per connection; the bot's
//  active model is connection.model, switched by setPrimaryModel.
// =============================================================================

export async function listAiModels(ownerId: string, connectionId: string) {
  const store = await loadStore()
  return store.listModels({ ownerId, connectionId })
}

export async function saveAiModels(
  ownerId: string,
  connectionId: string,
  models: Array<string | { model: string, displayName?: string }>,
  source: string,
) {
  const store = await loadStore()
  return store.upsertModels({ ownerId, connectionId, models, source })
}

/**
 * Pull the relay catalog from tm-hub and mirror it into local `provider='hub'`
 * rows. The app secret never leaves the server; failures carry stable codes.
 */
export async function syncAiProvidersFromHub(ownerId: string) {
  const store = await loadStore()
  const res = await store.syncHubCatalog({ ownerId, actor: ownerId })
  if (!res.ok) {
    const status = res.code === 'hub_not_configured' ? 400 : res.code === 'hub_timeout' ? 504 : 502
    throw createError({
      statusCode: status,
      statusMessage: `error.${String(res.code ?? 'hub_sync_failed')}`,
      message: String(res.error ?? res.code ?? 'hub sync failed').slice(0, 300),
    })
  }
  return {
    connections: res.connections,
    created: res.created,
    updated: res.updated,
    disabled: res.disabled,
    modelsAdded: res.modelsAdded,
  }
}

export async function setAiModelEnabled(ownerId: string, connectionId: string, model: string, isEnabled: boolean) {
  const store = await loadStore()
  return store.setModelEnabled({ ownerId, connectionId, model, isEnabled })
}

export async function setAiPrimaryModel(ownerId: string, connectionId: string, model: string) {
  const store = await loadStore()
  return store.setPrimaryModel({ ownerId, connectionId, model, actor: ownerId })
}

/** Clear the primary marker on a catalogue row (the active model string stays). */
export async function clearAiPrimaryModel(ownerId: string, connectionId: string, model: string) {
  const store = await loadStore()
  return store.unsetPrimaryModel({ ownerId, connectionId, model, actor: ownerId })
}

export async function deleteAiModel(ownerId: string, connectionId: string, model: string) {
  const store = await loadStore()
  return store.deleteModel({ ownerId, connectionId, model })
}

export async function deleteAiConnection(ownerId: string, id: string) {
  const store = await loadStore()
  const ok = await store.deleteConnection(id, { ownerId, actor: ownerId })
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'error.not_found', message: 'connection not found' })
  return { deleted: true }
}

export async function setAiConnectionEnabled(ownerId: string, id: string, enabled: boolean) {
  const store = await loadStore()
  const row = await store.setEnabled(id, enabled, { ownerId, actor: ownerId })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'error.not_found', message: 'connection not found' })
  return row
}

/** Internal request config for the gateway. Never return this from an endpoint. */
export async function resolveAiProvider(ownerId: string | null, opts: { id?: string | null; required?: string[] } = {}) {
  const store = await loadStore()
  return store.resolveProviderConfig({ ownerId, id: opts.id ?? null, required: opts.required ?? ['chat'] })
}

export function aiProviderHttpError(err: any) {
  if (err?.statusCode) return err
  const code = String(err?.code ?? '')
  const status =
    code === 'ai.connection-not-found' ? 404
      : code === 'ai.invalid-connection' || code === 'ai.no-key' ? 400
        : code === 'ai.no-credential-key' ? 503
          : 500
  return createError({
    statusCode: status,
    statusMessage: code || 'error.ai_provider',
    message: String(err?.message ?? 'AI provider operation failed').slice(0, 300),
  })
}
