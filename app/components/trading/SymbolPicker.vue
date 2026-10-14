<script setup lang="ts">
// =============================================================================
//  SymbolPicker (trading) — search the canonical Instrument Catalog and pick a
//  symbol by SOURCE (venue × spot/futures), not a flat ticker list.
//
//  It consumes the §30.1 catalog via useMarketCatalog (fail-soft), groups every
//  instrument by the venue/market sources that serve it, and resolves the pick
//  down to the ENGINE symbol (e.g. 'BTCUSDT') that the live plane + chart feed
//  actually stream. The source filter narrows by venue and by spot vs futures.
//  Presentational + resolution only — the parent owns the `symbol` ref.
// =============================================================================
import type { Instrument, InstrumentVenue, VenueInfo } from '~~/types/instruments'

const props = defineProps<{
  /** Currently active engine symbol (e.g. 'BTCUSDT'). */
  modelValue: string
  /** Disable interaction (e.g. while a replay session owns the desk). */
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [engineSymbol: string] }>()

const { t } = useI18n()
const catalog = useMarketCatalog()

const instruments = ref<Instrument[]>([])
const venueInfo = ref<VenueInfo[]>([])
const loading = ref(true)

const query = ref('')
/** Source filter: '' = all, 'venue:binance', 'market:spot', 'market:futures'. */
const sourceFilter = ref('')

onMounted(async () => {
  loading.value = true
  const [list, venues] = await Promise.all([catalog.instruments(), catalog.venues()])
  instruments.value = list
  venueInfo.value = venues
  loading.value = false
})

// Distinct venues present in the catalog (for the source chips).
const venueChips = computed(() => {
  const set = new Set<string>()
  for (const i of instruments.value) for (const v of i.venues) set.add(v.venue)
  return [...set].sort()
})

/** Venue health (up/down/unknown) from /api/v1/venues, keyed by venue id. */
const venueHealth = computed<Record<string, { hasProvider: boolean; inCatalog: boolean }>>(() => {
  const map: Record<string, { hasProvider: boolean; inCatalog: boolean }> = {}
  for (const v of venueInfo.value) map[v.id] = { hasProvider: v.hasProvider, inCatalog: v.inCatalog }
  return map
})

function setFilter(next: string): void {
  sourceFilter.value = sourceFilter.value === next ? '' : next
}

/** Does an instrument pass the current source filter? */
function matchesSource(inst: Instrument): boolean {
  const f = sourceFilter.value
  if (!f) return true
  if (f.startsWith('market:')) {
    const market = f.slice('market:'.length) as 'spot' | 'futures'
    return inst.venues.some(v => (v.market ?? 'spot') === market)
  }
  if (f.startsWith('venue:')) {
    const venue = f.slice('venue:'.length)
    return inst.venues.some(v => v.venue === venue)
  }
  return true
}

/** Free-text match on symbol / base / quote / id. */
function matchesQuery(inst: Instrument): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return (
    inst.symbol.toLowerCase().includes(q) ||
    inst.base.toLowerCase().includes(q) ||
    inst.quote.toLowerCase().includes(q) ||
    inst.id.toLowerCase().includes(q) ||
    inst.venues.some(v => v.native.toLowerCase().includes(q))
  )
}

interface PickerRow {
  engineSymbol: string
  symbol: string
  type: string
  /** Sources that serve this instrument, e.g. 'binance · futures'. */
  sources: string[]
  active: boolean
}

const rows = computed<PickerRow[]>(() => {
  const out: PickerRow[] = []
  for (const inst of instruments.value) {
    if (inst.status !== 'active') continue
    if (!matchesSource(inst) || !matchesQuery(inst)) continue
    const engineSymbol = inst.engineSymbol ?? inst.venues[0]?.native
    if (!engineSymbol) continue
    out.push({
      engineSymbol,
      symbol: inst.symbol,
      type: inst.type,
      sources: inst.venues.map(sourceLabel),
      active: engineSymbol === props.modelValue
    })
  }
  // De-dup by engineSymbol (spot + perp of the same pair collapse to one feed).
  const seen = new Set<string>()
  return out.filter(r => (seen.has(r.engineSymbol) ? false : (seen.add(r.engineSymbol), true)))
})

function sourceLabel(v: InstrumentVenue): string {
  const market = v.market ?? 'spot'
  return `${v.venue} · ${market}`
}

function pick(engineSymbol: string): void {
  if (props.disabled) return
  emit('update:modelValue', engineSymbol)
}

/** Human source label for a chip value; '' = All. */
const filterLabel = (v: string): string =>
  v.startsWith('venue:') ? v.slice(6)
    : v.startsWith('market:') ? v.slice(7)
      : t('trade.pickerAll')
</script>

<template>
  <div class="flex flex-col gap-2 min-w-0" data-testid="symbol-picker">
    <!-- Search box -->
    <div class="relative">
      <UIcon
        name="i-lucide-search"
        class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-dimmed pointer-events-none"
      />
      <UInput
        v-model="query"
        size="sm"
        class="w-full pl-8"
        :placeholder="t('trade.pickerSearch')"
        :disabled="disabled"
        :aria-label="t('trade.pickerSearch')"
        data-testid="symbol-picker-search"
      />
    </div>

    <!-- Source filter chips: All · venues · spot/futures -->
    <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('trade.pickerSource')">
      <span class="text-[10px] uppercase tracking-wider text-dimmed mr-0.5">{{ t('trade.pickerSource') }}</span>
      <UButton
        size="xs"
        :color="sourceFilter === '' ? 'primary' : 'neutral'"
        :variant="sourceFilter === '' ? 'soft' : 'ghost'"
        :disabled="disabled"
        data-testid="source-all"
        @click="sourceFilter = ''"
      >
        {{ t('trade.pickerAll') }}
      </UButton>
      <UButton
        v-for="v in venueChips"
        :key="`venue:${v}`"
        size="xs"
        :color="sourceFilter === `venue:${v}` ? 'primary' : 'neutral'"
        :variant="sourceFilter === `venue:${v}` ? 'soft' : 'ghost'"
        :disabled="disabled"
        :data-testid="`source-venue-${v}`"
        @click="setFilter(`venue:${v}`)"
      >
        {{ v }}
        <UIcon
          v-if="venueHealth[v]"
          :name="venueHealth[v].hasProvider ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          :class="['size-3', venueHealth[v].hasProvider ? 'text-success' : 'text-error']"
        />
      </UButton>
      <UButton
        size="xs"
        :color="sourceFilter === 'market:spot' ? 'primary' : 'neutral'"
        :variant="sourceFilter === 'market:spot' ? 'soft' : 'ghost'"
        :disabled="disabled"
        data-testid="source-market-spot"
        @click="setFilter('market:spot')"
      >
        {{ t('trade.pickerSpot') }}
      </UButton>
      <UButton
        size="xs"
        :color="sourceFilter === 'market:futures' ? 'primary' : 'neutral'"
        :variant="sourceFilter === 'market:futures' ? 'soft' : 'ghost'"
        :disabled="disabled"
        data-testid="source-market-futures"
        @click="setFilter('market:futures')"
      >
        {{ t('trade.pickerFutures') }}
      </UButton>
    </div>

    <!-- Result rows -->
    <div class="max-h-64 overflow-y-auto rounded ring ring-default divide-y divide-default/60">
      <p v-if="loading" class="px-3 py-2 text-xs text-dimmed">{{ t('trade.loading') }}</p>
      <p v-else-if="!rows.length" class="px-3 py-2 text-xs text-dimmed" data-testid="symbol-picker-empty">
        {{ t('trade.pickerEmpty') }}
      </p>
      <button
        v-for="row in rows"
        :key="row.engineSymbol"
        type="button"
        class="w-full flex flex-col gap-1 px-3 py-1.5 text-left transition-colors hover:bg-elevated/60 disabled:opacity-50"
        :class="row.active ? 'bg-primary/10' : ''"
        :disabled="disabled"
        :data-testid="`symbol-row-${row.engineSymbol}`"
        @click="pick(row.engineSymbol)"
      >
        <span class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="font-mono text-xs font-semibold text-highlighted">{{ row.symbol }}</span>
            <UBadge :label="row.type" color="neutral" variant="subtle" size="xs" />
          </span>
          <UIcon v-if="row.active" name="i-lucide-check" class="size-4 shrink-0 text-primary" />
        </span>
        <span class="flex flex-wrap items-center gap-1">
          <UBadge
            v-for="s in row.sources"
            :key="s"
            :label="s"
            color="info"
            variant="subtle"
            size="xs"
            class="font-mono"
          />
        </span>
      </button>
    </div>
  </div>
</template>
