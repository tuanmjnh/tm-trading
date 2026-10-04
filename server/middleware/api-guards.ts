import type { H3Event } from 'h3'

/**
 * API guards theo feature flag (Features tab → section `api`):
 * - `api.cors.enabled` / `api.cors.origins` → CORS headers + preflight OPTIONS
 * - `api.rateLimit.enabled` / `api.rateLimit.maxPerMinute` → rate limit theo app + IP
 *
 * Rules:
 * - Only intercepts `/api/*` requests.
 * - Fail-open: feature flag read errors bypass guard rather than blocking API.
 * - Preflight OPTIONS returns 204 directly from middleware.
 */

interface ApiFeatureSection {
  rateLimit?: boolean | { enabled?: boolean; maxPerMinute?: number }
  cors?: boolean | { enabled?: boolean; origins?: unknown }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function extractAppId(path: string): string {
  const m = path.match(/^\/api\/v1\/apps\/([^/?#]+)/)
  if (m?.[1]) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return useRuntimeConfig().public.hubAppId as string
}

function applyCors(event: H3Event, flags: Record<string, unknown>): void {
  const api = flags.api as ApiFeatureSection | undefined
  const corsCfg = api?.cors
  const enabled = typeof corsCfg === 'boolean'
    ? corsCfg
    : isObj(corsCfg)
      ? corsCfg.enabled !== false
      : true
  if (!enabled) return

  const origins = isObj(corsCfg) && Array.isArray(corsCfg.origins)
    ? corsCfg.origins.filter((o): o is string => typeof o === 'string')
    : []

  const origin = getHeader(event, 'origin')

  setHeader(event, 'Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-Api-Key, X-App-Id, X-Request-Id')
  setHeader(event, 'Access-Control-Expose-Headers', 'Retry-After, X-RateLimit-Remaining')
  setHeader(event, 'Access-Control-Max-Age', 86400)
  setHeader(event, 'Vary', 'Origin')

  if (!origin || origins.length === 0 || origins.includes('*')) {
    // No origin (server-to-server) or empty whitelist -> allow any.
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    return
  }
  if (origins.includes(origin)) {
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    return
  }
  // Origin outside whitelist -> do not send Allow-Origin (blocked by browser on client).
}

function enforceRateLimit(event: H3Event, appId: string, flags: Record<string, unknown>): void {
  const api = flags.api as ApiFeatureSection | undefined
  const rlCfg = api?.rateLimit
  const enabled = typeof rlCfg === 'boolean'
    ? rlCfg
    : isObj(rlCfg)
      ? rlCfg.enabled !== false
      : true
  if (!enabled) return

  const limit = isObj(rlCfg) && typeof rlCfg.maxPerMinute === 'number' && rlCfg.maxPerMinute > 0
    ? rlCfg.maxPerMinute
    : 60

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const key = `api:${appId}:${ip}`
  const WINDOW_MS = 60_000

  const gate = checkRateLimit(key, limit, WINDOW_MS)
  if (!gate.allowed) {
    setHeader(event, 'Retry-After', gate.retryAfterSec)
    throw createError({
      statusCode: 429,
      statusMessage: 'error.tooManyRequests',
      message: `Rate limit exceeded: ${limit} requests per minute`,
    })
  }
  hitRateLimit(key, limit, WINDOW_MS)
}

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] || ''
  if (!path.startsWith('/api/')) return

  const method = getMethod(event)
  const appId = extractAppId(path)

  let flags: Record<string, unknown> | null = null
  try {
    flags = await getAppFeatureFlags(appId) as unknown as Record<string, unknown>
  } catch (err) {
    console.error('[api-guards] feature flags unavailable, guards disabled:', err)
  }

  if (flags) {
    try { applyCors(event, flags) } catch { /* CORS best-effort */ }
  }

  if (method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return '' // Return value terminates middleware request (preflight)
  }

  if (!flags) return

  // Deliberate 429 rate limit - intentionally outside fail-open try/catch.
  enforceRateLimit(event, appId, flags)
})
