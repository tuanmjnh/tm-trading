import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'
import { HubClient } from 'tm-hub-client'

// =============================================================================
//  SATELLITE HUB CLIENT — Wrap each tm-hub module using the `tm-hub-client` SDK.
//  SDK auto-injects `X-App-Id` + `Authorization: Bearer <token>` into every request.
//  Source: tm-tools/app/composables/useHub.ts (already working).
// =============================================================================

// P0-3 — a client-only singleton. Building a client per call also built a
// `watch` per call; the watcher now lives once, app-scoped, in plugins/hub.client.ts.
let sharedClient: HubClient | null = null

export const useHub = () => {
  const auth = useAuth()
  const tokenCookie = useCookie('accessToken')

  // Same endpoint as useAuth(): one Hub, one source of truth.
  const { hubUrl, appId, source, problem } = useHubEndpoint()

  const createClient = () => new HubClient({
    baseUrl: hubUrl,
    appId: appId,
    getAccessToken: () => auth.accessToken.value || tokenCookie.value,
    onUnauthorized: () => {
      auth.handleSessionExpired()
    },
    getRefreshToken: () => auth.refreshToken.value || useCookie('refreshToken').value,
    onTokensRefreshed: (tokens) => {
      auth.setTokens(tokens)
    }
  })

  // Client-only singleton: a server render must never share one client across requests.
  const client = import.meta.client ? (sharedClient ??= createClient()) : createClient()

  // Idempotent seed; permission CHANGES are applied by plugins/hub.client.ts.
  const seedPermissions = () => {
    const perms = auth.user.value?.permissions
    if (perms?.length) client.setPermissions([...perms])
  }
  seedPermissions()

  const hubFetchRaw = async <T = unknown>(
    path: string,
    options: NitroFetchOptions<NitroFetchRequest> = {}
  ): Promise<T> => {
    const fullUrl = path.startsWith('http') ? path : `${hubUrl}${path}`
    const headers = new Headers(options.headers as HeadersInit || {})

    if (!headers.has('X-App-Id')) {
      headers.set('X-App-Id', appId)
    }

    const token = auth.accessToken.value || tokenCookie.value
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    // Nuxt's typed-route $fetch overload recurses on the huge API route union
    // for a dynamic string path (TS2321 "Excessive stack depth").
    // @ts-expect-error known TS route-type recursion (remove when Nuxt fixes it)
    return (await $fetch(fullUrl, {
      ...options,
      headers,
      // Include cookies for cross-origin requests (OAuth state cookie)
      credentials: 'include'
    })) as T
  }

  // F2/U1 — honor the Hub's `Retry-After` on a 429 with a single bounded retry,
  // then record the window so auth/refresh backs off too (see app/utils/hub.ts).
  const hubFetch = async <T = unknown>(
    path: string,
    options: NitroFetchOptions<NitroFetchRequest> = {}
  ): Promise<T> => {
    try {
      const result = await hubFetchRaw<T>(path, options)
      clearHubRateLimit()
      return result
    } catch (err: unknown) {
      const res = (err as { response?: Response })?.response
      const status = res?.status || (err as { statusCode?: number })?.statusCode || (err as { status?: number })?.status

      if (status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh') && !path.includes('/auth/register')) {
        const refreshed = await auth.refresh()
        if (refreshed) {
          return await hubFetchRaw<T>(path, options)
        } else {
          await auth.handleSessionExpired()
        }
      }

      if (!res || res.status !== 429) throw err

      const waitMs = noteHubRateLimit(res.headers?.get?.('retry-after') ?? null)
      // Cap the in-request wait so a long Retry-After never hangs the UI; the
      // recorded window still gates later auth/refresh calls.
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 3_000)))

      const retry = await hubFetchRaw<T>(path, options)
      clearHubRateLimit()
      return retry
    }
  }

  return {
    client,
    hubUrl,
    appId,
    source,
    problem,
    hubFetch,
    // Direct modular access via client
    auth: client.auth,
    apps: client.apps,
    configs: client.configs,
    media: client.media,
    notifications: client.notifications,
    users: client.users,
    roles: client.roles,
    routes: client.routes,
    permissions: client.permissions,
    capabilities: client.capabilities,
    logs: client.logs,
    connections: client.connections,
    imports: client.imports,
    export: client.export,
    mail: client.mail
  }
}
