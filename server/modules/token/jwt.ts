import { SignJWT, decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import type { JWK, KeyLike } from 'jose'
import crypto from 'node:crypto'

export interface TokenPayload {
  sub: string
  appId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  allowedRoutes: string[]
  [key: string]: unknown
}

function getSecretKey(): Uint8Array {
  const config = useRuntimeConfig()
  return new TextEncoder().encode(config.jwtSecret)
}

/** Hub public verification key: RSA `n`/`e` only, never `d`. */
interface HubPublicJwk {
  kty: 'RSA'
  kid: string
  n: string
  e: string
}

function parsePublicKeys(raw: string): HubPublicJwk[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is HubPublicJwk => {
      if (!value || typeof value !== 'object') return false
      const jwk = value as Record<string, unknown>
      return !('d' in jwk)
        && jwk.kty === 'RSA'
        && typeof jwk.n === 'string' && jwk.n.length > 0
        && typeof jwk.e === 'string' && jwk.e.length > 0
        && typeof jwk.kid === 'string' && jwk.kid.length > 0
    })
  } catch {
    return []
  }
}

export async function signAccessToken(payload: TokenPayload, expiry = '15m'): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecretKey())
}

/**
 * Hub tokens are RS256 since P3 (`AUTH_JWT_PUBLIC_KEYS` holds the public JWKs).
 * HS256 keeps verifying with the legacy shared secret until the Hub stops
 * issuing it; `none` and every other algorithm are refused.
 */
async function verifyRaw(token: string): Promise<Record<string, unknown> | null> {
  let header: { alg?: string, kid?: string }
  try {
    header = decodeProtectedHeader(token) as { alg?: string, kid?: string }
  } catch {
    return null
  }

  if (header.alg === 'RS256') {
    const config = useRuntimeConfig()
    const keys = parsePublicKeys(String(config.jwtPublicKeys || ''))
      .filter(key => !header.kid || key.kid === header.kid)
    for (const jwk of keys) {
      try {
        const key = await importJWK(jwk as unknown as JWK, 'RS256') as KeyLike
        const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] })
        return payload as Record<string, unknown>
      } catch {
        // Wrong key for this `kid`: try the next published key.
      }
    }
    return null
  }

  if (header.alg === 'HS256') {
    try {
      const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] })
      return payload as Record<string, unknown>
    } catch {
      return null
    }
  }

  return null
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  const payload = await verifyRaw(token)
  if (!payload || payload.purpose === 'totp') return null
  return payload as unknown as TokenPayload
}

/** Temporary 5-minute token containing partial login state - exchangeable only at POST /auth/totp/login. */
export interface TotpChallengePayload {
  purpose: 'totp'
  sub: string
  appId: string
  deviceId?: string
  platform?: string
  userAgent?: string
  ip?: string
  exp?: number
}

export async function signTotpChallenge(
  payload: Omit<TotpChallengePayload, 'purpose'>,
  expiry = '5m'
): Promise<string> {
  return await new SignJWT({ ...payload, purpose: 'totp' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecretKey())
}

export async function verifyTotpChallenge(token: string): Promise<TotpChallengePayload | null> {
  const payload = await verifyRaw(token)
  if (!payload || payload.purpose !== 'totp') return null
  return payload as unknown as TotpChallengePayload
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
