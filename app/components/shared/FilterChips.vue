<script setup lang="ts">
// Obsidian Apex filter chip row (mockup: "All (18) / Live Paper (6) / ...").
// Reusable status/facet selector with optional counts. Presentational only.
export interface FilterChip {
  value: string
  label: string
  count?: number
}

defineProps<{
  items: FilterChip[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()
</script>

<template>
  <div class="flex items-center gap-1 overflow-x-auto">
    <button
      v-for="chip in items"
      :key="chip.value || 'all'"
      type="button"
      class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors"
      :class="chip.value === modelValue
        ? 'bg-accented text-primary font-semibold'
        : 'text-muted hover:text-highlighted hover:bg-muted'"
      @click="emit('update:modelValue', chip.value)"
    >
      <span>{{ chip.label }}</span>
      <span
        v-if="chip.count != null"
        class="text-[10px] font-mono"
        :class="chip.value === modelValue ? 'text-primary/80' : 'text-dimmed'"
      >{{ chip.count }}</span>
    </button>
  </div>
</template>
