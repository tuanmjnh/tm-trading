import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'
import { HubClient } from 'tm-hub-client'

// =============================================================================
//  SATELLITE HUB CLIENT — Wrap each tm-hub module using the `tm-hub-client` SDK.
//  SDK auto-injects `X-App-Id` + `Authorization: Bearer <token>` into every request.
//  Source: tm-tools/app/composables/useHub.ts (already working).
// =============================================================================

export const useHub = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const tokenCookie = useCookie('accessToken')

  const hubUrl = (config.public.hubUrl as string) || 'http://localhost:4000'
  const appId = (config.public.hubAppId as string) || 'tm-trading'

  const client = new HubClient({
    baseUrl: hubUrl,
    appId: appId,
    getAccessToken: () => auth.accessToken.value || tokenCookie.value,
    onUnauthorized: () => {
      auth.logout()
    },
    getRefreshToken: () => auth.refreshToken.value || useCookie('refreshToken').value,
    onTokensRefreshed: (tokens) => {
      auth.setTokens(tokens)
    }
  })

  const seedPermissions = () => {
    const perms = auth.user.value?.permissions
    if (perms?.length) client.setPermissions([...perms])
  }
  seedPermissions()
  if (import.meta.client) {
    watch(() => auth.user.value?.permissions, seedPermissions)
  }

  const hubFetch = async <T = unknown>(
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

    return (await $fetch(fullUrl, {
      ...options,
      headers,
      // Include cookies for cross-origin requests (OAuth state cookie)
      credentials: 'include'
    })) as T
  }

  return {
    client,
    hubUrl,
    appId,
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
