import { verifyAccessToken } from '../modules/token/jwt'

// =============================================================================
//  GUARD cho toan bo /api/** cua tm-trading (D10).
//  tm-trading la SATELLITE: token do tm-hub cap (HS256, secret chia se qua
//  AUTH_JWT_SECRET = AUTH_JWT_SECRET cua tm-hub). Verify OFFLINE bang jose,
//  khong goi lai tm-hub. Mau: tm-tools/server/middleware/auth.ts.
//  Thu tu middleware Nitro: api-guards.ts truoc (CORS/OPTIONS/rate-limit),
//  auth.ts sau -> OPTIONS da tra 204 o buoc truoc.
// =============================================================================

// Endpoint khong yeu cau token (health check, tai nguyen public).
const PUBLIC_PATHS = [
  '/api/v1/health',
  '/api/icons',
  '/api/v1/configs/public'
]

// Tuy chon: tat ca route con lai (gom ca provider /api/v1/auth/* da ke thua tu
// tm-hub nhung CHUA cat) deu can token -> khong con endpoint nao phat token
// ma khong kiem soat tren cong tm-trading.
export default defineEventHandler(async (event) => {
  const path = event.path || ''

  if (!path.startsWith('/api/')) return
  if (event.method === 'OPTIONS') return
  if (PUBLIC_PATHS.includes(path)) return

  let token: string | null = null
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }
  if (!token) {
    token = getCookie(event, 'accessToken') || null
  }

  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'error.tokenMissing',
      message: 'Missing authorization token'
    })
  }

  const payload = await verifyAccessToken(token)
  if (!payload) {
    throw createError({
      statusCode: 401,
      statusMessage: 'error.invalidToken',
      message: 'Invalid or expired token'
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
