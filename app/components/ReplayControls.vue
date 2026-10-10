<script setup lang="ts">
// =============================================================================
//  ReplayControls (Phase 7R2 / roadmap §13) — transport for one replay
//  session: play / pause / step-one-candle + speed selection + progress.
//
//  The component is purely presentential: the page owns the session state,
//  performs the API calls and passes the fresh summary back down. Progress
//  mirrors the SERVER cursor — what the client has actually received — never
//  a locally guessed position (D17: no future data, even in a progress bar).
// =============================================================================
import type { ReplayMode } from '../../types/replay'

const props = defineProps<{
  mode: ReplayMode
  speed: number
  cursor: number
  total: number
  busy?: boolean
}>()

const emit = defineEmits<{
  play: [speed: number]
  pause: []
  step: []
}>()

const { t } = useI18n()

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const
const speed = ref<number>(1)
watch(() => props.speed, (v) => {
  if ((SPEEDS as readonly number[]).includes(v)) speed.value = v
})

const progress = computed(() =>
  props.total > 0 ? Math.min(100, (props.cursor / props.total) * 100) : 0
)

const statusKey = computed(() => `replay.status_${props.mode}`)
const badgeColor = computed(() => {
  switch (props.mode) {
    case 'playing': return 'success'
    case 'paused': return 'warning'
    case 'done': return 'primary'
    default: return 'neutral'
  }
})

const canPlay = computed(() => props.mode !== 'playing' && props.mode !== 'done')
const canPause = computed(() => props.mode === 'playing')
const canStep = computed(() => props.mode !== 'done' && !props.busy)
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Status + progress (server cursor / total bars) -->
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UBadge :color="badgeColor" variant="subtle" data-testid="replay-status">
          {{ t(statusKey) }}
        </UBadge>
        <span class="text-sm text-muted tabular-nums" data-testid="replay-progress">
          {{ cursor }} / {{ total }}
        </span>
        <span class="text-sm text-muted">{{ t('replay.progress') }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-xs uppercase tracking-wide text-muted">{{ t('replay.speed') }}</span>
        <UButton
          v-for="s in SPEEDS"
          :key="s"
          size="xs"
          :color="s === speed ? 'primary' : 'neutral'"
          :variant="s === speed ? 'soft' : 'ghost'"
          :data-testid="`replay-speed-${s}`"
          @click="speed = s"
        >
          {{ s }}x
        </UButton>
      </div>
    </div>

    <div class="h-2 w-full overflow-hidden rounded-full bg-elevated">
      <div
        class="h-full rounded-full bg-primary transition-all duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <!-- Transport -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        id="replay-play"
        data-testid="replay-play"
        icon="i-lucide-play"
        color="primary"
        variant="soft"
        :disabled="!canPlay || busy"
        @click="emit('play', speed)"
      >
        {{ t('replay.play') }}
      </UButton>
      <UButton
        id="replay-pause"
        data-testid="replay-pause"
        icon="i-lucide-pause"
        color="warning"
        variant="soft"
        :disabled="!canPause || busy"
        @click="emit('pause')"
      >
        {{ t('replay.pause') }}
      </UButton>
      <UButton
        id="replay-step"
        data-testid="replay-step"
        icon="i-lucide-step-forward"
        color="neutral"
        variant="soft"
        :disabled="!canStep"
        @click="emit('step')"
      >
        {{ t('replay.step') }}
      </UButton>
    </div>
  </div>
</template>
