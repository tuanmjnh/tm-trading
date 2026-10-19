<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

const open = ref(false)
const { t } = useI18n()
const auth = useAuth()
const { isSettingsSlideoverOpen, isHelpModalOpen } = useDashboard()
const { fetchRoutes, buildNavItems, allowedRoutes } = useNavMenu()

type NavItem = { label?: string, icon?: string, to?: string, children?: NavItem[], [k: string]: any }

const openState = ref(true)

const fallbackNav = computed<NavItem[]>(() => [
  { label: t('nav.overview'), icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: t('nav.docs'), icon: 'i-lucide-book-open', to: '/admin-system/docs' }
])

// Derived, not stored: `buildNavItems` translates labels through `t()`, so the
// menu must re-evaluate when the locale changes (otherwise it keeps the labels
// of the language that was active when it was built until a full reload).
const navItems = computed<NavItem[]>(() => {
  if (!auth.isAuthenticated.value || !allowedRoutes.value.length) return fallbackNav.value
  return buildNavItems(openState) as unknown as NavItem[]
})
const links = computed(() => [navItems.value])

// Non-force: hydrate from the cached/shared catalog immediately and only hit the
// Hub when there is nothing to render (P0-4/P0-5). A forced fetch here duplicated
// the boot request that the nav plugin already issues.
watch(() => auth.isAuthenticated.value, async (ok) => {
  if (ok) await fetchRoutes()
}, { immediate: true })

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
        to: '/admin-system/profile'
      },
      {
        id: 'settings',
        label: t('settings.title'),
        icon: 'i-lucide-settings',
        to: '/admin-system/settings'
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
    <UDashboardSidebar id="default" v-model:open="open" collapsible resizable class="bg-muted"
      :ui="{ footer: 'lg:border-t lg:border-default' }">
      <template #header="{ collapsed }">
        <LazyDashboardTeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" :label="t('common.search')"
          class="bg-transparent ring-default" />

        <UNavigationMenu v-if="links[0]?.length" :collapsed="collapsed" :items="links[0]" orientation="vertical" tooltip
          popover
          :ui="{
            link: 'data-[active]:bg-elevated data-[active]:text-highlighted! data-[active]:border-l-2 data-[active]:border-l-primary! data-[state=open]:bg-elevated data-[state=open]:text-highlighted! data-[state=open]:border-l-2 data-[state=open]:border-l-primary!',
            childLink: 'data-[active]:bg-elevated data-[active]:text-highlighted! data-[active]:border-l-2 data-[active]:border-l-primary!'
          }" />
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
