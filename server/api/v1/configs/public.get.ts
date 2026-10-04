import { getSupabaseAdmin } from '../../../modules/database/supabase'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = (getHeader(event, 'x-app-id') || query.appId) as string

  if (!appId) {
    throw createError({ statusCode: 400, statusMessage: 'error.missingAppId', message: 'App ID parameter or X-App-Id header is required' })
  }

  const supabase = getSupabaseAdmin()
  const { data: configs, error } = await supabase
    .from('app_configs')
    .select('key, value')
    .eq('app_id', appId)
    .eq('is_public', true)
    // Unauthenticated endpoint - never return secrets (even if row is marked is_public).
    .eq('is_secret', false)

  if (error) {
    throwDbError(error, 'api/v1/configs/public.get.ts')
  }

  const result: Record<string, string> = {}
  for (const c of configs || []) {
    result[c.key] = c.value
  }

  return { success: true, data: result }
})
