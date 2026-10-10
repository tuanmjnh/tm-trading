<script setup lang="ts">
// =============================================================================
//  OrderBook (S6) — depth ladder for the selected symbol.
//
//  Seed: S4 REST /api/v1/markets/:sym/orderbook (works before the WS book
//  syncs). Live: materialized `market.book` frames from the plane (the plane
//  owns Binance snapshot/diff sequencing — clients never see raw diffs).
// =============================================================================
import { formatPrice, formatQty, type BookLevel } from '../utils/marketFeed'

const props = defineProps<{ symbol: string }>()

const { t } = useI18n()
const feed = useMarketStream()

const seed = ref<{ bids: BookLevel[]; asks: BookLevel[] } | null>(null)
const seedError = ref<string | null>(null)
const loading = ref(true)

const errorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { data?: { message?: string }; message?: string }
    return e.data?.message || e.message || 'request-failed'
  }
  return String(err)
}

async function loadSeed(): Promise<void> {
  loading.value = true
  seedError.value = null
  try {
    const res = await $fetch<{
      success: boolean
      data?: { bids?: Array<{ price: number; qty: number }>; asks?: Array<{ price: number; qty: number }> }
    }>(`/api/v1/markets/${encodeURIComponent(props.symbol)}/orderbook`, { params: { limit: 50 } })
    seed.value = {
      bids: (res.data?.bids ?? []).map((l) => [l.price, l.qty]),
      asks: (res.data?.asks ?? []).map((l) => [l.price, l.qty])
    }
  } catch (err) {
    seedError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

watch(() => props.symbol, () => { void loadSeed() }, { immediate: true })

const liveBook = computed(() => feed.state.books[props.symbol])
const bids = computed(() => liveBook.value?.bids ?? seed.value?.bids ?? [])
const asks = computed(() => liveBook.value?.asks ?? seed.value?.asks ?? [])
const isLive = computed(() => !!liveBook.value)
const ready = computed(() => bids.value.length > 0 || asks.value.length > 0)

/** Display rows: best ask adjacent to the spread (bottom of the ask block). */
const askRows = computed(() => asks.value.slice(0, 14).reverse())
const bidRows = computed(() => bids.value.slice(0, 14))

const bestBid = computed(() => bids.value[0])
const bestAsk = computed(() => asks.value[0])
const spread = computed(() =>
  bestBid.value && bestAsk.value ? bestAsk.value[0] - bestBid.value[0] : null
)

const maxQty = computed(() => {
  let max = 0
  for (const lvl of [...askRows.value, ...bidRows.value]) if (lvl[1] > max) max = lvl[1]
  return max > 0 ? max : 1
})

const barWidth = (lvl: BookLevel): string => `${Math.min(100, (lvl[1] / maxQty.value) * 100)}%`

const clock = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleTimeString('en-GB', { hour12: false }) : '—'
</script>

<template>
  <div class="flex flex-col gap-1 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.orderbook') }}</h3>
      <div class="flex items-center gap-1.5">
        <UBadge :color="isLive ? 'success' : 'neutral'" variant="subtle" size="sm">
          {{ isLive ? t('trade.liveData') : t('trade.restData') }}
        </UBadge>
        <span class="font-mono text-[10px] text-muted">{{ clock(liveBook?.eventTime ?? 0) }}</span>
      </div>
    </div>

    <div class="grid grid-cols-2 px-1 pb-1 text-[11px] text-muted border-b border-default">
      <span>{{ t('trade.price') }}</span>
      <span class="text-right">{{ t('trade.qty') }}</span>
    </div>

    <div v-if="loading && !ready" class="grid place-items-center gap-2 py-8">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
      <p class="text-xs text-muted">{{ t('trade.bookLoading') }}</p>
    </div>

    <div v-else-if="seedError && !ready" class="grid place-items-center gap-2 py-8 text-center">
      <UIcon name="i-lucide-triangle-alert" class="size-5 text-error" />
      <p class="max-w-[16rem] font-mono text-[11px] break-all text-error/80">{{ seedError }}</p>
      <UButton size="xs" color="primary" variant="soft" @click="loadSeed">{{ t('trade.retry') }}</UButton>
    </div>

    <template v-else>
      <!-- asks: highest at top, best ask next to the spread -->
      <div class="flex flex-col">
        <div
          v-for="lvl in askRows"
          :key="`a-${lvl[0]}`"
          class="relative grid grid-cols-2 rounded-[2px] px-1 py-[1px]"
        >
          <span
            class="absolute inset-y-0 right-0 bg-error/10"
            :style="{ width: barWidth(lvl) }"
            aria-hidden="true"
          />
          <span class="relative font-mono text-[11px] text-error">{{ formatPrice(lvl[0]) }}</span>
          <span class="relative text-right font-mono text-[11px] text-default/80">{{ formatQty(lvl[1]) }}</span>
        </div>
      </div>

      <!-- spread row -->
      <div class="flex items-center justify-between rounded-sm bg-elevated/50 px-1.5 py-1 my-0.5">
        <span class="font-mono text-[11px] font-semibold">
          {{ bestAsk ? formatPrice(bestAsk[0]) : '—' }}
        </span>
        <span class="text-[10px] text-muted">
          {{ t('trade.spread') }} {{ spread !== null ? formatPrice(spread) : '—' }}
        </span>
        <span class="font-mono text-[11px] font-semibold">
          {{ bestBid ? formatPrice(bestBid[0]) : '—' }}
        </span>
      </div>

      <!-- bids -->
      <div class="flex flex-col">
        <div
          v-for="lvl in bidRows"
          :key="`b-${lvl[0]}`"
          class="relative grid grid-cols-2 rounded-[2px] px-1 py-[1px]"
        >
          <span
            class="absolute inset-y-0 right-0 bg-success/10"
            :style="{ width: barWidth(lvl) }"
            aria-hidden="true"
          />
          <span class="relative font-mono text-[11px] text-success">{{ formatPrice(lvl[0]) }}</span>
          <span class="relative text-right font-mono text-[11px] text-default/80">{{ formatQty(lvl[1]) }}</span>
        </div>
      </div>

      <p v-if="!ready" class="py-6 text-center text-xs text-muted">{{ t('trade.bookEmpty') }}</p>
    </template>
  </div>
</template>
