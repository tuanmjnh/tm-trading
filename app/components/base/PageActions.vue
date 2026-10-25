<script setup lang="ts">
import type { MobileAction } from '~/composables/useMobileBar'

/**
 * Desktop renderer for actions registered through `useMobileBar().registerActions`.
 * BasePage falls back to this when a page has no `#right` slot: only the primary
 * action renders as a labeled pill outside — everything else collapses into the
 * ⋯ dropdown, mirroring the mobile bottom bar.
 *
 * ClientOnly: registration happens in a page/component setup that runs after the
 * navbar subtree on the server, so SSR cannot see the actions (hydration-safe).
 */
const { t } = useI18n()
const { store } = useMobileBar()

const actions = computed<MobileAction[]>(() => {
  void store.version.value
  return (store.actions?.value ?? []).filter(a => a.visible !== false)
})

const layout = computed(() => mobileActionLayout(actions.value))

const overflowItems = computed(() => layout.value.overflow.map(a => ({
  label: a.label,
  icon: a.icon,
  disabled: a.disabled,
  onSelect: a.onSelect,
  children: a.children?.length
    ? a.children.map(c => ({ label: c.label, icon: c.icon, disabled: c.disabled, onSelect: c.onSelect }))
    : undefined
})))
</script>

<template>
  <ClientOnly v-if="actions.length">
    <div class="flex items-center gap-2">
      <UButton
        v-for="a in layout.inline"
        :key="a.label"
        :icon="a.icon"
        :color="a.primary ? 'primary' : 'neutral'"
        :variant="a.primary ? 'soft' : 'ghost'"
        size="sm"
        :label="a.primary ? a.label : undefined"
        :disabled="a.disabled"
        :aria-label="a.label"
        :title="a.label"
        @click="a.onSelect"
      />
      <UDropdownMenu v-if="overflowItems.length" :items="overflowItems" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          square
          size="sm"
          :aria-label="t('common.actions')"
          :title="t('common.actions')"
        />
      </UDropdownMenu>
    </div>
    <template #fallback />
  </ClientOnly>
</template>
