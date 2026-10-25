import type { H3Event } from 'h3'
import { verifyAccessToken } from '../modules/token/jwt'
import { refreshAccessTokenSingleFlight } from '../utils/tokenRefresh'

// =============================================================================
//  GUARD cho toan bo /api/** cua tm-trading (D10).
//  tm-trading la SATELLITE: token do tm-hub cap (HS256, secret chia se qua
//  AUTH_JWT_SECRET = AUTH_JWT_SECRET cua tm-hub). Verify OFFLINE bang jose,
//  khong goi lai tm-hub. Mau: tm-tools/server/middleware/auth.ts.
//  Thu tu middleware Nitro: api-guards.ts truoc (CORS/OPTIONS/rate-limit),
//  auth.ts sau -> OPTIONS da tra 204 o buoc truoc.
//
//  F9/U5 — self-heal: when the access token is missing/expired but a refresh
//  cookie is present, one (single-flight) hub refresh is attempted and the fresh
//  cookies are written back, so every local `$fetch('/api/v1/...')` call site
//  recovers without a client interceptor. See server/utils/tokenRefresh.ts.
// =============================================================================

// Endpoint khong yeu cau token (health check, tai nguyen public).
const PUBLIC_PATHS = [
  '/api/v1/health',
  '/api/icons',
  '/api/v1/configs/public'
]

// The satellite has no local auth endpoints to heal; never refresh against them.
const AUTH_PATH_PREFIX = '/api/v1/auth'

const COOKIE_BASE = { path: '/', sameSite: 'lax' as const }

function readAccessToken(event: H3Event): string | null {
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return getCookie(event, 'accessToken') || null
}

/**
 * Exchange the refresh cookie for fresh tokens and write them back. Returns the
 * new access token, or null when there is nothing to refresh with / the hub
 * refused. Never throws.
 */
async function selfHealAccessToken(event: H3Event): Promise<string | null> {
  const refreshToken = getCookie(event, 'refreshToken')
  if (!refreshToken) return null

  const config = useRuntimeConfig()
  const hubUrl = String(config.public.hubUrl || '')
  const appId = String(config.public.hubAppId || '')
  if (!hubUrl || !appId) return null

  const tokens = await refreshAccessTokenSingleFlight({ hubUrl, appId, refreshToken })
  if (!tokens) return null

  // Mirror the client cookie attributes (httpOnly:false — useCookie reads them).
  setCookie(event, 'accessToken', tokens.accessToken, { ...COOKIE_BASE, maxAge: tokens.expiresIn || 900 })
  setCookie(event, 'refreshToken', tokens.refreshToken, { ...COOKIE_BASE, maxAge: 604800 })
  return tokens.accessToken
}

export default defineEventHandler(async (event) => {
  const path = event.path || ''

  if (!path.startsWith('/api/')) return
  if (event.method === 'OPTIONS') return
  if (PUBLIC_PATHS.includes(path)) return

  const token = readAccessToken(event)
  let payload = token ? await verifyAccessToken(token) : null

  if (!payload && !path.startsWith(AUTH_PATH_PREFIX)) {
    const healed = await selfHealAccessToken(event)
    if (healed) payload = await verifyAccessToken(healed)
  }

  if (!payload) {
    throw createError({
      statusCode: 401,
      statusMessage: token ? 'error.invalidToken' : 'error.tokenMissing',
      message: token ? 'Invalid or expired token' : 'Missing authorization token'
    })
  }

  // Rang buoc: token phai duoc tm-hub cap cho DUNG app nay.
  const config = useRuntimeConfig()
  const currentAppId = (config.public.hubAppId as string) || 'tm-trading'
  if (payload.appId && payload.appId !== currentAppId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.forbidden',
      message: 'Token not issued for this application'
    })
  }

  event.context.auth = payload
})
