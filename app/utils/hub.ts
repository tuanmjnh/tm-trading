import { DEFAULT_HUB_URL } from '~~/shared/utils/hubEnv'

// =============================================================================
//  One Hub endpoint for the whole app.
//
//  useAuth (login/refresh/me) and useHub (every tm-hub-client call) MUST resolve
//  the same base URL. They used to each carry their own
//  `|| 'http://localhost:4000'` fallback, so an override could make login talk
//  to one Hub and the menu to another — "logged in, but no permissions".
//
//  Resolution itself lives in `shared/utils/hubEnv.ts` (used by nuxt.config,
//  which prints the chosen source at startup), so this helper only reads what
//  the runtime config already resolved.
// =============================================================================

export function useHubEndpoint() {
  const config = useRuntimeConfig()
  const hubUrl = String((config.public.hubUrl as string) || '')
  const appId = String((config.public.hubAppId as string) || '')
  const source = String((config.public.hubUrlSource as string) || 'runtime')
  const problem = String((config.public.hubEnvProblem as string) || '')

  if (import.meta.dev && (!hubUrl || !appId)) {
    console.warn(
      `[hub-config] runtime config incomplete (hubUrl='${hubUrl}', hubAppId='${appId}') — ` +
      'check the [hub-config] lines at startup; login and menu calls will fail.'
    )
  }

  return {
    hubUrl: hubUrl || DEFAULT_HUB_URL,
    appId: appId || 'tm-trading',
    source,
    problem: problem || null,
  }
}

// =============================================================================
//  F2/U1 — Hub 429 budget.
//
//  A burst of full reloads used to issue one `POST /auth/refresh` each and hit
//  the Hub rate limit with no back-off. The window is stored in `sessionStorage`
//  so it survives a hard navigation (a module-scope value would be wiped by the
//  very reload that caused the burst). `Retry-After` is honored when present and
//  the honored window is capped so a hostile/bogus value cannot lock the app.
// =============================================================================

const HUB_RATE_LIMIT_KEY = 'hub:rate-limited-until'
const HUB_RATE_LIMIT_MAX_MS = 5 * 60_000
const HUB_RATE_LIMIT_FALLBACK_MS = 30_000

// The store is THE dependency (not the build target), so a browser, a server
// import, and a plain Node test all take a correct path.
function rateLimitStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Parse a `Retry-After` header (delay-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  // A numeric value is delay-seconds — negative is invalid (and must NOT fall
  // through to Date.parse, which reads "-5" as the year 5 BC).
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null
  const when = Date.parse(value)
  if (!Number.isNaN(when)) return Math.max(0, when - now)
  return null
}

/** Milliseconds left before the Hub rate-limit window closes (0 when clear). */
export function hubRateLimitRemainingMs(now: number = Date.now()): number {
  const store = rateLimitStore()
  if (!store) return 0
  const until = Number(store.getItem(HUB_RATE_LIMIT_KEY))
  return Number.isFinite(until) ? Math.max(0, until - now) : 0
}

/** Record a 429 and start the back-off window; returns its duration in ms. */
export function noteHubRateLimit(retryAfter: string | null, now: number = Date.now()): number {
  const ms = Math.min(parseRetryAfterMs(retryAfter, now) ?? HUB_RATE_LIMIT_FALLBACK_MS, HUB_RATE_LIMIT_MAX_MS)
  rateLimitStore()?.setItem(HUB_RATE_LIMIT_KEY, String(now + ms))
  return ms
}

/** Clear the back-off window (called after a successful Hub call). */
export function clearHubRateLimit(): void {
  rateLimitStore()?.removeItem(HUB_RATE_LIMIT_KEY)
}
