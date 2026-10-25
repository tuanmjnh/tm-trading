import { getSupabaseAdmin } from '../database/supabase'

/**
 * Mongo audit TTL days for this app, resolved along the chain:
 *   app_configs 'audit.retention' (mongoTtlDays) -> env MONGODB_LOG_TTL_DAYS -> 90.
 * Cached for 5 minutes; DB errors fail-soft to the env/default tier.
 * 0 = keep forever.
 */
interface TtlCacheEntry {
  days: number
  expiresAt: number
}

const ttlCache = new Map<string, TtlCacheEntry>()
const TTL_CACHE_MS = 5 * 60 * 1000
const DEFAULT_TTL_DAYS = 90

function parseRetentionDays(raw: string | null | undefined): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { mongoTtlDays?: unknown }
    const days = Number(parsed?.mongoTtlDays)
    return Number.isFinite(days) && days >= 0 ? Math.floor(days) : null
  } catch {
    // Legacy flat value (plain number string).
    const flat = Number(String(raw).trim())
    return Number.isFinite(flat) && flat >= 0 ? Math.floor(flat) : null
  }
}

export async function getAuditTtlDays(appId?: string): Promise<number> {
  const cached = appId ? ttlCache.get(appId) : undefined
  if (cached && cached.expiresAt > Date.now()) return cached.days

  let days: number | null = null

  if (appId) {
    try {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('app_configs')
        .select('value')
        .eq('app_id', appId)
        .eq('key', 'audit.retention')
        .maybeSingle()
      if (!error && data?.value) {
        days = parseRetentionDays(String(data.value))
      }
    } catch {
      // Fail-soft to the next tier.
    }
  }

  if (days === null) {
    days = parseRetentionDays(process.env.MONGODB_LOG_TTL_DAYS) ?? DEFAULT_TTL_DAYS
  }

  if (appId) ttlCache.set(appId, { days, expiresAt: Date.now() + TTL_CACHE_MS })
  return days
}
