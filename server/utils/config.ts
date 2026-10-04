import { getAllConfigs as serviceGetAllConfigs, getSingleConfig as serviceGetSingleConfig, setConfig as serviceSetConfig, getPublicConfigs as serviceGetPublicConfigs } from '#server/modules/config/service'
import { getSupabaseAdmin } from '#server/modules/database/supabase'
import { decryptConfigValue } from '#server/modules/config/encryption'
import type { AppFeatureFlags } from '#server/types/app-config'
import type { H3Event } from 'h3'

interface AuthPayload {
  sub: string
  appId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  allowedRoutes: string[]
}

interface AuditContext {
  ip?: string
  userAgent?: string
  source: 'tm-hub_internal' | 'external_app'
}

interface CachedConfig {
  data: Record<string, unknown>
  meta: Array<{ key: string; category: string; isSecret: boolean; isPublic: boolean; description: string | null; updatedAt: string }>
  timestamp: number
}

interface CachedSingleConfig {
  data: { key: string; category: string; value: unknown; isSecret: boolean; isPublic: boolean; description?: string; updatedAt: string }
  timestamp: number
}

interface CachedFeatureFlags {
  data: AppFeatureFlags
  timestamp: number
}

const CONFIG_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const configCache = new Map<string, CachedConfig>()
const singleConfigCache = new Map<string, CachedSingleConfig>()
const featureFlagsCache = new Map<string, CachedFeatureFlags>()

function getCacheKey(appId: string, suffix = ''): string {
  return `${appId}${suffix}`
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CONFIG_CACHE_TTL
}

function invalidateAppCache(appId: string): void {
  configCache.delete(getCacheKey(appId))
  configCache.delete(getCacheKey(appId, ':withSecrets'))
  
  for (const key of singleConfigCache.keys()) {
    if (key.startsWith(appId + ':')) {
      singleConfigCache.delete(key)
    }
  }
  
  featureFlagsCache.delete(getCacheKey(appId, ':features'))
}

export async function getAppConfigs(appId: string, payload: AuthPayload, includeSecrets = false): Promise<Record<string, unknown>> {
  const cacheKey = getCacheKey(appId, includeSecrets ? ':withSecrets' : '')
  const cached = configCache.get(cacheKey)
  
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data
  }

  const result = await serviceGetAllConfigs({ appId, payload, includeSecrets, limit: 1000 })
  
  configCache.set(cacheKey, {
    data: result.data,
    meta: result.meta,
    timestamp: Date.now(),
  })
  
  return result.data
}

export async function getAppConfig(appId: string, key: string, payload: AuthPayload, includeSecret = false): Promise<unknown> {
  const cacheKey = getCacheKey(appId, `:${key}`)
  const cached = singleConfigCache.get(cacheKey)
  
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data.value
  }

  const result = await serviceGetSingleConfig(appId, key, payload, includeSecret)
  
  singleConfigCache.set(cacheKey, {
    data: result.data,
    timestamp: Date.now(),
  })
  
  return result.data.value
}

const FEATURE_SECTIONS = ['auth', 'mail', 'notifications', 'media', 'import', 'api'] as const

const DEFAULT_FEATURE_FLAGS = {
  auth: { password: true, passkey: true, oauth: false, totp: true, register: true, emailVerification: true, passwordReset: true, deviceLimits: true },
  mail: { enabled: false, provider: false },
  notifications: { push: true, email: true, inApp: true },
  media: { enabled: true, provider: false },
  import: { enabled: true, maxRows: 10000 },
  api: { rateLimit: true, cors: true },
} as AppFeatureFlags

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v)
    else out[k] = v
  }
  return out as T
}

function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  const last = parts.pop()!
  let cur: Record<string, unknown> = target
  for (const p of parts) {
    if (!isPlainObject(cur[p])) cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[last] = value
}

/**
 * Merge app_configs rows -> feature layer (pure, no I/O - testable):
 * - key `features` (blob seed) -> merge known sections
 * - leaf keys (`mail.enabled`, `auth.passkey.mode`, ...) -> setNested (overrides blob)
 * DB row ordering does not affect result (leaf always overrides blob).
 */
export function buildFeatureLayer(rows: Array<{ key: string; value: string }>): Record<string, unknown> {
  const layer: Record<string, unknown> = {}
  const parse = (v: string): unknown => {
    try { return JSON.parse(v) } catch { return v }
  }

  // Pass 1: blob ('features' -> merge by section; 'mail' -> mail section) as baseline.
  for (const row of rows) {
    const parsed = parse(row.value)
    if (!isPlainObject(parsed)) continue
    if (row.key === 'features') {
      for (const s of FEATURE_SECTIONS) {
        if (isPlainObject(parsed[s])) layer[s] = deepMerge(isPlainObject(layer[s]) ? layer[s] : {}, parsed[s])
      }
    } else if (row.key === 'mail') {
      layer.mail = deepMerge(isPlainObject(layer.mail) ? layer.mail : {}, parsed)
    }
  }

  // Pass 2: leaf keys ('mail.enabled', 'auth.passkey.mode', ...) always override blob.
  for (const row of rows) {
    if (!row.key.includes('.')) continue
    const section = row.key.split('.')[0] ?? ''
    if ((FEATURE_SECTIONS as readonly string[]).includes(section)) {
      setNested(layer, row.key, parse(row.value))
    }
  }
  return layer
}

async function fetchFeatureLayer(appId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('app_configs').select('key, value').eq('app_id', appId)
  if (error) throwDbError(error, 'utils/config.ts:fetchFeatureLayer')
  return buildFeatureLayer(data || [])
}

/**
 * Consolidated feature flags: defaults <- system app config (hub) <- app config.
 * Read directly via service-role (bypasses authz) - this is infrastructure config, not user data.
 * payload kept for legacy signature compatibility; no longer used for authz.
 */
export async function getAppFeatureFlags(appId: string, payload?: AuthPayload): Promise<AppFeatureFlags> {
  void payload
  const cacheKey = getCacheKey(appId, ':features')
  const cached = featureFlagsCache.get(cacheKey)

  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data
  }

  const hubAppId = useRuntimeConfig().public.hubAppId as string
  const appLayer = await fetchFeatureLayer(appId)
  const systemLayer = appId === hubAppId ? {} : await fetchFeatureLayer(hubAppId)

  const merged = deepMerge(
    deepMerge(DEFAULT_FEATURE_FLAGS as unknown as Record<string, unknown>, systemLayer),
    appLayer
  ) as unknown as AppFeatureFlags

  featureFlagsCache.set(cacheKey, { data: merged, timestamp: Date.now() })

  return merged
}

/**
 * Read a flag by path (e.g. `mail.enabled`, `import.maxRows`).
 * - missing path -> true (fail-open, defaults defined in DEFAULT_FEATURE_FLAGS)
 * - boolean -> itself; object -> `.enabled` if present, otherwise true
 */
export async function isFeatureEnabled(appId: string, path: string): Promise<boolean> {
  const flags = await getAppFeatureFlags(appId)
  const value = path.split('.').reduce<unknown>((acc, part) => {
    if (isPlainObject(acc)) return acc[part]
    return undefined
  }, flags as unknown)

  if (value === undefined) return true
  if (typeof value === 'boolean') return value
  if (isPlainObject(value)) {
    if (typeof value.enabled === 'boolean') return value.enabled
    return true
  }
  return Boolean(value)
}

/**
 * Throw 403 when feature is disabled in Features tab (feature flag enforcement).
 */
export async function requireFeature(appId: string, path: string): Promise<void> {
  if (await isFeatureEnabled(appId, path)) return
  throw createError({
    statusCode: 403,
    statusMessage: 'error.featureDisabled',
    message: `Feature '${path}' is disabled for this app`
  })
}

export async function setAppConfig(
  appId: string,
  key: string,
  value: unknown,
  payload: AuthPayload,
  options?: { category?: string; isSecret?: boolean; isPublic?: boolean; description?: string },
  event?: H3Event
): Promise<void> {
  const isInternalHub = payload.appId === (useRuntimeConfig().public.hubAppId as string)
  const ip = event ? getRequestIP(event) || undefined : undefined
  const userAgent = event ? getHeader(event, 'user-agent') || undefined : undefined

  await serviceSetConfig(appId, key, value, payload, {
    ...options,
    auditContext: {
      ip,
      userAgent,
      source: isInternalHub ? 'tm-hub_internal' : 'external_app',
    },
  })
  
  invalidateAppCache(appId)
}

export async function getPublicAppConfigs(appId: string): Promise<Record<string, string>> {
  const result = await serviceGetPublicConfigs(appId)
  return result.data
}

export async function getAllAppConfigsDecrypted(appId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('app_configs')
    .select('key, value, is_secret')
    .eq('app_id', appId)

  if (error) throwDbError(error, 'utils/config.ts')

  const result: Record<string, unknown> = {}
  for (const row of data || []) {
    if (row.is_secret) {
      result[row.key] = decryptConfigValue(row.value, true)
    } else {
      result[row.key] = row.value
    }
  }
  return result
}

export function invalidateConfigCache(appId: string): void {
  invalidateAppCache(appId)
}

export function clearConfigCache(): void {
  configCache.clear()
  singleConfigCache.clear()
  featureFlagsCache.clear()
}