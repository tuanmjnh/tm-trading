import type { AuthResponse, AuthUser, ForgotPasswordRequest, LoginPlatform, LoginRequest, RegisterRequest, ResetPasswordRequest, TotpChallenge } from '~/types/auth'
import type { LoginStartResponse } from '~/types/webauthn'

// =============================================================================
//  SATELLITE AUTH — tm-trading is a CLIENT of tm-hub, NOT the provider.
//
//  tm-hub = centralized authentication and connection support system. To use it:
//    1. Create an app in tm-hub -> obtain the `appId` (and `secretKey`)
//    2. Set `NUXT_PUBLIC_HUB_APP_ID` to that `appId` and `NUXT_PUBLIC_HUB_URL` to the tm-hub address
//    3. Send every authentication request directly to tm-hub, including the `X-App-Id` header
//
//  The URL below is therefore `${hubUrl}/api/v1/auth/*` (direct to hub), NOT
//  '/api/v1/auth/*' (internal route). This copy comes from tm-hub, which uses internal
//  routes because it IS the provider — this satellite has replaced that with its own logic.
//  Source: tm-tools/app/composables/useAuth.ts (already working).
// =============================================================================

interface HubUserData {
  id: string
  email: string
  name: string
  roles?: string[]
  permissions?: string[]
  platform?: LoginPlatform
  createdAt?: string
  updatedAt?: string
}

interface HubAuthData {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: HubUserData
  totpRequired?: boolean
  pendingTotpToken?: string
}

interface HubMeData {
  userId: string
  email: string
  name: string
  roles?: string[]
  permissions?: string[]
  allowedRoutes?: string[]
  platform?: LoginPlatform
  createdAt?: string
  updatedAt?: string
}

export const useAuth = () => {
  const user = useState<AuthUser | null>('auth:user', () => null)
  const accessToken = useState<string | null>('auth:accessToken', () => null)
  const refreshToken = useState<string | null>('auth:refreshToken', () => null)
  const loading = useState('auth:loading', () => false)

  const config = useRuntimeConfig()
  const hubUrl = (config.public.hubUrl as string) || 'http://localhost:4000'
  const appId = (config.public.hubAppId as string) || 'tm-trading'

  const isAuthenticated = computed(() => !!user.value)
  const can = (module: string, action: string) => {
    if (!user.value) return false
    const perms = user.value.permissions || []
    if (perms.includes('*')) return true
    const candidates = new Set<string>([`${module}.${action}`, `${module}:${action}`])
    if (action === 'write') {
      for (const a of ['upload', 'create', 'update', 'manage']) {
        candidates.add(`${module}.${a}`)
        candidates.add(`${module}:${a}`)
      }
    }
    if (action === 'manage') {
      for (const a of ['create', 'update', 'delete', 'write']) {
        candidates.add(`${module}.${a}`)
        candidates.add(`${module}:${a}`)
      }
    }
    if (module === 'logs' && action === 'read') {
      candidates.add('apps.logs.read')
      candidates.add('apps:logs.read')
    }
    return perms.some(p => candidates.has(p))
  }

  // Gating UI capabilities (ARCHITECTURE §8) — NOT a security boundary; backend
  // enforces capabilities independently on each API (§9). Same pattern as tm-hub/useAuth.
  const hasPermission = (capability: string): boolean => {
    if (!user.value) return false
    const perms = user.value.permissions || []
    if (perms.includes('*')) return true
    if (perms.includes(capability)) return true
    // legacy colon form (`apps:read`)
    if (perms.includes(capability.replace(/\./g, ':'))) return true
    return false
  }
  const hasAnyPermission = (capabilities: string[]): boolean => capabilities.some(hasPermission)
  const hasAllPermissions = (capabilities: string[]): boolean => capabilities.every(hasPermission)

  function applyAuthData(data: HubAuthData): AuthResponse {
    const formattedUser: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: data.user.roles?.[0] || 'user',
      permissions: data.user.permissions || [],
      platform: data.user.platform || 'web',
      createdAt: data.user.createdAt || new Date().toISOString(),
      updatedAt: data.user.updatedAt || new Date().toISOString()
    }

    user.value = formattedUser
    accessToken.value = data.accessToken
    refreshToken.value = data.refreshToken

    const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
    const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

    cookieAccess.value = data.accessToken
    cookieRefresh.value = data.refreshToken

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      user: formattedUser
    }
  }

  async function login(credentials: LoginRequest): Promise<AuthResponse | TotpChallenge> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...credentials, appId }
      })

      if (data.totpRequired && data.pendingTotpToken && data.user) {
        return {
          totpRequired: true,
          pendingTotpToken: data.pendingTotpToken,
          user: {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name
          }
        }
      }

      return applyAuthData(data)
    } finally {
      loading.value = false
    }
  }

  async function passkeyLogin(): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const start = await $fetch<{ success: boolean, data: LoginStartResponse }>(`${hubUrl}/api/v1/auth/passkey/login/start`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { appId }
      })
      const opts = start.data

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: b64urlToBuf(opts.challenge),
        rpId: opts.rpId,
        timeout: opts.timeout,
        allowCredentials: opts.allowCredentials?.map(c => ({
          id: b64urlToBuf(c.id),
          type: 'public-key' as const,
          transports: c.transports as AuthenticatorTransport[] | undefined
        })),
        userVerification: opts.userVerification as UserVerificationRequirement | undefined
      }

      const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null
      if (!credential) throw new Error('Passkey authentication cancelled')

      const assertion = credential.response as AuthenticatorAssertionResponse
      const serialized = {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: 'public-key' as const,
        response: {
          clientDataJSON: bufToB64url(assertion.clientDataJSON),
          authenticatorData: bufToB64url(assertion.authenticatorData),
          signature: bufToB64url(assertion.signature),
          userHandle: assertion.userHandle ? bufToB64url(assertion.userHandle) : undefined
        }
      }

      const finish = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/passkey/login/finish`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { appId, credential: serialized }
      })
      return applyAuthData(finish.data)
    } finally {
      loading.value = false
    }
  }

  async function verifyTotp(code: string, pendingTotpToken: string): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/totp/login`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { code, pendingTotpToken, appId }
      })
      return applyAuthData(data)
    } finally {
      loading.value = false
    }
  }

  async function register(input: RegisterRequest): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId }
      })

      const formattedUser: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role: data.user.roles?.[0] || 'user',
        permissions: data.user.permissions || [],
        platform: data.user.platform || 'web',
        createdAt: data.user.createdAt || new Date().toISOString(),
        updatedAt: data.user.updatedAt || new Date().toISOString()
      }

      user.value = formattedUser
      accessToken.value = data.accessToken
      refreshToken.value = data.refreshToken

      const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
      const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

      cookieAccess.value = data.accessToken
      cookieRefresh.value = data.refreshToken

      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        user: formattedUser
      }
    } finally {
      loading.value = false
    }
  }

  // Forgot/reset password — send directly to tm-hub (satellite), not internal routes.
  async function forgotPassword(input: ForgotPasswordRequest): Promise<void> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      await $fetch(`${hubUrl}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId }
      })
    } finally {
      loading.value = false
    }
  }

  async function resetPassword(input: ResetPasswordRequest): Promise<void> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      await $fetch(`${hubUrl}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId }
      })
    } finally {
      loading.value = false
    }
  }

  let refreshPromise: Promise<boolean> | null = null

  async function refresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
      const rToken = refreshToken.value || useCookie('refreshToken').value
      if (!rToken) return false

      try {
        const res = await fetch(`${hubUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': appId
          },
          body: JSON.stringify({ refreshToken: rToken, appId })
        })

        if (!res.ok) return false

        const json = await res.json()
        if (!json.success || !json.data) return false

        const data = json.data
        accessToken.value = data.accessToken
        refreshToken.value = data.refreshToken

        const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
        const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

        cookieAccess.value = data.accessToken
        cookieRefresh.value = data.refreshToken

        // Refresh user info
        await fetchUser()

        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  }

  async function logout(): Promise<void> {
    try {
      const rToken = refreshToken.value || useCookie('refreshToken').value
      if (rToken) {
        await fetch(`${hubUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': appId
          },
          body: JSON.stringify({ refreshToken: rToken })
        }).catch(() => { })
      }
    } catch {
      // Ignore logout errors
    } finally {
      user.value = null
      accessToken.value = null
      refreshToken.value = null

      const cookieAccess = useCookie('accessToken', { path: '/' })
      const cookieRefresh = useCookie('refreshToken', { path: '/' })
      cookieAccess.value = null
      cookieRefresh.value = null
    }
  }

  async function fetchUser(): Promise<void> {
    try {
      const token = useCookie('accessToken').value
      if (!token) {
        const rToken = useCookie('refreshToken').value
        if (rToken) {
          const success = await refresh()
          if (success) return
        }
        user.value = null
        accessToken.value = null
        refreshToken.value = null
        return
      }

      accessToken.value = token
      refreshToken.value = useCookie('refreshToken').value || null

      const { data } = await $fetch<{ success: boolean, data: HubMeData }>(`${hubUrl}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-App-Id': appId
        }
      })

      user.value = {
        id: data.userId,
        email: data.email,
        name: data.name,
        role: data.roles?.[0] || 'user',
        permissions: data.permissions || [],
        platform: data.platform || 'web',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString()
      }
    } catch {
      const success = await refresh()
      if (!success) {
        user.value = null
        accessToken.value = null
        refreshToken.value = null
      }
    }
  }

  async function revokeTokens(): Promise<void> {
    await logout()
  }

  function setTokens(tokens: { accessToken: string, refreshToken: string, expiresIn: number }) {
    accessToken.value = tokens.accessToken
    refreshToken.value = tokens.refreshToken
    const cookieAccess = useCookie('accessToken', { maxAge: tokens.expiresIn, path: '/', sameSite: 'lax' })
    const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })
    cookieAccess.value = tokens.accessToken
    cookieRefresh.value = tokens.refreshToken
  }

  return {
    user: readonly(user),
    accessToken: readonly(accessToken),
    refreshToken: readonly(refreshToken),
    loading: readonly(loading),
    isAuthenticated,
    can,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    login,
    passkeyLogin,
    verifyTotp,
    register,
    forgotPassword,
    resetPassword,
    logout,
    refresh,
    fetchUser,
    revokeTokens,
    setTokens
  }
}
