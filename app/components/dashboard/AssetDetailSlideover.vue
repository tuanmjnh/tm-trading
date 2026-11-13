<script setup lang="ts">
// Asset detail (V5.0 §4 deep link `/?panel=asset&symbol=BTCUSDT`).
// Read-only: quote context from the intel snapshot + the asset's latest events.
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const overlay = useAppOverlay()
const { intel, events, intelFreshness, watchSymbols, watchlist, loadWatchlist } = useDashboardFeed()
const watchApi = useWatchlists()
const notify = useNotify()

const open = computed({
  get: () => overlay.kind.value === 'asset',
  set: (value: boolean) => { if (!value) overlay.requestClose() }
})

const symbol = computed(() => (overlay.state.value?.kind === 'asset' ? overlay.state.value.payload.symbol : ''))

const quote = computed(() => intel.value?.movers?.find(m => m.symbol.toUpperCase() === symbol.value.toUpperCase()) ?? null)
const related = computed(() => events.value.filter(e => e.symbol.toUpperCase() === symbol.value.toUpperCase()).slice(0, 10))
const inWatchlist = computed(() => watchSymbols.value.has(symbol.value.toUpperCase()))

const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '—'

async function toggleWatch() {
  const list = watchlist.value
  try {
    if (!list) await watchApi.seedDefault([symbol.value])
    else if (inWatchlist.value) await watchApi.removeSymbol(list._id, symbol.value)
    else await watchApi.addSymbol(list._id, symbol.value)
    await loadWatchlist()
  } catch {
    notify.error(t('common.loadErrorTitle'), symbol.value)
  }
}
</script>

<template>
  <LazyBaseResponsiveSlideover v-model:open="open" :title="symbol || t('dash.watchlist.detail')" icon="i-lucide-line-chart">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          :color="intelFreshness === 'fresh' ? 'success' : intelFreshness === 'stale' ? 'warning' : 'neutral'"
          variant="subtle"
          size="xs"
          :label="t(`dash.freshness.${intelFreshness}`)"
        />
        <span class="text-[11px] text-muted font-mono">
          {{ t('dash.asOf') }} {{ intel?.generatedAt?.slice(0, 16).replace('T', ' ') ?? '—' }} UTC
        </span>
        <UButton
          class="ms-auto"
          :icon="inWatchlist ? 'i-lucide-star-off' : 'i-lucide-star'"
          :label="inWatchlist ? t('dash.watchlist.remove') : t('dash.watchlist.add')"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="toggleWatch"
        />
      </div>

      <dl class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.watchlist.price') }}</dt>
          <dd class="text-sm font-mono font-semibold text-highlighted">{{ quote?.lastPrice ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.watchlist.change24h') }}</dt>
          <dd class="text-sm font-mono font-semibold" :class="(quote?.pct24h ?? 0) >= 0 ? 'text-success' : 'text-error'">
            {{ pct(quote?.pct24h) }}
          </dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.watchlist.change4h') }}</dt>
          <dd class="text-sm font-mono font-semibold" :class="(quote?.chg4h ?? 0) >= 0 ? 'text-success' : 'text-error'">
            {{ pct(quote?.chg4h) }}
          </dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('intel.colVolume') }}</dt>
          <dd class="text-sm font-mono text-highlighted">
            {{ quote ? `$${(quote.quoteVolume / 1e6).toFixed(1)}M` : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">ATR</dt>
          <dd class="text-sm font-mono text-highlighted">{{ quote ? `${quote.atrPct.toFixed(1)}%` : '—' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.filter.watchlist') }}</dt>
          <dd class="text-sm text-highlighted">{{ inWatchlist ? t('common.active') : '—' }}</dd>
        </div>
      </dl>

      <UAlert
        v-if="!quote"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('dash.asset.noQuote')"
        :description="t('dash.asset.noQuoteHint')"
      />

      <div>
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{{ t('dash.asset.events') }}</h3>
        <AdminEmptyState v-if="!related.length" :title="t('dash.asset.noEvents')" :description="t('dash.signal.emptyHint')" icon="i-lucide-radio" />
        <ul v-else class="divide-y divide-default/60">
          <li v-for="item in related" :key="item.key" class="py-1.5 min-w-0">
            <button
              type="button"
              class="w-full text-left rounded px-1 py-0.5 hover:bg-elevated/40"
              @click="overlay.open('signal', { id: item.key })"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UBadge color="neutral" variant="subtle" size="xs" :label="t(`dash.signal.filter.${item.category}`)" />
                <span class="text-xs text-highlighted truncate flex-1">{{ item.context }}</span>
                <span class="text-[10px] text-dimmed shrink-0">{{ formatTimeAgo(new Date(item.detectedAt)) }}</span>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </LazyBaseResponsiveSlideover>
</template>
