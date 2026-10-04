<script setup lang="ts">
export interface EmptyStateAction {
  label: string
  icon?: string
  color?: 'error' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'neutral'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  onClick?: () => void
}

withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  actions?: EmptyStateAction[]
}>(), {
  description: '',
  icon: '',
  actions: () => []
})
</script>

<template>
  <div v-if="!description && !actions.length && !icon" class="p-8 text-center text-muted">
    {{ title }}
  </div>
  <div v-else
    class="flex flex-col items-center justify-center p-8 sm:p-12 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl bg-elevated/20 text-center space-y-4">
    <div class="p-3.5 rounded-full bg-primary/10 text-primary">
      <UIcon :name="icon || 'i-lucide-inbox'" class="w-8 h-8" />
    </div>
    <div class="space-y-1 max-w-md">
      <h3 class="font-semibold text-base text-highlighted">{{ title }}</h3>
      <p v-if="description" class="text-xs text-neutral-500 leading-relaxed">{{ description }}</p>
    </div>
    <div v-if="actions.length" class="flex flex-wrap items-center justify-center gap-2 pt-2">
      <UButton v-for="(action, i) in actions" :key="i" :label="action.label" :icon="action.icon"
        :color="action.color || 'primary'" :variant="action.variant || 'solid'" size="md"
        @click="action.onClick?.()" />
    </div>
    <slot />
  </div>
</template>
