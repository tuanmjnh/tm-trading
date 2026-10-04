import { SignJWT, jwtVerify } from 'jose'
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

export async function signAccessToken(payload: TokenPayload, expiry = '15m'): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecretKey())
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (payload.purpose === 'totp') return null
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
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
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (payload.purpose !== 'totp') return null
    return payload as unknown as TotpChallengePayload
  } catch {
    return null
  }
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
