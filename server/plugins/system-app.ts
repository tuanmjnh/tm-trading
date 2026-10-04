/**
 * Phase 1 — Application Registry bootstrap check (ARCHITECTURE.md §35 / §2.2 v1.2).
 * Verifies HUB_APP_ID is set, well-formed, and matches the single is_system=true row.
 * Warn-only: never blocks boot (seed may not have run yet).
 */
export default defineNitroPlugin(() => {
  const hubAppId = process.env.HUB_APP_ID

  if (!hubAppId) {
    console.warn('[system-app] HUB_APP_ID is not set — run seed to bootstrap the system application (ARCHITECTURE §35).')
    return
  }

  if (!isValidAppId(hubAppId)) {
    console.error(`[system-app] HUB_APP_ID "${hubAppId}" does not match expected format tm-hub_xxxxxx (isValidAppId).`)
    return
  }

  void (async () => {
    try {
      const { getSupabaseAdmin, isSupabaseConfigured } = await import('../modules/database/supabase')
      if (!isSupabaseConfigured()) return

      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('apps')
        .select('id, is_system')
        .eq('id', hubAppId)
        .maybeSingle()

      if (error) {
        console.warn(`[system-app] Could not verify HUB_APP_ID against DB: ${error.message}`)
        return
      }
      if (!data) {
        console.warn(`[system-app] HUB_APP_ID "${hubAppId}" not found in apps table — run seed.`)
        return
      }
      if (data.is_system !== true) {
        console.error(`[system-app] HUB_APP_ID "${hubAppId}" exists but is_system=false — unsafe state, fix per ARCHITECTURE §35 policy.`)
      }
    } catch (err: any) {
      console.warn(`[system-app] Verification failed: ${err?.message}`)
    }
  })()
})
