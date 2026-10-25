// server/utils/tokenRefresh.ts
// F9/U5 — server-side access-token self-heal.
//
// The local /api/** guard (server/middleware/auth.ts) verifies the tm-hub access
// token OFFLINE. When it is missing/expired but a refresh-token cookie is present,
// the guard calls the hub once here and writes the fresh cookies back, so every
// existing `$fetch('/api/v1/...')` call site recovers.
//
// Why server-side rather than a client fetch interceptor: Nuxt binds the
// auto-imported `$fetch` to `globalThis.$fetch` before plugins run, so a plugin
// cannot intercept the ~86 local call sites (see docs/web-app/ui-test-findings.md
// F9/U5). The guard sees every request, so it heals them all in one place.

export interface RefreshedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface RefreshInput {
  hubUrl: string
  appId: string
  refreshToken: string
}

type FetchLike = typeof fetch

/**
 * One hub refresh. Returns null on any failure (network, non-2xx, malformed
 * body) — callers treat null as "still unauthenticated".
 */
export async function refreshAccessToken(
  { hubUrl, appId, refreshToken }: RefreshInput,
  fetchImpl: FetchLike = fetch,
): Promise<RefreshedTokens | null> {
  if (!hubUrl || !appId || !refreshToken) return null
  try {
    const res = await fetchImpl(`${hubUrl.replace(/\/+$/, '')}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': appId },
      body: JSON.stringify({ refreshToken, appId }),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as { success?: boolean, data?: Record<string, unknown> } | null
    const data = json?.data
    if (!json?.success || !data?.accessToken || !data?.refreshToken) return null
    return {
      accessToken: String(data.accessToken),
      refreshToken: String(data.refreshToken),
      expiresIn: Number(data.expiresIn) || 0,
    }
  } catch {
    return null
  }
}

// One in-flight refresh per refresh token: parallel requests that all 401 at the
// same instant share a single hub call instead of stampeding it (and tripping the
// hub rate limiter).
const inFlight = new Map<string, Promise<RefreshedTokens | null>>()

/** Single-flight wrapper around {@link refreshAccessToken}, keyed by refresh token. */
export function refreshAccessTokenSingleFlight(
  input: RefreshInput,
  fetchImpl: FetchLike = fetch,
): Promise<RefreshedTokens | null> {
  const key = input.refreshToken
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = refreshAccessToken(input, fetchImpl).finally(() => {
    // Only clear if we are still the registered attempt.
    if (inFlight.get(key) === promise) inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
