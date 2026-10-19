<script setup lang="ts">
// =============================================================================
//  Watchlist (S6) — the USER's tracked symbols, persisted and ordered.
//
//  Previously this panel just mirrored whatever the plane advertised. It is now
//  a real watchlist: seeded ONCE from the live plane (so a fresh workspace is
//  never empty), then fully editable — each row can be removed and new symbols
//  are added from the symbol picker (emits `add`, the page opens the search).
//  Click a row to switch the active symbol on /trading (no reload).
// =============================================================================
import { formatPrice, formatQty, spreadOf } from '../utils/marketFeed'

const props = defineProps<{
  symbol: string
  /** symbol -> venue ids (live universe), for the per-row provenance chip. */
  venueIndex?: Record<string, string[]>
}>()
const emit = defineEmits<{ select: [symbol: string], add: [] }>()

const { t } = useI18n()
const feed = useMarketStream()
const { prefs, seedWatchlist, removeFromWatchlist } = useTerminalPrefs()

// Seed once (no-op afterwards, so user removals stick).
watch(() => feed.state.hello?.symbols, (list) => {
  if (list?.length) seedWatchlist(list)
}, { immediate: true })

const symbols = computed(() => prefs.value.watchlist)

interface WatchRow {
  symbol: string
  last: number | null
  side: 'buy' | 'sell' | null
  bid: number | null
  ask: number | null
  spread: number | null
  qty: number | null
  /** Exchange-computed 24h change % (mockup row context, D1 — never derived). */
  changePct: number | null
  /** Venues listing this symbol (empty when the universe has not landed). */
  venues: string[]
  active: boolean
}

const rows = computed<WatchRow[]>(() =>
  symbols.value.map((sym) => {
    const quote = feed.state.quotes[sym]
    const lastTrade = feed.state.lastTrades[sym]
    const mid = quote?.bid !== undefined && quote?.ask !== undefined
      ? (quote.bid + quote.ask) / 2
      : undefined
    const tick = feed.state.ticker24[sym]
    return {
      symbol: sym,
      last: lastTrade?.price ?? quote?.last ?? mid ?? null,
      side: lastTrade?.side ?? null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      spread: spreadOf(quote),
      qty: lastTrade?.quantity ?? null,
      changePct: typeof tick?.priceChangePercent === 'number' ? tick.priceChangePercent : null,
      venues: props.venueIndex?.[sym] ?? [],
      active: sym === props.symbol
    }
  })
)

const lastClass = (row: WatchRow): string =>
  row.side === 'buy' ? 'text-success' : row.side === 'sell' ? 'text-error' : 'text-default'

const changeClass = (v: number | null): string =>
  v === null ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'

const fmtChangePct = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
</script>

<template>
  <div class="flex flex-col rounded bg-default ring ring-default p-3 gap-2">
    <div class="flex items-center justify-between gap-1">
      <h3 class="text-sm font-semibold shrink-0">{{ t('trade.watchlist') }}</h3>
      <span class="font-mono text-[10px] text-muted flex-1">{{ rows.length }}</span>
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="primary"
        variant="soft"
        :label="t('trade.watchlistAdd')"
        :ui="{ label: 'hidden sm:block' }"
        data-testid="watchlist-add"
        @click="emit('add')"
      />
    </div>

    <div class="grid grid-cols-[1fr_auto] gap-1 px-1 text-[11px] text-muted border-b border-default pb-1">
      <span>{{ t('trade.symbol') }}</span>
      <span class="text-right">{{ t('trade.price') }}</span>
    </div>

    <p v-if="!rows.length" class="py-4 text-center text-xs text-dimmed">{{ t('trade.watchlistEmpty') }}</p>

    <div
      v-for="row in rows"
      :key="row.symbol"
      class="relative group grid grid-cols-[1fr_auto] items-center gap-1 rounded-md"
      :class="row.active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-elevated/60'"
    >
      <button
        type="button"
        class="grid grid-cols-[1fr_auto] items-baseline gap-2 w-full px-2 py-1.5 text-left cursor-pointer"
        :aria-pressed="row.active"
        @click="emit('select', row.symbol)"
      >
        <span class="flex flex-col gap-0.5 min-w-0">
          <span class="text-xs font-medium truncate" :class="row.active ? 'text-primary' : 'text-default'">
            {{ row.symbol }}
          </span>
          <span class="flex items-center gap-1.5 min-w-0 font-mono text-[10px] text-muted">
            <VenueChip :venues="row.venues" dense />
            <span class="truncate">
              <template v-if="row.spread !== null">{{ t('trade.spread') }} {{ formatPrice(row.spread) }}</template>
              <template v-else>—</template>
            </span>
          </span>
        </span>
        <span class="flex flex-col items-end gap-0.5">
          <span class="flex items-baseline gap-1 font-mono text-xs" :class="lastClass(row)">
            {{ row.last !== null ? formatPrice(row.last) : '—' }}
            <span v-if="row.changePct !== null" :class="changeClass(row.changePct)">{{ fmtChangePct(row.changePct) }}</span>
          </span>
          <span class="font-mono text-[10px] text-muted">
            {{ row.qty !== null ? formatQty(row.qty) : '—' }}
          </span>
        </span>
      </button>
      <!-- Removal is an overlay so the narrow rail keeps its width for the
           symbol + price columns (touch: always visible, desktop: on hover). -->
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="ghost"
        class="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity max-lg:opacity-100 bg-default/90"
        :aria-label="t('trade.watchlistRemove')"
        :data-testid="`watchlist-remove-${row.symbol}`"
        @click="removeFromWatchlist(row.symbol)"
      />
    </div>
  </div>
</template>
