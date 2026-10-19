<script setup lang="ts">
// §61.17 Phase C (C5): a non-blocking "stale" strip for a trading screen whose
// last refresh failed while earlier data is still displayed. Never replaces the
// data — it sits as a `shrink-0` sibling (see the flex-height trap) and offers
// a retry.
withDefaults(defineProps<{
  stale?: boolean
  retrying?: boolean
  message?: string
}>(), {
  stale: false,
  retrying: false,
  message: ''
})

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    v-if="stale"
    class="shrink-0 flex items-center gap-2 rounded bg-warning/10 ring ring-warning/40 px-3 py-2"
    role="status"
  >
    <UIcon name="i-lucide-triangle-alert" class="w-4 h-4 text-warning shrink-0" />
    <span class="text-[11px] text-muted flex-1 min-w-0">{{ message }}</span>
    <UButton
      icon="i-lucide-refresh-cw"
      size="xs"
      variant="soft"
      color="warning"
      :loading="retrying"
      :aria-label="$t('common.retry')"
      @click="emit('retry')"
    />
  </div>
</template>
