<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <!-- Desktop / tablet: inline filters -->
  <div class="hidden md:flex items-center gap-2 min-w-0">
    <slot />
  </div>

  <!-- Mobile: collapse filters into popover -->
  <UPopover class="md:hidden shrink-0">
    <UButton
      icon="i-lucide-filter"
      color="neutral"
      variant="soft"
      size="sm"
      square
      :aria-label="t('common.filter')"
    />
    <template #content>
      <div class="p-4 min-w-[280px] max-w-[min(90vw,360px)] space-y-3 flex flex-col">
        <slot />
      </div>
    </template>
  </UPopover>
</template>
