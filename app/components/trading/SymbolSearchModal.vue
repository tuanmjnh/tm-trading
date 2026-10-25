<script setup lang="ts">
// =============================================================================
//  Symbol search modal (TradingView-style), three tiers:
//
//   1. no query + no history  -> "Suggested" (static baseline ∩ served rows)
//   2. no query + history     -> "Recent" (persisted picks) + "Suggested"
//   3. query                  -> ranked key search, debounced, 20 rows per
//                                page, infinite scroll (capped), never an
//                                unbounded render.
//
//  Ranking is explicit and stable: exact symbol > symbol prefix > exact base >
//  base prefix > symbol contains > base contains > quote contains, tie-broken
//  alphabetically. Recent picks and the suggested list both come from
//  useTerminalPrefs (persisted), and both are resolved against the caller's
//  rows — the modal never invents a row the page could not select.
//
//  Emits select(symbol) — the caller assigns (same reset-watch guarantees).
// =============================================================================

export interface SymbolRow {
  key: string
  symbol: string
  base: string
  quote: string
  type: string
  markets: string[]
  /** False for rows the feed cannot serve (index snapshots, wrong market). */
  selectable: boolean
  hint?: string
  /** Index rows only: current snapshot value (never history). */
  value?: number | null
  unit?: string | null
  /** Provenance venue/source id from the universe (e.g. `bybit`, `binance-spot`). */
  source?: string | null
  /** Every venue listing this row (universe union) — first is the badge venue. */
  venues?: string[]
}

import { useTerminalPrefs, MAX_WATCHLIST } from '~/composables/useTerminalPrefs'

const props = defineProps<{
  open: boolean
  rows: SymbolRow[]
  /** Symbol currently being subscribed (runtime feed join in flight). */
  pendingSymbol?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [symbol: string]
}>()

const { t } = useI18n()
const { prefs, bumpRecent, addToWatchlist, inWatchlist } = useTerminalPrefs()

const PAGE_SIZE = 20
const MAX_ROWS = 200
const DEBOUNCE_MS = 150
const MAX_SUGGESTED_SHOWN = 8

const query = ref('')
/** Normalized query actually driving the result list (debounced). */
const appliedQuery = ref('')
const source = ref<'all' | 'spot' | 'futures'>('all')
const activeIndex = ref(0)
const visible = ref(PAGE_SIZE)
const listRef = ref<HTMLElement | null>(null)

/** TradingView-style input normalization: `btcusdt.p`, `BTC/USDT` all match. */
const normalizeQuery = (raw: string): string =>
  raw.trim().toUpperCase().replace(/\.P$/, '').replace(/[\s/]/g, '')

const displaySymbol = (r: SymbolRow): string =>
  r.type === 'perp' ? `${r.symbol}.P` : r.symbol

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(query, (raw) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const q = normalizeQuery(raw)
  if (!q) {
    appliedQuery.value = ''
    visible.value = PAGE_SIZE
    return
  }
  debounceTimer = setTimeout(() => {
    appliedQuery.value = q
    visible.value = PAGE_SIZE
    activeIndex.value = 0
  }, DEBOUNCE_MS)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

const sourceOk = (r: SymbolRow): boolean =>
  source.value === 'all' || (r.markets ?? []).includes(source.value)

/** Explicit relevance score — -1 means "no match". */
const scoreOf = (r: SymbolRow, q: string): number => {
  const sym = r.symbol.toUpperCase()
  const base = (r.base || '').toUpperCase()
  const quote = (r.quote || '').toUpperCase()
  if (sym === q) return 0
  if (sym.startsWith(q)) return 1
  if (base && base === q) return 2
  if (base && base.startsWith(q)) return 3
  if (sym.includes(q)) return 4
  if (base && base.includes(q)) return 5
  if (quote.includes(q)) return 6
  return -1
}

/** Ranked matches for the applied query (capped — never renders unbounded). */
const matches = computed<SymbolRow[]>(() => {
  const q = appliedQuery.value
  if (!q) return []
  const scored: { row: SymbolRow, score: number }[] = []
  for (const r of props.rows) {
    if (!sourceOk(r)) continue
    const score = scoreOf(r, q)
    if (score < 0) continue
    scored.push({ row: r, score })
  }
  scored.sort((a, b) => a.score - b.score || a.row.symbol.localeCompare(b.row.symbol))
  return scored.slice(0, MAX_ROWS).map((s) => s.row)
})

const rowMap = computed<Map<string, SymbolRow>>(() => {
  const map = new Map<string, SymbolRow>()
  for (const r of props.rows) if (!map.has(r.symbol)) map.set(r.symbol, r)
  return map
})

const resolve = (list: readonly string[]): SymbolRow[] =>
  list.map((s) => rowMap.value.get(s)).filter((r): r is SymbolRow => !!r && sourceOk(r))

const recentRows = computed<SymbolRow[]>(() => resolve(prefs.value.recent).slice(0, MAX_SUGGESTED_SHOWN))

const suggestedRows = computed<SymbolRow[]>(() => {
  const taken = new Set(recentRows.value.map((r) => r.symbol))
  return resolve(prefs.value.suggested.filter((s) => !taken.has(s))).slice(0, MAX_SUGGESTED_SHOWN)
})

interface SymbolGroup { key: string, label: string | null, rows: SymbolRow[] }

const groups = computed<SymbolGroup[]>(() => {
  if (appliedQuery.value) {
    return [{ key: 'results', label: null, rows: matches.value.slice(0, visible.value) }]
  }
  const out: SymbolGroup[] = []
  if (recentRows.value.length) out.push({ key: 'recent', label: t('trade.pickerRecent'), rows: recentRows.value })
  if (suggestedRows.value.length) out.push({ key: 'suggested', label: t('trade.pickerSuggested'), rows: suggestedRows.value })
  if (!out.length) {
    // Nothing remembered yet (or the source filter emptied both lists): show the
    // first page of the catalog so the modal is never a dead end.
    const all = props.rows.filter(sourceOk)
    out.push({ key: 'all', label: null, rows: all.slice(0, visible.value) })
  }
  return out
})

const flatRows = computed<SymbolRow[]>(() => {
  const seen = new Set<string>()
  const out: SymbolRow[] = []
  for (const g of groups.value) {
    for (const r of g.rows) {
      if (seen.has(r.key)) continue
      seen.add(r.key)
      out.push(r)
    }
  }
  return out
})

/** Keyboard navigates selectable rows only (disabled rows are display-only). */
const selectables = computed<SymbolRow[]>(() => flatRows.value.filter((r) => r.selectable))

const selIndex = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  selectables.value.forEach((r, i) => map.set(r.key, i))
  return map
})

const resultTotal = computed(() => Math.min(matches.value.length, MAX_ROWS))
const moreAvailable = computed(() =>
  !!appliedQuery.value && visible.value < resultTotal.value
)

const loadMore = (): void => {
  if (!moreAvailable.value) return
  visible.value = Math.min(visible.value + PAGE_SIZE, resultTotal.value)
}

const onScroll = (e: Event): void => {
  if (!moreAvailable.value) return
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) loadMore()
}

watch([source, () => props.open], () => {
  activeIndex.value = 0
  visible.value = PAGE_SIZE
})

watch(() => props.open, (open) => {
  if (open) {
    query.value = ''
    appliedQuery.value = ''
    source.value = 'all'
    activeIndex.value = 0
    visible.value = PAGE_SIZE
  }
})

const pick = (symbol: string): void => {
  if (props.pendingSymbol) return
  bumpRecent(symbol)
  emit('select', symbol)
}

/** Watchlist mutation straight from a result row (never selects the row). */
const watchlistFull = computed(() => prefs.value.watchlist.length >= MAX_WATCHLIST)

const pinned = (symbol: string): boolean => inWatchlist(symbol)

const watchHint = (symbol: string): string => {
  if (pinned(symbol)) return t('trade.pickerInWatchlist')
  if (watchlistFull.value) return t('trade.pickerWatchlistFull', { max: MAX_WATCHLIST })
  return t('trade.pickerAddWatchlist')
}

const addWatch = (symbol: string): void => {
  if (pinned(symbol) || watchlistFull.value) return
  addToWatchlist(symbol)
}

const fmtIndexValue = (r: SymbolRow): string => {
  const v = r.value
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (r.unit === '%') return `${v.toFixed(2)}%`
  const abs = Math.abs(v)
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  return `$${v.toFixed(2)}`
}

const onKeydown = (e: KeyboardEvent): void => {
  const list = selectables.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (list.length) activeIndex.value = (activeIndex.value + 1) % list.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (list.length) {
      activeIndex.value = (activeIndex.value - 1 + list.length) % list.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const row = list[activeIndex.value]
    if (row) pick(row.symbol)
  }
}

watch(activeIndex, () => {
  nextTick(() => {
    listRef.value?.querySelector<HTMLElement>(`[data-idx="${activeIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
})
</script>

<template>
  <BaseResponsiveModal
    :open="open"
    :title="t('trade.symbolSearch')"
    icon="i-lucide-search"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col sm:flex-row gap-2">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            size="md"
            autofocus
            :placeholder="t('trade.pickerSearch')"
            class="flex-1"
            data-testid="symbol-search"
            @keydown="onKeydown"
          />
          <div class="flex items-center gap-1 shrink-0" role="group" :aria-label="t('trade.pickerSource')">
            <UButton
              v-for="src in (['all', 'spot', 'futures'] as const)"
              :key="src"
              size="xs"
              :color="source === src ? 'primary' : 'neutral'"
              :variant="source === src ? 'soft' : 'ghost'"
              @click="source = src"
            >
              {{ src === 'all' ? t('trade.pickerAll') : src === 'spot' ? t('trade.pickerSpot') : t('trade.pickerFutures') }}
            </UButton>
          </div>
        </div>

        <div v-if="flatRows.length" ref="listRef" class="flex flex-col gap-0.5 max-h-72 overflow-y-auto" role="listbox" aria-label="Symbols" data-testid="symbol-list" @scroll="onScroll">
          <template v-for="group in groups" :key="group.key">
            <p v-if="group.label" class="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-dimmed">{{ group.label }}</p>
            <template v-for="r in group.rows" :key="r.key">
              <div
                v-if="r.selectable"
                role="option"
                :data-idx="selIndex.get(r.key)"
                :aria-selected="selIndex.get(r.key) === activeIndex"
                class="flex items-center gap-1 rounded"
                :class="selIndex.get(r.key) === activeIndex ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-elevated/60'"
                @mousemove="activeIndex = selIndex.get(r.key) ?? 0"
              >
                <button
                  type="button"
                  class="flex items-center gap-2 flex-1 min-w-0 rounded px-2 py-1.5 text-left cursor-pointer"
                  :data-testid="`pick-${r.symbol}`"
                  @click="pick(r.symbol)"
                >
                  <CommonSymbolIcon :symbol="r.symbol" class="shrink-0" />
                  <span class="font-mono text-xs font-semibold text-highlighted">{{ displaySymbol(r) }}</span>
                  <span v-if="r.base" class="text-[10px] text-dimmed">{{ r.base }}/{{ r.quote }}</span>
                  <TradingVenueChip :venues="r.venues" :source="r.source" />
                  <UIcon v-if="pendingSymbol === r.symbol" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-primary shrink-0 ml-auto" />
                  <UBadge v-else :label="r.type.toUpperCase()" color="neutral" variant="subtle" size="xs" class="ml-auto shrink-0" />
                </button>
                <UButton
                  :icon="pinned(r.symbol) ? 'i-lucide-star' : 'i-lucide-star-plus'"
                  size="xs"
                  :color="pinned(r.symbol) ? 'primary' : 'neutral'"
                  :variant="pinned(r.symbol) ? 'soft' : 'ghost'"
                  :disabled="pinned(r.symbol) || watchlistFull"
                  :aria-label="watchHint(r.symbol)"
                  :title="watchHint(r.symbol)"
                  class="shrink-0 mr-1"
                  :data-testid="`watch-${r.symbol}`"
                  @click="addWatch(r.symbol)"
                />
              </div>
              <div
                v-else
                class="flex items-center gap-2 rounded px-2 py-1.5 opacity-60"
                :title="r.hint || ''"
              >
                <span class="font-mono text-xs font-semibold text-muted">{{ displaySymbol(r) }}</span>
                <span v-if="r.base" class="text-[10px] text-dimmed">{{ r.base }}/{{ r.quote }}</span>
                <TradingVenueChip :venues="r.venues" :source="r.source" />
                <span v-if="r.value !== null && r.value !== undefined" class="text-[11px] font-mono text-highlighted">{{ fmtIndexValue(r) }}</span>
                <UBadge :label="r.type.toUpperCase()" color="neutral" variant="outline" size="xs" class="ml-auto shrink-0" />
              </div>
            </template>
          </template>

          <div v-if="moreAvailable" class="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-default/60">
            <span class="text-[10px] text-dimmed">{{ t('trade.pickerCount', { shown: visible, total: resultTotal }) }}</span>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :label="t('trade.pickerMore')" @click="loadMore" />
          </div>
          <p v-else-if="appliedQuery" class="px-2 py-1.5 text-[10px] text-dimmed border-t border-default/60">
            {{ t('trade.pickerCount', { shown: flatRows.length, total: resultTotal }) }}
          </p>
        </div>
        <p v-else class="text-[11px] text-dimmed px-1 py-2">{{ t('trade.pickerEmpty') }}</p>
      </div>
    </template>
  </BaseResponsiveModal>
</template>
