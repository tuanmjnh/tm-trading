<script setup lang="ts">
// Alerts workspace tabs (V4.2 S4c). Path-based (not `?tab=`) because the three
// alerts surfaces are real, independently-routable pages that each own their
// BasePage; the strip is the shared navigation chrome above them. Deep links
// (`/alerts/history`, `/alerts/inbox`) keep working and are hidden from the
// primary nav, exactly like the S4b workspace tabs.
defineProps<{
  /** Active tab key — the page that is rendering this strip. */
  active: 'rules' | 'history' | 'inbox'
}>()

const { t } = useI18n()

const items = computed(() => [
  { value: 'rules', label: t('alertsWorkspace.tabs.rules'), icon: 'i-lucide-shield-alert', to: '/alerts' },
  { value: 'history', label: t('alertsWorkspace.tabs.history'), icon: 'i-lucide-bell', to: '/alerts/history' },
  { value: 'inbox', label: t('alertsWorkspace.tabs.inbox'), icon: 'i-lucide-inbox', to: '/alerts/inbox' }
])

function onSelect(value: string | number | undefined) {
  const next = items.value.find(item => item.value === String(value))
  if (next) navigateTo(next.to)
}
</script>

<template>
  <div class="flex items-center gap-3 border-b border-default px-4 sm:px-6 py-1.5 overflow-x-auto">
    <span class="hidden sm:inline text-xs font-semibold uppercase tracking-wide text-dimmed shrink-0">
      {{ t('alertsWorkspace.title') }}
    </span>
    <UTabs
      :model-value="active"
      :items="items"
      :content="false"
      size="sm"
      class="w-full sm:w-auto"
      @update:model-value="onSelect"
    />
  </div>
</template>
