<script setup lang="ts">
// Run-mode badge (roadmap §58.9 Slice 3 — "clear separation between backtest,
// replay and live paper metrics"). Every Test Center monitoring surface states
// WHICH run mode produced the metrics it shows, so a backtest stat is never
// mistaken for a live-paper one. Presentational only — the caller passes mode.
export type RunMode = 'BACKTEST' | 'REPLAY' | 'LIVE_PAPER'

const props = defineProps<{ mode: RunMode }>()

const { t } = useI18n()

const icon = computed(() =>
  props.mode === 'BACKTEST' ? 'i-lucide-flask-conical'
    : props.mode === 'REPLAY' ? 'i-lucide-history'
      : 'i-lucide-fast-forward')

const color = computed<'primary' | 'info' | 'success'>(() =>
  props.mode === 'BACKTEST' ? 'primary' : props.mode === 'REPLAY' ? 'info' : 'success')

// Fall back to the raw enum if the key is ever missing — never blank.
const label = computed(() => t(`testCenter.modes.${props.mode}`, props.mode))
</script>

<template>
  <UBadge
    :label="label"
    :color="color"
    :leading-icon="icon"
    variant="subtle"
    size="sm"
    class="font-medium"
  />
</template>
