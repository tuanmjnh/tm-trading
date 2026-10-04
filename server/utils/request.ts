import type { H3Event } from 'h3'
import { verifyAccessToken } from '../modules/token/jwt'

export interface AuthPayload {
  sub: string
  appId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  allowedRoutes: string[]
}

export async function requireAuthPayload(event: H3Event): Promise<AuthPayload> {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const payload = await verifyAccessToken(authHeader.slice(7))
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'error.invalidToken', message: 'Invalid or expired token' })
  }
  return payload
}
