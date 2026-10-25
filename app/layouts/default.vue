<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

const route = useRoute()
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

/** Variant for the collapsed sidebar: popover child lists are flat, so groups are dissolved into leaves. */
const collapsedNavItems = computed<NavItem[]>(() =>
  navItems.value.map(item => (item.children?.length ? { ...item, children: flattenNavGroups<NavItem>(item.children) } : item)))

// Non-force: hydrate from the cached/shared catalog immediately and only hit the
// Hub when there is nothing to render (P0-4/P0-5). A forced fetch here duplicated
// the boot request that the nav plugin already issues.
watch(() => auth.isAuthenticated.value, async (ok) => {
  if (ok) {
    await fetchRoutes()
  } else {
    if (route.path !== '/login' && route.path !== '/register') {
      const redirect = route.fullPath !== '/' ? route.fullPath : undefined
      await navigateTo(redirect ? { path: '/login', query: { redirect } } : '/login')
    }
  }
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
    <UDashboardSidebar id="default" v-model:open="open" collapsible resizable class="bg-muted" :toggle="false"
      :menu="{ close: false }" :ui="{ footer: 'lg:border-t lg:border-default' }">
      <template #header="{ collapsed }">
        <LazyDashboardTeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" :label="t('common.search')"
          class="bg-transparent ring-default" />

        <UNavigationMenu v-if="links[0]?.length" :collapsed="collapsed" :items="collapsed ? collapsedNavItems : links[0]"
          orientation="vertical" tooltip
          popover :ui="{
            link: 'data-[active]:bg-elevated data-[active]:text-highlighted! data-[active]:border-l-2 data-[active]:border-l-primary! data-[state=open]:bg-elevated data-[state=open]:text-highlighted! data-[state=open]:border-l-2 data-[state=open]:border-l-primary!',
            childLink: 'data-[active]:bg-elevated data-[active]:text-highlighted! data-[active]:border-l-2 data-[active]:border-l-primary!'
          }" />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex flex-1 items-center gap-2">
          <!-- Back to the app — on mobile the bottom bar owns navigation actions, so no ✕ in the header. -->
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" square size="sm"
            :aria-label="t('common.back')" :ui="{ leadingIcon: 'text-dimmed' }" class="lg:hidden"
            @click="open = false" />
          <LazyDashboardUserMenu :collapsed="collapsed" class="flex-1 lg:ps-0" />
        </div>
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
