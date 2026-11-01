<script setup lang="ts">
// Obsidian Apex KPI ribbon (mockup: the "metric cards" row at the top of list
// screens). Presentational only — values are computed by the caller from real
// API data, never hardcoded. See docs/web-app/ui-design-system.md.
//
// V4.2 UI pass: the ribbon is a single-row strip (label + hint on the left,
// value on the right) instead of four tall cards, so it costs ~40px of height
// and the first content block stays above the fold on a 1080p screen.
export interface MetricItem {
  key: string
  label: string
  value: string
  hint?: string
  icon?: string
  tone?: 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'
  /** Optional 0..100 progress track rendered as a hairline under the tile. */
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
  <div class="grid gap-2 shrink-0" :class="cols">
    <div
      v-for="m in items"
      :key="m.key"
      class="relative overflow-hidden px-2.5 py-1.5 rounded bg-elevated border border-default flex items-center gap-2 min-w-0"
    >
      <UIcon v-if="m.icon" :name="m.icon" class="w-3.5 h-3.5 shrink-0 text-dimmed" />
      <div class="flex flex-col min-w-0 flex-1 leading-tight">
        <span class="text-[9px] font-medium uppercase tracking-wider text-dimmed truncate">{{ m.label }}</span>
        <span v-if="m.hint" class="text-[10px] text-muted truncate">{{ m.hint }}</span>
      </div>
      <span class="text-sm font-bold shrink-0 tabular-nums" :class="toneText(m.tone)">{{ m.value }}</span>
      <div v-if="m.bar != null" class="absolute inset-x-0 bottom-0 h-0.5 bg-accented/60">
        <div
          class="h-full"
          :class="toneBar(m.tone)"
          :style="{ width: `${Math.max(0, Math.min(100, m.bar))}%` }"
        />
      </div>
    </div>
  </div>
</template>
