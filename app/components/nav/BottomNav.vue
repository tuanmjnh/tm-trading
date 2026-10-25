<script setup lang="ts">
import { useDashboard as useDashboardContext } from '@nuxt/ui/utils/dashboard'

/**
 * Mobile bottom bar: sidebar toggle (left) · page info text/loading (middle) ·
 * the primary page-action icon + ⋯ + record count (right). The ⋯ sheet
 * (ActionsSheet) owns the overflow actions and the global actions
 * (bell/settings/profile/scan).
 */
const { t } = useI18n()
const actionsOpen = useState<boolean>('actions-sheet-open', () => false)
const { store } = useMobileBar()
const dashboard = useDashboardContext({ sidebarCollapsed: ref(false), collapseSidebar: () => { } })

const info = computed(() => {
  void store.version.value
  return store.info?.value ?? null
})

const layout = computed(() => {
  void store.version.value
  return mobileActionLayout(store.actions?.value ?? [])
})

function toggleSidebar() {
  dashboard.toggleSidebar?.()
}
</script>

<template>
  <div class="lg:hidden">
    <nav class="fixed bottom-0 inset-x-0 z-40 bg-elevated/95 backdrop-blur border-t border-default safe-area-pb">
      <div class="flex h-14 items-stretch">
        <!-- Sidebar toggle -->
        <button type="button"
          class="flex my-2 ms-2 me-1 shrink-0 items-center justify-center rounded-md size-10 text-muted hover:bg-elevated hover:text-highlighted transition-colors"
          :aria-label="t('common.menu')" @click="toggleSidebar">
          <UIcon name="i-lucide-menu" class="size-5" />
        </button>

        <!-- Page info text / loading (the record count sits at the far right) -->
        <div v-if="info?.text !== undefined || info?.loading === true"
          class="flex min-w-0 flex-1 items-center gap-2 ps-1">
          <UIcon v-if="info?.loading" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin text-primary" />
          <span v-if="info?.text" class="truncate text-xs text-muted">{{ info.text }}</span>
        </div>
        <div v-else class="flex-1" />

        <!-- Page actions: only the primary action stays outside, the rest live in ⋯ -->
        <div class="flex items-center gap-1 pe-1">
          <UButton v-for="a in layout.inline" :key="a.label" :icon="a.icon" :color="a.color ?? 'primary'" variant="soft"
            square size="sm" :disabled="a.disabled" :aria-label="a.label" :title="a.label" @click="a.onSelect" />
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="sm"
            :aria-label="t('common.actions')" :title="t('common.actions')" @click="actionsOpen = true" />
          <!-- Record count — always the last element on the right -->
          <span v-if="info?.count !== undefined"
            class="ms-1 pe-1 inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-highlighted">
            <UIcon name="i-lucide-database" class="size-3.5 shrink-0 text-muted" />
            {{ info.hasMore ? `${info.count}+` : info.count }}
          </span>
        </div>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
