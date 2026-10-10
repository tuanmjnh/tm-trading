<script setup lang="ts">
import type { MethodEvent, MethodLeague, MethodMeta } from '~~/types/methods'
import { fmtSigned } from '../utils/terminal'

// =============================================================================
//  MethodEventsPanel — Phase 10 UI ("method event inspector").
//
//  READ-ONLY presentation: toggles method overlays, lists the latest detected
//  events with method/version/reasons/score/bar snapshot (the acceptance shape
//  of roadmap Phase 10), plus a pooled method-league summary. All data comes
//  from the read-only API — nothing is recomputed here (D1).
// =============================================================================

const { t } = useI18n()

const props = defineProps<{
  symbol: string
  methods: MethodMeta[]
  enabled: string[]
  events: MethodEvent[]
  loading: boolean
  error: string
  league: MethodLeague | null
  /** event highlighted by the chart-marker click (from TradeChart emit). */
  selected: MethodEvent | null
}>()

const emit = defineEmits<{
  toggle: [id: string]
  clear: []
}>()

const METHOD_COLOR: Record<string, string> = {
  'price-action': '#a78bfa',
  trend: '#f59e0b',
  orderflow: '#06b6d4',
  vsa: '#ec4899',
  sweep: '#84cc16'
}

const methodColor = (id: string): string => METHOD_COLOR[id] ?? '#94a3b8'
const signedTone = (v: number): string => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')
const wrTone = (v: number): string => (v >= 0.55 ? 'text-success' : 'text-muted')
const methodLabel = (id: string): string =>
  t(`trade.methodNames.${id}`).startsWith('trade.methodNames')
    ? id
    : t(`trade.methodNames.${id}`)

const listedEvents = computed<MethodEvent[]>(() =>
  [...props.events].sort((a, b) => b.time - a.time).slice(0, 6)
)

const isSelected = (ev: MethodEvent): boolean =>
  props.selected?.time === ev.time && props.selected?.method === ev.method

const evTime = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString('en-GB', { hour12: false })

const leagueRows = computed(() => props.league?.methods ?? [])
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('trade.methodEvents') }}</h3>
      <span class="text-xs text-muted">{{ symbol ? symbol : '' }}</span>
    </div>

    <p class="text-xs text-muted">{{ t('trade.methodEventsHint') }}</p>

    <!-- Method toggles (one per registered plugin) -->
    <div v-if="methods.length" class="flex flex-wrap items-center gap-2" role="group" :aria-label="t('trade.methods')">
      <UButton
        v-for="m in methods"
        :key="m.id"
        size="xs"
        :color="enabled.includes(m.id) ? 'primary' : 'neutral'"
        :variant="enabled.includes(m.id) ? 'soft' : 'ghost'"
        :aria-pressed="enabled.includes(m.id)"
        :title="`${m.name} · v${(m.version || '').slice(0, 8)}`"
        @click="emit('toggle', m.id)"
      >
        {{ methodLabel(m.id) }}
      </UButton>
      <UButton v-if="enabled.length" size="xs" variant="ghost" color="neutral" @click="emit('clear')">
        <UIcon name="i-lucide-x" class="size-3.5" />
      </UButton>
    </div>
    <p v-else class="text-xs text-muted">{{ t('trade.methodsEmpty') }}</p>

    <!-- Event inspector -->
    <div class="flex flex-col gap-2">
      <span class="text-xs font-medium tracking-wide text-muted uppercase">{{ t('trade.inspector') }}</span>

      <div v-if="loading" class="flex items-center gap-2 text-xs text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
        {{ t('trade.loadData') }}
      </div>
      <p v-else-if="error" class="text-xs text-error/80">{{ t('trade.methodEventsError') }}</p>

      <div v-else-if="listedEvents.length" class="flex flex-col gap-1.5">
        <div
          v-for="ev in listedEvents"
          :key="`${ev.method}:${ev.time}`"
          class="rounded-md ring-1 p-2 text-xs"
          :class="isSelected(ev) ? 'ring-primary/60 bg-primary/10' : 'ring-default'"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-mono" :style="{ color: methodColor(ev.method) }">{{ methodLabel(ev.method) }}</span>
            <span class="font-semibold">{{ ev.type }}</span>
            <span class="font-mono" :class="ev.score > 0 ? 'text-success' : ev.score < 0 ? 'text-error' : 'text-muted'">
              {{ fmtSigned(ev.score, 2) }}
            </span>
            <span class="ml-auto font-mono text-muted">{{ evTime(ev.time) }}</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span>v{{ (ev.version || '').slice(0, 8) }}</span>
            <span class="font-mono">{{ ev.snapshot.open }} / {{ ev.snapshot.high }} / {{ ev.snapshot.low }} / {{ ev.snapshot.close }}</span>
            <span v-if="ev.reasons.length" class="font-mono">{{ ev.reasons.join(', ') }}</span>
          </div>
        </div>
        <p v-if="props.events.length > listedEvents.length" class="text-[11px] text-muted">
          +{{ props.events.length - listedEvents.length }} {{ t('trade.moreEvents') }}
        </p>
      </div>
      <p v-else class="text-xs text-muted">{{ t('trade.inspectorEmpty') }}</p>
    </div>

    <!-- Pooled league summary (Phase 10 acceptance: comparison table) -->
    <details v-if="leagueRows.length" class="group text-xs">
      <summary class="cursor-pointer select-none text-xs font-medium tracking-wide text-muted uppercase">
        {{ t('trade.league') }}
      </summary>
      <p class="mt-1 text-[11px] text-muted">{{ t('trade.leagueHint') }}</p>
      <div class="mt-1 overflow-x-auto rounded-md ring-1 ring-default">
        <table class="w-full text-left text-[11px]">
          <thead>
            <tr class="border-b border-default text-muted">
              <th class="px-2 py-1 font-medium">{{ t('trade.colMethod') }}</th>
              <th class="px-2 py-1 font-medium">{{ t('trade.colTrades') }}</th>
              <th class="px-2 py-1 font-medium">{{ t('trade.colWR') }}</th>
              <th class="px-2 py-1 font-medium">{{ t('trade.colPF') }}</th>
              <th class="px-2 py-1 font-medium">{{ t('trade.colNet') }}</th>
              <th class="px-2 py-1 font-medium">{{ t('trade.colEr') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in leagueRows" :key="row.id" class="border-b border-default/60 last:border-0">
              <td class="px-2 py-1 font-mono" :style="{ color: methodColor(row.id) }">{{ methodLabel(row.id) }}</td>
              <td class="px-2 py-1">{{ row.trades }}</td>
              <td class="px-2 py-1 font-mono" :class="wrTone(row.winRate)">{{ (row.winRate * 100).toFixed(1) }}</td>
              <td class="px-2 py-1 font-mono" :class="signedTone(row.profitFactor - 1)">{{ row.profitFactor === Infinity ? 'inf' : row.profitFactor.toFixed(2) }}</td>
              <td class="px-2 py-1 font-mono" :class="signedTone(row.netPct)">{{ row.netPct.toFixed(1) }}</td>
              <td class="px-2 py-1 font-mono" :class="signedTone(row.expectancy)">{{ row.expectancy.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>