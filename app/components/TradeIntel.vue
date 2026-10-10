<script setup lang="ts">
import type { IntelAccum, IntelFlow, IntelFunding, IntelRegime } from '~~/types/intel'
import {
  flowTone,
  fmtSigned,
  fundingCountdown,
  fundingTone,
  oiTrendTone,
  regimeTone
} from '../utils/terminal'

// =============================================================================
//  TradeIntel — compact per-symbol intel strip for the trade terminal (roadmap
//  Phase 8/9). READ-ONLY: renders only what `/api/v1/intel` already stored
//  (D1) — the tone/format helpers are pure presentation mappings. Each chip
//  hides when its data is absent; replay mode hides the whole row in the
//  caller (real-time-only context must not leak into replay — D17).
// =============================================================================

const { t } = useI18n()

const props = defineProps<{
  symbol: string
  funding: IntelFunding | null
  flow: IntelFlow | null
  accum: IntelAccum | null
  regime: IntelRegime | null
  /** OI trend % for this symbol from regime.sweep (null = not tracked). */
  oiTrendPct: number | null
}>()

const hasAny = computed(() =>
  Boolean(props.funding || props.flow || props.accum || props.regime || props.oiTrendPct != null)
)

const flowDirLabel = (dir: string): string => {
  switch (dir) {
    case 'buy':
      return t('trade.intelDirBuy')
    case 'sell':
      return t('trade.intelDirSell')
    case 'vol':
      return t('trade.intelDirVol')
    default:
      return t('trade.intelDirMixed')
  }
}

const accumCount = computed(() => props.accum?.reasons?.length ?? 0)
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-default ring ring-default px-3 py-2">
    <span class="text-xs font-medium tracking-wide text-muted uppercase">
      {{ t('trade.intelRegime') }} · <span class="font-mono normal-case">{{ symbol }}</span>
    </span>

    <UBadge
      v-if="regime"
      :label="`${t('trade.intelRegime')} ${regime.season.toUpperCase()}${regime.asi?.d90 != null ? ` · ASI ${fmtSigned(regime.asi.d90, 0)}` : ''}`"
      :color="regimeTone(regime.season)"
      variant="subtle"
      size="xs"
    />
    <UBadge
      v-if="funding"
      :label="`${t('trade.intelFunding')} ${fmtSigned(funding.pct)}% · ${t('trade.intelNext')} ${fundingCountdown(funding.nextFundingTime)}`"
      :color="fundingTone(funding.pct)"
      variant="subtle"
      size="xs"
    />
    <UBadge
      v-if="oiTrendPct != null"
      :label="`${t('trade.intelOi')} ${fmtSigned(oiTrendPct)}%`"
      :color="oiTrendTone(oiTrendPct)"
      variant="subtle"
      size="xs"
    />
    <UBadge
      v-if="flow"
      :label="`${t('trade.intelFlow')} ${flowDirLabel(flow.dir)}${flow.volRatio != null ? ` ${flow.volRatio.toFixed(1)}×` : ''}`"
      :color="flowTone(flow.dir)"
      variant="subtle"
      size="xs"
    />
    <UBadge
      v-if="accum"
      :label="`${t('trade.intelAccum')} ${accumCount}`"
      :color="accumCount > 0 ? 'info' : 'neutral'"
      variant="subtle"
      size="xs"
    />

    <span v-if="!hasAny" class="text-xs text-muted">{{ t('trade.intelNoData') }}</span>
  </div>
</template>