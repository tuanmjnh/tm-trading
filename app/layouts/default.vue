<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

const open = ref(false)
const { t } = useI18n()
const auth = useAuth()
const { isSettingsSlideoverOpen, isHelpModalOpen } = useDashboard()
const { fetchRoutes, buildNavItems } = useNavMenu()

type NavItem = { label?: string, icon?: string, to?: string, children?: NavItem[], [k: string]: any }

const dbNav = ref<NavItem[]>([])
const openState = ref(true)

const fallbackNav = computed<NavItem[]>(() => [
  { label: t('nav.overview'), icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: t('nav.docs'), icon: 'i-lucide-book-open', to: '/system/docs' }
])

const navItems = computed<NavItem[]>(() => dbNav.value.length ? dbNav.value : fallbackNav.value)
const links = computed(() => [navItems.value])

async function loadNav() {
  if (!auth.isAuthenticated.value) {
    dbNav.value = []
    return
  }
  await fetchRoutes(true)
  dbNav.value = buildNavItems(openState) as unknown as NavItem[]
}

watch(() => auth.isAuthenticated.value, loadNav, { immediate: true })

const groups = computed<CommandPaletteGroup[]>(() => [
  {
    id: 'links',
    label: t('common.navigation'),
    items: navItems.value
      .flatMap((item) => {
        if (item.children?.length) {
          return item.children
            .filter(c => c.to)
            .map(c => ({ id: String(c.to), label: String(c.label), icon: c.icon, to: c.to }))
        }
        return item.to ? [{ id: String(item.to), label: String(item.label), icon: item.icon, to: item.to }] : []
      })
      .slice(0, 20)
  },
  {
    id: 'actions',
    label: t('common.actions'),
    items: [
      {
        id: 'profile',
        label: t('profile.title'),
        icon: 'i-lucide-user-circle',
        to: '/system/profile'
      },
      {
        id: 'settings',
        label: t('settings.title'),
        icon: 'i-lucide-settings',
        to: '/system/settings'
      },
      {
        id: 'help',
        label: t('help.title'),
        icon: 'i-lucide-help-circle',
        onSelect: () => { isHelpModalOpen.value = true }
      }
    ]
  }
])
</script>

<template>
  <UDashboardGroup unit="rem" class="pb-14 lg:pb-0">
    <UDashboardSidebar id="default" v-model:open="open" collapsible resizable class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }">
      <template #header="{ collapsed }">
        <LazyDashboardTeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" :label="t('common.search')"
          class="bg-transparent ring-default" />

        <UNavigationMenu v-if="links[0]?.length" :collapsed="collapsed" :items="links[0]" orientation="vertical" tooltip
          popover />
      </template>

      <template #footer="{ collapsed }">
        <LazyDashboardUserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" :placeholder="t('common.search')" />

    <slot />

    <LazyNavBottomNav />

    <LazyNavActionsSheet />

    <LazyDashboardSettingsSlideover />
    <LazyDashboardHelpModal />
    <LazyDashboardNotificationsSlideover />
  </UDashboardGroup>
</template>
