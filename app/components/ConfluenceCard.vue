<script setup lang="ts">
import type { ConfluenceDetail, ConfluencePart } from '~~/types/methods'
import { fmtSigned } from '../utils/terminal'

// =============================================================================
//  ConfluenceCard — weighted confluence explanation for a symbol (Phase 10).
//
//  READ-ONLY: the score and each weighted part come from the stored intel
//  document via /api/v1/intel/confluence/:symbol (server-side explain). This
//  card only formats the parts vertically with weight + contribution bars.
// =============================================================================

const { t } = useI18n()

defineProps<{
  symbol: string
  detail: ConfluenceDetail | null
  loading: boolean
}>()

const PART_LABEL: Record<string, string> = {
  method: 'trade.intelMethod',
  regime: 'trade.intelRegime',
  funding: 'trade.intelFunding',
  zone: 'trade.intelZone'
}

const partLabel = (part: ConfluencePart): string => {
  const key = PART_LABEL[part.key]
  if (!key) return part.key
  const label = t(key)
  return label.startsWith(key) ? part.key : label
}

const signedTone = (v: number): string => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')
// bar fill width for a -1..+1 contribution (percentage of half-width)
const fillPct = (v: number): string => `${(Math.min(Math.abs(v), 1) * 50).toFixed(0)}%`
const fillSide = (v: number): string => (v >= 0 ? 'left-1/2 bg-success' : 'right-1/2 bg-error')
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('trade.confluence') }}</h3>
      <span class="text-xs text-muted">{{ symbol }}</span>
    </div>

    <p v-if="loading" class="text-xs text-muted">{{ t('trade.loadData') }}</p>
    <p v-else-if="!detail" class="text-xs text-muted">{{ t('trade.confEmpty') }}</p>

    <template v-else>
      <div class="flex items-baseline gap-2">
        <span
          class="font-mono text-xl font-semibold"
          :class="signedTone(detail.score)"
        >
          {{ fmtSigned(detail.score, 2) }}
        </span>
        <span class="text-xs text-muted">{{ t('trade.confWeighted', { pct: Math.round((detail.score + 1) * 50) }) }}</span>
      </div>

      <div class="flex flex-col gap-1.5 text-xs">
        <div v-for="part in detail.parts" :key="part.key" class="flex items-center gap-2">
          <span class="w-16 shrink-0 font-medium text-muted">{{ partLabel(part) }}</span>
          <span class="w-10 shrink-0 font-mono" :class="signedTone(part.value)">{{ fmtSigned(part.value, 2) }}</span>
          <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-default/60 ring-1 ring-default/50">
            <span
              class="absolute top-0 h-full"
              :class="fillSide(part.value)"
              :style="{ width: fillPct(part.value) }"
            />
          </div>
          <span class="w-8 shrink-0 text-right font-mono text-[11px] text-muted">{{ (part.weight * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </template>
  </div>
</template>