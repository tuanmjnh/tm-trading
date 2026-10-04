import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  const config = useRuntimeConfig()
  const url = config.supabaseUrl || ''
  const key = config.supabaseKey || ''
  if (!url || !key) return false
  if (url.includes('your-project.supabase.co') || key.includes('your-supabase-')) {
    return false
  }
  return true
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client
  const config = useRuntimeConfig()
  const url = config.supabaseUrl || ''
  const key = config.supabaseKey || ''

  if (!url || !key || url.includes('your-project.supabase.co') || key.includes('your-supabase-')) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.dbNotConfigured',
      message: 'Supabase is not configured. Please update SUPABASE_URL and SUPABASE_KEY in the .env file of tm-hub.'
    })
  }

  client = createClient(url, key, {
    auth: { persistSession: false }
  })
  return client
}

