<script setup lang="ts">
// =============================================================================
//  Live pip (docs/web-app/ui-design-system.md → Component recipes): a 4px `brand` dot
//  with a soft glow plus an uppercase label-micro caption. Marks a real-time
//  indicator (trade tape, stream status). Inactive instances fall back to a
//  muted dot with no glow and dimmed text.
// =============================================================================
const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    /** Real-time state: glowing brand pip when true, muted dot otherwise. */
    active?: boolean
    /** Override the default `trade.liveData` caption when a context fits better. */
    label?: string
  }>(),
  { active: false, label: undefined }
)

const caption = computed(() => props.label ?? t('trade.liveData'))
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="size-1 shrink-0 rounded-full transition-colors"
      :class="active ? 'bg-primary live-pip-glow' : 'bg-default ring ring-default'"
      aria-hidden="true"
    />
    <span
      class="font-mono text-[9px] uppercase tracking-wider"
      :class="active ? 'text-primary' : 'text-dimmed'"
    >{{ caption }}</span>
  </span>
</template>

<style scoped>
.live-pip-glow {
  box-shadow: 0 0 6px var(--color-brand-500);
}
</style>