import { createSharedComposable } from '@vueuse/core'

const _useDashboard = () => {
  const route = useRoute()
  const router = useRouter()
  const isNotificationsSlideoverOpen = ref(false)
  const isSettingsSlideoverOpen = ref(false)
  const isHelpModalOpen = ref(false)

  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-d': () => router.push('/system/docs'),
    'n': () => isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value
  })

  watch(() => route.fullPath, () => {
    isNotificationsSlideoverOpen.value = false
    isSettingsSlideoverOpen.value = false
    isHelpModalOpen.value = false
  })

  return {
    isNotificationsSlideoverOpen,
    isSettingsSlideoverOpen,
    isHelpModalOpen
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
