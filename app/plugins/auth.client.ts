export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuth()
  const router = useRouter()
  const tokenCookie = useCookie('accessToken')

  let isLoggingOut = false

  const handleSessionExpired = async () => {
    if (isLoggingOut) return
    isLoggingOut = true

    try {
      await auth.logout()
      if (router.currentRoute.value.path !== '/login') {
        const toast = useToast()
        const i18n = (nuxtApp as unknown as { $i18n?: { t: (key: string) => string } }).$i18n
        const title = i18n?.t?.('auth.sessionExpired') ?? 'Session expired'
        const description = i18n?.t?.('auth.sessionExpiredDesc') ?? 'Please log in again to continue.'

        toast.add({
          title,
          description,
          color: 'error'
        })
        await router.push('/login')
      }
    } finally {
      setTimeout(() => {
        isLoggingOut = false
      }, 1000)
    }
  }

  const originalFetch = globalThis.$fetch

  const config = useRuntimeConfig()
  const appId = (config.public.hubAppId as string) || 'tm-trading'

  const customFetch = originalFetch.create({
    onRequest({ options }) {
      const headers = new Headers(options.headers)
      if (!headers.has('X-App-Id')) {
        headers.set('X-App-Id', appId)
      }

      const token = auth.accessToken.value || tokenCookie.value
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      options.headers = headers
    },
    async onResponseError({ response, request }) {
      if (response.status === 401) {
        const url = typeof request === 'string' ? request : (request as { url?: string })?.url || ''

        if (url.includes('/auth/login') || url.includes('/auth/register')) {
          return
        }

        if (url.includes('/auth/refresh')) {
          await handleSessionExpired()
          return
        }

        const refreshed = await auth.refresh()
        if (refreshed) {
          return
        }

        await handleSessionExpired()
      }
    }
  })

  globalThis.$fetch = customFetch
  nuxtApp.$fetch = customFetch

  // Window focus listener: verify session when user returns to app
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      if (auth.isAuthenticated.value) {
        auth.fetchUser().catch(() => { })
      }
    })
  }
})
