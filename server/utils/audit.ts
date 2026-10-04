import { auditService } from '../modules/logger/audit.service'
import type { AuthPayload } from './request'

export interface LogAuditInput {
  appId: string
  action: string
  modelName: string
  docId: string
  before?: unknown
  after?: unknown
  /** Authenticated JWT payload when available */
  payload?: Pick<AuthPayload, 'sub' | 'appId' | 'email' | 'name'> | null
  /** Fallback actor (e.g. auth login before token issued) */
  actorId?: string
  actorEmail?: string
  actorName?: string
  /** Supabase audit_logs action code (uppercase convention); omit to skip dual-write */
  supabaseAction?: string
  supabaseDetails?: Record<string, unknown>
  supabaseUserId?: string | null
}

/**
 * Fire-and-forget audit log (Mongo histories via auditService + optional Supabase audit_logs).
 * Never throws — logging must not break the request.
 */
export async function logAudit(event: any, input: LogAuditInput): Promise<void> {
  try {
    const hubAppId = useRuntimeConfig().public.hubAppId as string
    const ip = getRequestIP(event, { xForwardedFor: true }) || undefined
    const userAgent = getHeader(event, 'user-agent') || undefined

    const actor = input.payload
      ? {
          id: input.payload.sub,
          email: input.payload.email,
          name: input.payload.name,
          username: input.payload.email?.split('@')[0]
        }
      : {
          id: input.actorId || 'system',
          email: input.actorEmail || '',
          name: input.actorName || 'System',
          username: 'system'
        }

    await auditService.logChange({
      appId: input.appId,
      modelName: input.modelName,
      docId: input.docId,
      action: input.action,
      source: input.appId === hubAppId ? 'tm-hub_internal' : 'external_app',
      actor,
      ip,
      userAgent,
      before: input.before,
      after: input.after
    })

    if (input.supabaseAction) {
      try {
        const { getSupabaseAdmin } = await import('../modules/database/supabase')
        const supabase = getSupabaseAdmin()
        await supabase.from('audit_logs').insert({
          app_id: input.appId,
          user_id: input.supabaseUserId ?? input.payload?.sub ?? null,
          action: input.supabaseAction,
          details: input.supabaseDetails || {},
          ip: ip || null
        })
      } catch {
        // Supabase audit is best-effort
      }
    }
  } catch (err: any) {
    console.warn(`[logAudit] Failed: ${err?.message}`)
  }
}
