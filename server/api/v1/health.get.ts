import { getSupabaseAdmin } from '../../modules/database/supabase'
import { isSupabaseConfigured } from '../../modules/database/supabase'
import { loadServicesStatus } from '../../utils/intel'

export default defineEventHandler(async () => {
  const started = Date.now()
  let db = 'unconfigured' as 'ok' | 'unconfigured' | 'error'

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase.from('apps').select('id').limit(1)
      db = error ? 'error' : 'ok'
    } catch {
      db = 'error'
    }
  }

  // D9: trang thai services (lastRunAt/lastErrorAt/overdue) — doc file
  // logs/services.json, fail-soft rong neu services chua chay.
  const services = await loadServicesStatus()

  return {
    success: true,
    data: {
      status: db === 'ok' && !services.some((s) => s.overdue) ? 'healthy' : 'degraded',
      db,
      services,
      version: useAppConfig().system?.app_version || '1.0.0',
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      time: new Date().toISOString()
    }
  }
})
