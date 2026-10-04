<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{ collapsed?: boolean }>()

const colorMode = useColorMode()
const appConfig = useAppConfig()
const { t, locale, setLocale } = useI18n()
const auth = useAuth()
const { isSettingsSlideoverOpen, isHelpModalOpen } = useDashboard()

const colors = ['blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky']
const neutrals = ['slate', 'gray', 'zinc', 'neutral', 'stone']

const userName = computed(() => auth.user.value?.name || 'User')
const userEmail = computed(() => auth.user.value?.email || '')
const avatar = computed(() => ({
  src: (auth.user.value as any)?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(userEmail.value || 'user')}`,
  alt: userName.value
}))

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      type: 'label',
      label: userName.value,
      avatar: avatar.value
    }
  ],
  [
    {
      label: t('profile.title'),
      icon: 'i-lucide-user-circle',
      to: '/system/profile'
    },
    {
      label: t('settings.title'),
      icon: 'i-lucide-settings',
      to: '/system/settings'
    },
    {
      label: t('nav.docs'),
      icon: 'i-lucide-book-open',
      to: '/system/docs'
    }
  ],
  [
    {
      label: t('settings.language'),
      icon: 'i-lucide-languages',
      children: [
        {
          label: t('settings.vietnamese'),
          type: 'checkbox' as const,
          checked: locale.value === 'vi',
          onSelect: () => setLocale('vi')
        },
        {
          label: t('settings.english'),
          type: 'checkbox' as const,
          checked: locale.value === 'en',
          onSelect: () => setLocale('en')
        }
      ]
    },
    {
      label: t('settings.theme'),
      icon: 'i-lucide-sun-moon',
      children: [
        {
          label: t('settings.light'),
          icon: 'i-lucide-sun',
          type: 'checkbox' as const,
          checked: colorMode.value === 'light',
          onSelect: (e: Event) => {
            e.preventDefault()
            colorMode.preference = 'light'
          }
        },
        {
          label: t('settings.dark'),
          icon: 'i-lucide-moon',
          type: 'checkbox' as const,
          checked: colorMode.value === 'dark',
          onSelect: (e: Event) => {
            e.preventDefault()
            colorMode.preference = 'dark'
          }
        },
        {
          label: t('settings.systemTheme'),
          icon: 'i-lucide-monitor',
          type: 'checkbox' as const,
          checked: colorMode.preference === 'system',
          onSelect: (e: Event) => {
            e.preventDefault()
            colorMode.preference = 'system'
          }
        }
      ]
    },
    {
      label: t('settings.appearance'),
      icon: 'i-lucide-palette',
      children: [
        {
          label: t('settings.primaryColor'),
          slot: 'chip' as const,
          chip: appConfig.ui.colors.primary,
          content: { align: 'center', collisionPadding: 16 },
          children: colors.map(color => ({
            label: color,
            chip: color,
            slot: 'chip' as const,
            checked: appConfig.ui.colors.primary === color,
            type: 'checkbox' as const,
            onSelect: (e: Event) => {
              e.preventDefault()
              appConfig.ui.colors.primary = color
            }
          }))
        },
        {
          label: t('settings.neutralColor'),
          slot: 'chip' as const,
          chip: appConfig.ui.colors.neutral === 'neutral' ? 'old-neutral' : appConfig.ui.colors.neutral,
          content: { align: 'end', collisionPadding: 16 },
          children: neutrals.map(color => ({
            label: color,
            chip: color === 'neutral' ? 'old-neutral' : color,
            slot: 'chip' as const,
            checked: appConfig.ui.colors.neutral === color,
            type: 'checkbox' as const,
            onSelect: (e: Event) => {
              e.preventDefault()
              appConfig.ui.colors.neutral = color
            }
          }))
        }
      ]
    }
  ],
  [
    {
      label: t('help.title'),
      icon: 'i-lucide-help-circle',
      onSelect: () => { isHelpModalOpen.value = true }
    },
    {
      label: t('auth.signOut'),
      icon: 'i-lucide-log-out',
      color: 'error' as const,
      onSelect: async () => {
        await auth.logout()
        await navigateTo('/login')
      }
    }
  ]
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }">
    <UButton v-bind="{
      avatar,
      label: collapsed ? undefined : userName,
      trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
    }" color="neutral" variant="ghost" block :square="collapsed" class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }" />

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2" :style="{
          '--chip-light': `var(--color-${(item as any).chip}-500)`,
          '--chip-dark': `var(--color-${(item as any).chip}-400)`
        }" />
      </div>
    </template>
  </UDropdownMenu>
</template>
