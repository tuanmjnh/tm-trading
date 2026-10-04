import { getSupabaseAdmin } from '#server/modules/database/supabase'
import { auditService } from '#server/modules/logger/audit.service'
import { encryptSecret, decryptSecret, maskSecret, decryptConfigValue } from '#server/modules/config/encryption'
import { validateConfigValue } from '#server/modules/config/validation'
import { getRegistryEntry } from '#server/modules/config/registry'
import { canAccessAllApps, hasCapability } from '#server/utils/authz'

interface AppConfigItem {
  appId: string
  category?: string
  key: string
  value: string
  isSecret?: boolean
  isPublic?: boolean
  description?: string
  updatedAt?: string
}

interface ConfigRow {
  id: string
  app_id: string
  category: string
  key: string
  value: string
  is_secret: boolean
  is_public: boolean
  description: string | null
  updated_at: string
}

interface GetConfigsOptions {
  appId: string
  payload: AuthPayload
  includeSecrets?: boolean
  limit?: number
  cursor?: string
}

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

export async function getAllConfigs({ appId, payload, includeSecrets = false, limit = 50, cursor }: GetConfigsOptions) {
  const crossApp = canAccessAllApps(payload) || hasCapability(payload, 'platform.crossapp.read')
  if (!crossApp && payload.appId !== appId) {
    throw createError({ statusCode: 403, statusMessage: 'error.cannotAccessApp', message: 'Access denied to application' })
  }

  const canSeeSecrets = includeSecrets || (payload.permissions || []).includes('*')
  
  const supabase = getSupabaseAdmin()
  let dbQuery = supabase
    .from('app_configs')
    .select('*')
    .eq('app_id', appId)
    .order('key', { ascending: true })
    .limit(limit + 1)

  if (cursor) {
    dbQuery = dbQuery.gt('key', cursor)
  }

  const { data, error } = await dbQuery
  if (error) throwDbError(error, 'modules/config/service.ts')

  const items: ConfigRow[] = data || []
  const page = cursorPage(items, limit, c => c.key)

  const dataMap: Record<string, unknown> = {}
  const meta = page.data.map((item: ConfigRow) => {
    let value: unknown = item.value
    
    if (item.is_secret && !canSeeSecrets) {
      value = '••••••••'
      dataMap[item.key] = value
    } else if (item.is_secret && canSeeSecrets) {
      value = decryptConfigValue(item.value, true)
      dataMap[item.key] = value
    } else {
      dataMap[item.key] = item.value
    }

    return {
      key: item.key,
      category: item.category,
      isSecret: item.is_secret,
      isPublic: item.is_public,
      description: item.description,
      updatedAt: item.updated_at,
    }
  })

  return {
    success: true,
    data: dataMap,
    meta,
    nextCursor: page.nextCursor,
  }
}

export async function getPublicConfigs(appId: string) {
  const supabase = getSupabaseAdmin()
  const { data: configs, error } = await supabase
    .from('app_configs')
    .select('key, value')
    .eq('app_id', appId)
    .eq('is_public', true)
    // Unauthenticated endpoint - never return secrets, even if row is set
    // to is_public=true (defense-in-depth).
    .eq('is_secret', false)

  if (error) throwDbError(error, 'modules/config/service.ts')

  const result: Record<string, string> = {}
  for (const c of configs || []) {
    result[c.key] = c.value
  }

  return { success: true, data: result }
}

export async function getSingleConfig(appId: string, key: string, payload: AuthPayload, includeSecret = false) {
  const crossApp = canAccessAllApps(payload) || hasCapability(payload, 'platform.crossapp.read')
  if (!crossApp && payload.appId !== appId) {
    throw createError({ statusCode: 403, statusMessage: 'error.cannotAccessApp', message: 'Access denied to application' })
  }

  const canSeeSecrets = includeSecret || (payload.permissions || []).includes('*')
  
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('app_configs')
    .select('*')
    .eq('app_id', appId)
    .eq('key', key)
    .maybeSingle()

  if (error) throwDbError(error, 'modules/config/service.ts')
  if (!data) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Configuration not found' })

  let value: unknown = data.value
  if (data.is_secret && !canSeeSecrets) {
    value = '••••••••'
  } else if (data.is_secret && canSeeSecrets) {
    value = decryptConfigValue(data.value, true)
  }

  return {
    success: true,
    data: {
      key: data.key,
      category: data.category,
      value,
      isSecret: data.is_secret,
      isPublic: data.is_public,
      description: data.description,
      updatedAt: data.updated_at,
    },
  }
}

// Category schema applies only to blob keys (key === category, e.g. 'mail', 'auth.passkey').
// Leaf keys (e.g. 'mail.enabled') are scalar values - skip object schema validation.
function validateForWrite(key: string, category: string, value: unknown) {
  if (key !== category) return { success: true as const, data: value }
  return validateConfigValue(category, value)
}

export async function setConfig(
  appId: string,
  key: string,
  value: unknown,
  payload: AuthPayload,
  options?: { category?: string; isSecret?: boolean; isPublic?: boolean; description?: string; auditContext?: AuditContext }
) {
  const crossApp = canAccessAllApps(payload) || hasCapability(payload, 'platform.crossapp.write')
  if (!crossApp && payload.appId !== appId) {
    throw createError({ statusCode: 403, statusMessage: 'error.cannotAccessApp', message: 'Access denied to application' })
  }

  const category = options?.category || getCategoryFromKey(key)
  const isSecret = options?.isSecret ?? isSecretKey(key)
  // Secret keys must never be flagged public (even if client passes isPublic=true).
  const isPublic = isSecret ? false : (options?.isPublic ?? true)

  const validation = validateForWrite(key, category, normalizeIncomingValue(value))
  if (!validation.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'error.validationFailed',
      message: validation.error?.message || 'Invalid configuration value',
    })
  }

  const stringValue = JSON.stringify(validation.data)
  const encryptedValue = isSecret ? encryptSecret(stringValue) : stringValue

  const supabase = getSupabaseAdmin()
  const { data: existing } = await supabase
    .from('app_configs')
    .select('value')
    .eq('app_id', appId)
    .eq('key', key)
    .maybeSingle()

  const beforeValue = existing?.value || null
  // Mask secret values in audit logs to record changes without storing secrets.
  const beforeConfig = beforeValue ? { [key]: isSecret ? '••••••••' : beforeValue } : {}

  const { error } = await supabase.from('app_configs').upsert({
    app_id: appId,
    category,
    key,
    value: encryptedValue,
    is_secret: isSecret,
    is_public: isPublic,
    description: options?.description,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'app_id,key' })

  if (error) throwDbError(error, 'modules/config/service.ts')

  const afterConfig = { [key]: isSecret ? '••••••••' : stringValue }
  
  if (options?.auditContext) {
    await auditService.logChange({
      appId,
      modelName: 'AppConfig',
      docId: key,
      action: 'config.upsert',
      source: options.auditContext.source,
      actor: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        username: payload.email?.split('@')[0],
      },
      ip: options.auditContext.ip,
      userAgent: options.auditContext.userAgent,
      before: beforeConfig,
      after: afterConfig,
    })

    await supabase.from('audit_logs').insert({
      app_id: appId,
      user_id: payload.sub,
      action: 'UPSERT_CONFIG',
      details: { key, category },
      ip: options.auditContext.ip || null,
    })
  }

  return { success: true, message: 'Configuration updated successfully' }
}

export async function deleteConfig(appId: string, key: string, payload: AuthPayload, auditContext?: AuditContext) {
  const crossApp = canAccessAllApps(payload) || hasCapability(payload, 'platform.crossapp.write')
  if (!crossApp && payload.appId !== appId) {
    throw createError({ statusCode: 403, statusMessage: 'error.cannotAccessApp', message: 'Access denied to application' })
  }

  const supabase = getSupabaseAdmin()
  const { data: existing } = await supabase
    .from('app_configs')
    .select('value, is_secret')
    .eq('app_id', appId)
    .eq('key', key)
    .maybeSingle()

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Configuration not found' })
  }

  const beforeConfig = { [key]: existing.is_secret ? '••••••••' : existing.value }

  const { error } = await supabase
    .from('app_configs')
    .delete()
    .eq('app_id', appId)
    .eq('key', key)

  if (error) throwDbError(error, 'modules/config/service.ts')

  if (auditContext) {
    await auditService.logChange({
      appId,
      modelName: 'AppConfig',
      docId: key,
      action: 'config.delete',
      source: auditContext.source,
      actor: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        username: payload.email?.split('@')[0],
      },
      ip: auditContext.ip,
      userAgent: auditContext.userAgent,
      before: beforeConfig,
      after: {},
    })

    await supabase.from('audit_logs').insert({
      app_id: appId,
      user_id: payload.sub,
      action: 'DELETE_CONFIG',
      details: { key },
      ip: auditContext.ip || null,
    })
  }

  return { success: true, message: 'Configuration deleted successfully' }
}

export async function bulkUpsertConfigs(
  appId: string,
  configs: Record<string, unknown>,
  payload: AuthPayload,
  auditContext?: AuditContext
) {
  const crossApp = canAccessAllApps(payload) || hasCapability(payload, 'platform.crossapp.write')
  if (!crossApp && payload.appId !== appId) {
    throw createError({ statusCode: 403, statusMessage: 'error.cannotAccessApp', message: 'Access denied to application' })
  }

  const supabase = getSupabaseAdmin()
  const { data: existingRows } = await supabase
    .from('app_configs')
    .select('key, value')
    .eq('app_id', appId)

  const beforeConfig: Record<string, string> = {}
  for (const row of existingRows || []) {
    // Mask secret value in audit logs.
    beforeConfig[row.key] = isSecretKey(row.key) ? '••••••••' : row.value
  }

  const rows = Object.entries(configs).map(([key, value]) => {
    const category = getCategoryFromKey(key)
    const isSecret = isSecretKey(key)
    const isPublic = !isSecret

    const validation = validateForWrite(key, category, normalizeIncomingValue(value))
    if (!validation.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'error.validationFailed',
        message: `Invalid value for ${key}: ${validation.error?.message}`,
      })
    }

    const stringValue = JSON.stringify(validation.data)
    return {
      app_id: appId,
      category,
      key,
      value: isSecret ? encryptSecret(stringValue) : stringValue,
      is_secret: isSecret,
      is_public: isPublic,
      updated_at: new Date().toISOString(),
    }
  })

  const { error } = await supabase.from('app_configs').upsert(rows, { onConflict: 'app_id,key' })
  if (error) throwDbError(error, 'modules/config/service.ts')

  const afterConfig = Object.fromEntries(
    Object.entries(configs).map(([k, v]) => [k, isSecretKey(k) ? '••••••••' : JSON.stringify(v)])
  )

  if (auditContext) {
    await auditService.logChange({
      appId,
      modelName: 'AppConfig',
      docId: appId,
      action: 'config.bulk_upsert',
      source: auditContext.source,
      actor: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        username: payload.email?.split('@')[0],
      },
      ip: auditContext.ip,
      userAgent: auditContext.userAgent,
      before: beforeConfig,
      after: afterConfig,
    })

    await supabase.from('audit_logs').insert({
      app_id: appId,
      user_id: payload.sub,
      action: 'BULK_UPSERT_CONFIGS',
      details: { keys: Object.keys(configs) },
      ip: auditContext.ip || null,
    })
  }

  return { success: true, message: 'Configurations updated successfully' }
}

export async function seedDefaultConfigs(appId: string, isSystemApp = false) {
  const { configRegistry } = await import('#server/modules/config/registry')
  
  const supabase = getSupabaseAdmin()
  const { data: existingRows } = await supabase
    .from('app_configs')
    .select('key')
    .eq('app_id', appId)

  const existingKeys = new Set((existingRows || []).map(r => r.key))

  for (const entry of configRegistry) {
    if (existingKeys.has(entry.key)) continue

    const stringValue = JSON.stringify(entry.defaultValue)
    const encryptedValue = entry.isSecret ? encryptSecret(stringValue) : stringValue

    await supabase.from('app_configs').insert({
      app_id: appId,
      category: entry.category,
      key: entry.key,
      value: encryptedValue,
      is_secret: entry.isSecret,
      is_public: entry.isPublic,
      description: entry.description,
      updated_at: new Date().toISOString(),
    })
  }
}

export function getCategoryFromKey(key: string): string {
  if (key.startsWith('auth.')) {
    return `auth.${key.split('.')[1]}`
  }
  if (key === 'mail' || key.startsWith('mail.') || key.startsWith('MAIL_')) return 'mail'
  if (key === 'features') return 'features'
  return 'general'
}

export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase()
  // Auth feature flags (auth.password.*, auth.passwordReset.*) are booleans/numbers - not secrets.
  if (k === 'auth.password' || k.startsWith('auth.password.') || k.startsWith('auth.passwordreset.')) return false
  return k.includes('secret') || k.includes('private') || k.includes('api_key') || k.includes('apikey') || k.includes('password') || k.includes('token') || k.endsWith('.pass')
}

// Client sends JSON.stringified value - parse before stringifying
// to prevent double-encoding ('true' -> '"true"' -> '"\"true\""').
// Parse only structured JSON strings; numbers/strings are preserved as-is.
export function normalizeIncomingValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  const structured = t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || t === 'true' || t === 'false' || t === 'null'
  if (!structured) return value
  try { return JSON.parse(value) } catch { return value }
}

function cursorPage<T>(items: T[], limit: number, getCursor: (item: T) => string) {
  const hasMore = items.length > limit
  const pageItems = hasMore ? items.slice(0, limit) : items
  const lastItem = pageItems[pageItems.length - 1]
  const nextCursor = hasMore && lastItem ? getCursor(lastItem) : null
  return { data: pageItems, nextCursor }
}