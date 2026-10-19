import type { H3Event } from 'h3'
import type { AuthPayload } from './request'

/**
 * Owner (tenant) resolution for per-user trading data.
 *
 * Identity comes from tm-hub and is verified offline by `server/middleware/auth.ts`,
 * which stores the decoded payload on `event.context.auth`. Every per-user
 * collection is keyed by `ownerId = payload.sub`, so two hub accounts never read
 * or write each other's rows (docs/web-app/user-tenancy-plan.md).
 *
 * `ownerId` is a DIFFERENT axis from `account`: `account` is a paper/broker
 * sub-account that belongs to one owner, never the owner itself.
 */

interface AuthContext {
  auth?: AuthPayload
}

/** Authenticated hub user id, or null when the request carries no identity. */
export function ownerIdOrNull(event: H3Event): string | null {
  const sub = (event.context as AuthContext).auth?.sub
  return typeof sub === 'string' && sub.length > 0 ? sub : null
}

/** Authenticated hub user id; 401 when missing (routes are auth-guarded upstream). */
export function requireOwnerId(event: H3Event): string {
  const sub = ownerIdOrNull(event)
  if (!sub) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Authenticated owner required' })
  }
  return sub
}

/** Mongo filter fragment that restricts a per-user query to the caller. */
export function ownerFilter(event: H3Event): { ownerId: string } {
  return { ownerId: requireOwnerId(event) }
}
