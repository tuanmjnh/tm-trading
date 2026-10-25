<script setup lang="ts">
// Obsidian Apex KPI ribbon (mockup: the 4-tile "metric cards" row at the top of
// list screens). Presentational only — values are computed by the caller from
// real API data, never hardcoded. See docs/web-app/ui-design-system.md.
export interface MetricItem {
  key: string
  label: string
  value: string
  hint?: string
  icon?: string
  tone?: 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'
  /** Optional 0..100 progress track rendered under the value. */
  bar?: number
}

withDefaults(defineProps<{
  items: MetricItem[]
  /** Tailwind grid-template classes for the responsive ribbon. */
  cols?: string
}>(), {
  cols: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
})

const toneText = (tone?: MetricItem['tone']) => {
  switch (tone) {
    case 'primary': return 'text-primary'
    case 'success': return 'text-success'
    case 'error': return 'text-error'
    case 'warning': return 'text-warning'
    case 'info': return 'text-info'
    default: return 'text-highlighted'
  }
}

const toneBar = (tone?: MetricItem['tone']) => {
  switch (tone) {
    case 'success': return 'bg-success'
    case 'error': return 'bg-error'
    case 'warning': return 'bg-warning'
    case 'info': return 'bg-info'
    default: return 'bg-primary'
  }
}
</script>

<template>
  <div class="grid gap-3 shrink-0" :class="cols">
    <div
      v-for="m in items"
      :key="m.key"
      class="p-3.5 rounded bg-elevated border border-default flex flex-col gap-1.5 min-w-0"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-medium uppercase tracking-wider text-dimmed truncate">{{ m.label }}</span>
        <UIcon v-if="m.icon" :name="m.icon" class="w-4 h-4 shrink-0 text-dimmed" />
      </div>
      <div class="text-xl font-bold truncate" :class="toneText(m.tone)">{{ m.value }}</div>
      <p v-if="m.hint" class="text-[11px] text-muted truncate">{{ m.hint }}</p>
      <div v-if="m.bar != null" class="w-full h-1 rounded-full bg-accented mt-1 overflow-hidden">
        <div
          class="h-full rounded-full"
          :class="toneBar(m.tone)"
          :style="{ width: `${Math.max(0, Math.min(100, m.bar))}%` }"
        />
      </div>
    </div>
  </div>
</template>
