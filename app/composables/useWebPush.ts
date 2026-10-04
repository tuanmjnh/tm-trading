import { getErrorMessage } from '~/shared/utils/errors'

export const useWebPush = () => {
  const { hubFetch, appId } = useHub()
  const { t } = useI18n()
  const isSupported = ref(false)
  const isSubscribed = ref(false)
  const permission = ref<NotificationPermission>('default')
  const subscription = ref<PushSubscription | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const checkSupport = () => {
    if (typeof window === 'undefined') return false

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    isSupported.value = supported

    if (supported) {
      permission.value = Notification.permission
    }

    return supported
  }

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!checkSupport()) {
      error.value = t('error.unexpected')
      return 'denied'
    }

    try {
      const result = await Notification.requestPermission()
      permission.value = result
      return result
    } catch (err) {
      console.error('Error requesting notification permission:', err)
      error.value = getErrorMessage(err, key => t(key))
      return 'denied'
    }
  }

  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const registerDevice = async (deviceType: 'mobile' | 'desktop' | 'tablet' = 'desktop'): Promise<boolean> => {
    if (!checkSupport()) {
      error.value = t('error.unexpected')
      return false
    }

    if (permission.value !== 'granted') {
      const result = await requestPermission()
      if (result !== 'granted') {
        return false
      }
    }

    isLoading.value = true
    error.value = null

    try {
      const resConfig = await hubFetch<{ success: boolean, data: Record<string, string> }>(`/api/v1/apps/${appId}/configs/public`)
      const sysConfig = resConfig.data || {}

      const registration = await navigator.serviceWorker.ready
      let subscriptionData: Record<string, unknown> = {}

      const hasFirebaseClient = sysConfig.FIREBASE_PROJECT_ID && sysConfig.FIREBASE_CLIENT_EMAIL && sysConfig.FIREBASE_PRIVATE_KEY

      if (hasFirebaseClient) {
        console.log('[FirebasePush] Initializing Firebase Cloud Messaging...')

        const { initializeApp, getApps, getApp } = await import('firebase/app')
        const { getMessaging, getToken } = await import('firebase/messaging')

        const firebaseConfig = {
          apiKey: sysConfig.CLOUDINARY_API_KEY || '',
          authDomain: `${sysConfig.FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: sysConfig.FIREBASE_PROJECT_ID,
          storageBucket: sysConfig.FIREBASE_STORAGE_BUCKET || `${sysConfig.FIREBASE_PROJECT_ID}.appspot.com`,
          messagingSenderId: sysConfig.FIREBASE_CLIENT_EMAIL?.split('-')?.[1] || '',
          appId: '1:stub:web:stub'
        }

        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
        const messaging = getMessaging(app)

        if (registration.active) {
          registration.active.postMessage({
            type: 'SET_FIREBASE_CONFIG',
            config: firebaseConfig
          })
        }

        const fcmToken = await getToken(messaging, {
          serviceWorkerRegistration: registration,
          vapidKey: sysConfig.WEB_PUSH_PUBLIC_KEY
        })

        if (!fcmToken) {
          throw new Error('Failed to retrieve FCM Token')
        }

        subscriptionData = { fcmToken }
      } else {
        const vapidPublicKey = sysConfig.WEB_PUSH_PUBLIC_KEY
        if (!vapidPublicKey) {
          throw new Error('VAPID public key not configured in system settings')
        }

        console.log('[WebPush] Using VAPID Public Key:', vapidPublicKey)

        const pushSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
        })

        subscriptionData = { subscription: pushSubscription.toJSON() }
        subscription.value = pushSubscription
      }

      await hubFetch(`/api/v1/apps/${appId}/notifications/subscribe`, {
        method: 'POST',
        body: {
          ...subscriptionData,
          deviceType
        }
      })

      isSubscribed.value = true
      return true
    } catch (err) {
      console.error('[WebPush] Error registering device:', err)
      error.value = getErrorMessage(err, key => t(key))
      return false
    } finally {
      isLoading.value = false
    }
  }

  const unregisterDevice = async (): Promise<boolean> => {
    isLoading.value = true
    error.value = null

    try {
      const registration = await navigator.serviceWorker.ready
      const pushSub = await registration.pushManager.getSubscription()

      let identifier = ''
      if (pushSub) {
        identifier = pushSub.endpoint
        await pushSub.unsubscribe()
      }

      await hubFetch(`/api/v1/apps/${appId}/notifications/unsubscribe`, {
        method: 'POST',
        body: {
          endpoint: identifier
        }
      })

      subscription.value = null
      isSubscribed.value = false
      return true
    } catch (err) {
      console.error('[WebPush] Error unregistering device:', err)
      error.value = getErrorMessage(err, key => t(key))
      return false
    } finally {
      isLoading.value = false
    }
  }

  const checkSubscription = async (): Promise<boolean> => {
    if (!checkSupport()) return false

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) return false

      const pushSubscription = await registration.pushManager.getSubscription()

      if (pushSubscription) {
        subscription.value = pushSubscription
        isSubscribed.value = true
        return true
      }

      isSubscribed.value = false
      return false
    } catch (err) {
      console.error('Error checking subscription:', err)
      return false
    }
  }

  if (import.meta.client) {
    checkSupport()
    checkSubscription()
  }

  return {
    isSupported,
    isSubscribed,
    permission,
    subscription,
    isLoading,
    error,
    checkSupport,
    requestPermission,
    registerDevice,
    unregisterDevice,
    checkSubscription
  }
}
