<script setup lang="ts">
import type { FreshnessState } from '#shared/types/provenance'

// =============================================================================
//  DataFreshnessBadge (auto-imported as <DataFreshnessBadge>).
//
//  Renders the read-time freshness of ONE observation (V4.2 §4.2). It is a
//  projection only: the state is computed on the server by
//  `server/utils/provenance.ts`, never re-derived here from raw numbers.
//
//  Colour contract:
//    FRESH    success  the only state allowed to look live
//    DELAYED  warning  usable but late
//    STALE    error    must never be mistaken for live
//    MISSING  error    the metric is absent; render N/A, never 0
//    UNKNOWN  neutral  we cannot prove anything (default)
//
//  The age suffix is decorative. It ticks every 30 s while the tab is visible
//  so a value that ages out stops looking current without a page reload.
// =============================================================================

const props = withDefaults(defineProps<{
  /** Server-computed freshness state. */
  state: FreshnessState
  /** Observation timestamp: epoch ms (UTC) or ISO string. */
  asOf?: number | string | null
  size?: 'xs' | 'sm'
  /** Show the age suffix next to the state label. */
  showAge?: boolean
}>(), {
  asOf: null,
  size: 'xs',
  showAge: true,
})

const { t } = useI18n()

const now = ref(Date.now())
useVisibleInterval(() => { now.value = Date.now() }, 30_000, { immediate: false })

const COLOR: Record<FreshnessState, 'success' | 'warning' | 'error' | 'neutral'> = {
  FRESH: 'success',
  DELAYED: 'warning',
  STALE: 'error',
  MISSING: 'error',
  UNKNOWN: 'neutral',
}

const ICON: Record<FreshnessState, string> = {
  FRESH: 'i-lucide-circle-check',
  DELAYED: 'i-lucide-clock',
  STALE: 'i-lucide-triangle-alert',
  MISSING: 'i-lucide-circle-slash',
  UNKNOWN: 'i-lucide-circle-help',
}

const asOfMs = computed<number | null>(() => {
  const raw = props.asOf
  if (raw === null || raw === undefined || raw === '') return null
  const ms = typeof raw === 'number' ? raw : Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
})

const ageMs = computed<number | null>(() => {
  const ms = asOfMs.value
  if (ms === null) return null
  const diff = now.value - ms
  // A future timestamp is not an age; the state already reports UNKNOWN.
  return diff >= 0 ? diff : null
})

const ageLabel = computed<string>(() => {
  if (!props.showAge) return ''
  const ms = ageMs.value
  if (ms === null) return ''
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return t('freshness.age.justNow')
  if (sec < 60) return t('freshness.age.seconds', { n: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('freshness.age.minutes', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('freshness.age.hours', { n: hr })
  return t('freshness.age.days', { n: Math.floor(hr / 24) })
})

const label = computed(() => t(`freshness.states.${props.state}`))

const title = computed(() => {
  const ms = asOfMs.value
  if (ms === null) return ''
  return t('freshness.asOf', { time: new Date(ms).toISOString() })
})
</script>

<template>
  <UBadge
    :label="ageLabel ? `${label} · ${ageLabel}` : label"
    :color="COLOR[state]"
    :leading-icon="ICON[state]"
    variant="subtle"
    :size="size"
    class="font-medium tabular-nums"
    :title="title || undefined"
  />
</template>
