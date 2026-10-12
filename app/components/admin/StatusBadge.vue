<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  color?: 'success' | 'neutral' | 'warning' | 'info' | 'error' | 'primary' | 'secondary'
  icon?: string
  size?: 'xs' | 'sm'
  clickable?: boolean
  loading?: boolean
  disabled?: boolean
}>(), {
  color: 'neutral',
  icon: '',
  size: 'xs',
  clickable: false,
  loading: false,
  disabled: false
})

const emit = defineEmits<{ click: [] }>()

const pillColor: Record<string, string> = {
  success: 'bg-success/10 text-success',
  neutral: 'bg-elevated text-muted',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  error: 'bg-error/10 text-error',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary'
}
</script>

<template>
  <button v-if="clickable" type="button"
    class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:opacity-80 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    :class="pillColor[color]" :disabled="disabled || loading" @click.stop="emit('click')">
    <UIcon v-if="loading" name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin" />
    <UIcon v-else-if="icon" :name="icon" class="w-3.5 h-3.5" />
    <span>{{ label }}</span>
  </button>
  <UBadge v-else :label="label" :color="color" :icon="icon || undefined" variant="subtle" :size="size" />
</template>
