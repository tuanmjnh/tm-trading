<script setup lang="ts">
// =============================================================================
//  Watchlist (S6) — every plane symbol with its live quote/ticker.
//  Click a row to switch the active symbol on /trade (no reload).
// =============================================================================
import { formatPrice, formatQty, spreadOf } from '../utils/marketFeed'

const props = defineProps<{ symbol: string }>()
const emit = defineEmits<{ select: [symbol: string] }>()

const { t } = useI18n()
const feed = useMarketStream()

const symbols = computed(() =>
  feed.state.hello?.symbols?.length ? feed.state.hello.symbols : ['BTCUSDT']
)

interface WatchRow {
  symbol: string
  last: number | null
  side: 'buy' | 'sell' | null
  bid: number | null
  ask: number | null
  spread: number | null
  qty: number | null
  active: boolean
}

const rows = computed<WatchRow[]>(() =>
  symbols.value.map((sym) => {
    const quote = feed.state.quotes[sym]
    const lastTrade = feed.state.lastTrades[sym]
    const mid = quote?.bid !== undefined && quote?.ask !== undefined
      ? (quote.bid + quote.ask) / 2
      : undefined
    return {
      symbol: sym,
      last: lastTrade?.price ?? quote?.last ?? mid ?? null,
      side: lastTrade?.side ?? null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      spread: spreadOf(quote),
      qty: lastTrade?.quantity ?? null,
      active: sym === props.symbol
    }
  })
)

const lastClass = (row: WatchRow): string =>
  row.side === 'buy' ? 'text-success' : row.side === 'sell' ? 'text-error' : 'text-default'
</script>

<template>
  <div class="flex flex-col rounded-lg bg-default ring ring-default p-3 gap-2">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.watchlist') }}</h3>
      <span class="font-mono text-[10px] text-muted">{{ rows.length }}</span>
    </div>

    <div class="grid grid-cols-[1fr_auto] gap-1 px-1 text-[11px] text-muted border-b border-default pb-1">
      <span>{{ t('trade.symbol') }}</span>
      <span class="text-right">{{ t('trade.price') }}</span>
    </div>

    <button
      v-for="row in rows"
      :key="row.symbol"
      type="button"
      class="grid grid-cols-[1fr_auto] items-baseline gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer"
      :class="row.active
        ? 'bg-primary/10 ring-1 ring-primary/30'
        : 'hover:bg-elevated/60 focus-visible:bg-elevated/60'"
      :aria-pressed="row.active"
      @click="emit('select', row.symbol)"
    >
      <span class="flex flex-col gap-0.5 min-w-0">
        <span class="text-xs font-medium truncate" :class="row.active ? 'text-primary' : 'text-default'">
          {{ row.symbol }}
        </span>
        <span class="font-mono text-[10px] text-muted">
          <template v-if="row.spread !== null">{{ t('trade.spread') }} {{ formatPrice(row.spread) }}</template>
          <template v-else>—</template>
        </span>
      </span>
      <span class="flex flex-col items-end gap-0.5">
        <span class="font-mono text-xs" :class="lastClass(row)">
          {{ row.last !== null ? formatPrice(row.last) : '—' }}
        </span>
        <span class="font-mono text-[10px] text-muted">
          {{ row.qty !== null ? formatQty(row.qty) : '—' }}
        </span>
      </span>
    </button>
  </div>
</template>
