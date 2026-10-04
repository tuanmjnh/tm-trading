<script setup lang="ts">
import type { MobileAction } from '~/composables/useMobileBar'
import { useDashboard as useDashboardContext } from '@nuxt/ui/utils/dashboard'

const { t } = useI18n()
const toast = useToast()
const { isNotificationsSlideoverOpen, isSettingsSlideoverOpen } = useDashboard()
const { store } = useMobileBar()
const { isDesktop } = useDeviceBreakpoints()
const { unreadCount, fetchNotify } = useNotify()

const open = useState<boolean>('actions-sheet-open', () => false)
const isScanOpen = ref(false)

watch(open, (value) => {
  if (value) fetchNotify()
})

const dashboard = useDashboardContext({ sidebarCollapsed: ref(false), collapseSidebar: () => {} })

const pageActions = computed(() => {
  void store.version.value
  return (store.actions?.value ?? []).filter(a => a.visible !== false)
})

/** Global refresh fallback — hidden when the page registers its own refresh action. */
const hasPageRefresh = computed(() => pageActions.value.some(a => a.label === t('common.refresh')))

function toggleAppMenu() {
  if (isDesktop.value) {
    dashboard.collapseSidebar?.(!(dashboard.sidebarCollapsed?.value ?? false))
  }
  else {
    dashboard.toggleSidebar?.()
  }
}

const basicActions = computed<MobileAction[]>(() => [
  {
    icon: 'i-lucide-menu',
    label: t('common.menu'),
    iconClass: 'shrink-0 size-5',
    onSelect: toggleAppMenu
  },
  ...(hasPageRefresh.value
    ? []
    : [{
        icon: 'i-lucide-refresh-cw',
        label: t('common.refresh'),
        onSelect: () => reloadNuxtApp()
      }]),
  {
    icon: 'i-lucide-scan-line',
    label: t('scan.title'),
    color: 'primary',
    onSelect: () => { isScanOpen.value = true }
  },
  {
    icon: 'i-lucide-bell',
    label: t('nav.notifications'),
    badge: unreadCount.value || undefined,
    onSelect: () => { isNotificationsSlideoverOpen.value = true }
  },
  {
    icon: 'i-lucide-settings',
    label: t('settings.title'),
    onSelect: () => { isSettingsSlideoverOpen.value = true }
  },
  {
    icon: 'i-lucide-user-circle',
    label: t('profile.title'),
    onSelect: () => navigateTo('/system/profile')
  }
])

function badgeLabel(badge?: number) {
  if (!badge) return ''
  return badge > 99 ? '99+' : String(badge)
}

const expandedRows = ref(new Set<string>())

function toggleExpand(action: MobileAction) {
  const next = new Set(expandedRows.value)
  if (next.has(action.label)) next.delete(action.label)
  else next.add(action.label)
  expandedRows.value = next
}

async function runAction(action: MobileAction) {
  open.value = false
  await action.onSelect?.()
}

async function onScan(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ icon: 'i-lucide-check', color: 'success', title: t('scan.copied') })
  }
  catch {
    toast.add({ icon: 'i-lucide-circle-alert', color: 'warning', title: t('scan.copyFailed'), description: text })
  }
}
</script>

<template>
  <USlideover v-model:open="open" side="bottom" :ui="{ content: 'max-h-[70vh] rounded-t-2xl' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-zap" class="size-5 text-primary" />
        <span class="font-semibold">{{ t('common.actions') }}</span>
      </div>
    </template>
    <template #body>
      <div class="pb-4 space-y-1">
        <UButton
          v-for="(action, i) in basicActions"
          :key="`basic-${i}`"
          :label="action.label"
          :icon="action.icon"
          :color="action.color ?? 'neutral'"
          variant="soft"
          block
          size="lg"
          class="justify-start"
          :ui="action.iconClass ? { leadingIcon: action.iconClass } : undefined"
          @click="runAction(action)"
        >
          <template #trailing>
            <UBadge v-if="action.badge" :label="badgeLabel(action.badge)" color="error" variant="solid"
              size="xs" class="ms-auto" />
          </template>
        </UButton>
        <template v-if="pageActions.length">
          <USeparator />
          <template v-for="(action, i) in pageActions" :key="i">
            <UButton
              :label="action.label"
              :icon="action.icon"
              :color="action.color ?? 'neutral'"
              variant="soft"
              block
              size="lg"
              class="justify-start"
              :disabled="action.disabled"
              :ui="action.iconClass ? { leadingIcon: action.iconClass } : undefined"
              @click="action.children?.length ? toggleExpand(action) : runAction(action)"
            >
              <template #trailing>
                <UBadge v-if="action.badge" :label="badgeLabel(action.badge)" color="error" variant="solid"
                  size="xs" class="ms-auto" />
                <UIcon
                  v-else-if="action.children?.length"
                  :name="expandedRows.has(action.label) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="size-4 text-muted ms-auto"
                />
              </template>
            </UButton>
            <div v-if="action.children?.length && expandedRows.has(action.label)" class="ms-2 me-1 mb-1 space-y-1 border-s-2 border-default ps-2">
              <UButton
                v-for="(child, ci) in action.children"
                :key="ci"
                :label="child.label"
                :icon="child.icon"
                variant="ghost"
                block
                size="sm"
                class="justify-start"
                :disabled="child.disabled"
                @click="runAction({ label: child.label, icon: child.icon ?? 'i-lucide-chevron-right', onSelect: child.onSelect })"
              />
            </div>
          </template>
        </template>
      </div>
    </template>
  </USlideover>

  <LazyInputsScan v-model:open="isScanOpen" @decoded="onScan" />
</template>
