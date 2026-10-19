// =============================================================================
//  Hub endpoint resolution (satellite: tm-trading -> tm-hub).
//
//  WHY THIS EXISTS: `NUXT_PUBLIC_HUB_URL` is a *runtime* config value, so a
//  process env var silently overrides `.env`, and `A || B || 'http://localhost:4000'`
//  turns any of these into the same symptom — login and every Hub call hitting
//  localhost with no explanation:
//    * the variable is set but EMPTY (falls through to the next name)
//    * only the legacy name is used
//    * nothing is set at all
//
//  So resolution is explicit here: one order, a named source, and a warning for
//  every case that used to be silent. Pure — the caller supplies env + mode, so
//  the rules are testable without Nuxt.
// =============================================================================

/** Preferred name first; the others are accepted but reported. */
export const HUB_URL_KEYS = Object.freeze(['NUXT_PUBLIC_HUB_URL', 'HUB_URL', 'NUXT_PUBLIC_HUB_API_URL'])
export const HUB_APP_ID_KEYS = Object.freeze(['NUXT_PUBLIC_HUB_APP_ID', 'HUB_APP_ID'])
export const HUB_URL_LEGACY_KEYS = Object.freeze(['HUB_URL', 'NUXT_PUBLIC_HUB_API_URL'])
export const DEFAULT_HUB_URL = 'http://localhost:4000'

export interface HubEnvResult {
  /** Resolved Hub base URL (never empty). */
  url: string
  /** Which env var supplied it, or 'default'. */
  source: string
  /** Resolved app id (`X-App-Id`), '' when unset. */
  appId: string
  appIdSource: string
  /** True when the URL came from the built-in fallback. */
  defaulted: boolean
  /** Non-fatal notices: empty-but-defined vars, legacy names. */
  warnings: string[]
  /** Set when the configuration is unusable outside a local tm-hub. */
  problem: string | null
}

type EnvLike = Record<string, string | undefined>

function pick(env: EnvLike, keys: readonly string[], warnings: string[], label: string): { value: string, source: string } {
  for (const key of keys) {
    if (!(key in env)) continue
    const value = String(env[key] ?? '').trim()
    if (!value) {
      warnings.push(`${key} is defined but EMPTY — ignoring it (this is how a ${label} silently falls back to the next name or to localhost)`)
      continue
    }
    if (HUB_URL_LEGACY_KEYS.includes(key)) {
      warnings.push(`${key} is a legacy name — rename it to NUXT_PUBLIC_HUB_URL`)
    }
    return { value, source: key }
  }
  return { value: '', source: '' }
}

/**
 * Resolve the Hub URL + app id from an env object.
 *
 * @param env          e.g. `process.env`
 * @param opts.isProduction  changes only the SEVERITY of `problem`, not the resolution
 */
export function resolveHubEnv(env: EnvLike = {}, { isProduction = false }: { isProduction?: boolean } = {}): HubEnvResult {
  const warnings: string[] = []
  const url = pick(env, HUB_URL_KEYS, warnings, 'Hub URL')
  const appId = pick(env, HUB_APP_ID_KEYS, warnings, 'Hub app id')

  const defaulted = !url.value
  let problem: string | null = null
  if (defaulted) {
    problem = `NUXT_PUBLIC_HUB_URL is not set — falling back to ${DEFAULT_HUB_URL}. Login and every Hub call fail unless tm-hub runs on this machine.`
  } else if (!appId.value) {
    problem = 'NUXT_PUBLIC_HUB_APP_ID is not set — Hub requests carry no X-App-Id and will be rejected.'
  }
  if (problem && !isProduction) problem = `${problem} (development)`

  return {
    url: url.value || DEFAULT_HUB_URL,
    source: url.source || 'default',
    appId: appId.value,
    appIdSource: appId.source || 'default',
    defaulted,
    warnings,
    problem,
  }
}

/**
 * Startup report. Warnings are informational; a `problem` is printed as an
 * error in production so a misconfigured deploy is visible in the first lines
 * of the log instead of as "login does not work".
 */
export function hubEnvReport(result: HubEnvResult, { isProduction = false, log = console }: { isProduction?: boolean, log?: Pick<Console, 'warn' | 'error' | 'info'> } = {}): void {
  for (const w of result.warnings) log.warn(`[hub-config] ${w}`)
  if (result.problem) {
    if (isProduction) log.error(`[hub-config] ${result.problem}`)
    else log.warn(`[hub-config] ${result.problem}`)
  }
  log.info(`[hub-config] hubUrl=${result.url} (from ${result.source}), appId=${result.appId || '(unset)'} (from ${result.appIdSource})`)
}
