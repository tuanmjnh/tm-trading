<script setup lang="ts">
// Watchlist panel (V5.0 §3.3) — observe only. No order control exists here.
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { watchRows, watchlist, intelFreshness, loading, loadWatchlist } = useDashboardFeed()
const overlay = useAppOverlay()
const watchApi = useWatchlists()
const notify = useNotify()

const addOpen = ref(false)
const busy = ref(false)

const pct = (v: number | null, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '—'

const tone = (v: number | null) => (v == null ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')

async function addSymbol(symbol: string) {
  // First symbol of a brand-new account: the server owns default-list creation.
  const list = watchlist.value
  if (!list) await watchApi.seedDefault([symbol])
  else await watchApi.addSymbol(list._id, symbol)
  await loadWatchlist()
  notify.success(t('dash.watchlist.added'), symbol)
}

async function removeSymbol(symbol: string) {
  const list = watchlist.value
  if (!list || busy.value) return
  busy.value = true
  try {
    await watchApi.removeSymbol(list._id, symbol)
    await loadWatchlist()
    notify.info(t('dash.watchlist.removed'), symbol)
  } catch {
    notify.error(t('common.loadErrorTitle'), symbol)
  } finally {
    busy.value = false
  }
}

const symbols = computed(() => watchlist.value?.symbols ?? [])
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-star" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.watchlist.title') }}</h2>
        <UBadge color="neutral" variant="subtle" size="xs" :label="String(watchRows.length)" />
        <UBadge
          :color="intelFreshness === 'fresh' ? 'success' : intelFreshness === 'stale' ? 'warning' : 'neutral'"
          variant="subtle"
          size="xs"
          :label="t(`dash.freshness.${intelFreshness}`)"
        />
        <UButton
          class="ms-auto"
          icon="i-lucide-plus"
          :label="t('dash.watchlist.add')"
          color="primary"
          variant="soft"
          size="xs"
          @click="addOpen = true"
        />
      </div>
    </template>

    <AdminEmptyState
      v-if="!watchRows.length && !loading.watchlist"
      :title="t('dash.watchlist.empty')"
      :description="t('dash.watchlist.emptyHint')"
      icon="i-lucide-star"
      :actions="[{ label: t('dash.watchlist.add'), icon: 'i-lucide-plus', color: 'primary', variant: 'soft', onClick: () => { addOpen = true } }]"
    />

    <ul v-else class="divide-y divide-default/60">
      <li v-for="row in watchRows" :key="row.symbol" class="flex items-center gap-2 py-1.5 min-w-0">
        <button
          type="button"
          class="flex flex-1 items-center gap-2 min-w-0 text-left rounded px-1 hover:bg-elevated/40"
          :aria-label="`${t('dash.watchlist.detail')}: ${row.symbol}`"
          @click="overlay.open('asset', { symbol: row.symbol })"
        >
          <span class="font-mono text-xs font-semibold text-highlighted w-24 shrink-0 truncate">{{ row.symbol }}</span>
          <span class="font-mono text-xs text-toned w-20 shrink-0 text-right">{{ row.price ?? '—' }}</span>
          <span class="font-mono text-xs w-16 shrink-0 text-right" :class="tone(row.change24h)">
            {{ pct(row.change24h) }}
          </span>
          <span class="hidden sm:block flex-1 min-w-0 text-[11px] text-muted truncate">
            <template v-if="row.latest">
              {{ t(`dash.signal.filter.${row.latest.category}`) }} · {{ row.latest.context }}
            </template>
            <template v-else>{{ t('dash.watchlist.none') }}</template>
          </span>
          <span v-if="row.latest" class="hidden lg:block text-[10px] text-dimmed shrink-0">
            {{ formatTimeAgo(new Date(row.latest.detectedAt)) }}
          </span>
        </button>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`${t('dash.watchlist.remove')}: ${row.symbol}`"
          :disabled="busy"
          @click="removeSymbol(row.symbol)"
        />
      </li>
    </ul>

    <LazyDashboardAddAssetModal v-model:open="addOpen" :symbols="symbols" @submit="addSymbol" />
  </UCard>
</template>
