<script setup lang="ts">
// Global symbol search (V5.0 §3: the header owns ONE search box).
// It opens the asset detail slideover — it does not create a second page or a
// second symbol list: suggestions come from the same snapshot/watchlist the
// Dashboard already reads.
const { t } = useI18n()
const { intel, watchlist } = useDashboardFeed()
const overlay = useAppOverlay()

const query = ref('')

const suggestions = computed(() => {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (symbol: string) => {
    const upper = symbol.toUpperCase()
    if (!upper || seen.has(upper)) return
    seen.add(upper)
    out.push(upper)
  }
  for (const symbol of watchlist.value?.symbols ?? []) push(symbol)
  for (const mover of intel.value?.movers ?? []) push(mover.symbol)
  return out
})

const matches = computed(() => {
  const needle = query.value.trim().toUpperCase()
  if (!needle) return []
  return suggestions.value.filter(s => s.includes(needle)).slice(0, 6)
})

/** Accepts a typed symbol or one of the suggestions; only the A-Z0-9 shape is sent. */
function open(symbol?: string) {
  const candidate = String(symbol ?? query.value).trim().toUpperCase()
  if (!/^[A-Z0-9]{2,20}$/.test(candidate)) return
  overlay.open('asset', { symbol: candidate })
  query.value = ''
}
</script>

<template>
  <div class="relative hidden md:block">
    <UInput
      v-model="query"
      icon="i-lucide-search"
      size="sm"
      class="w-48"
      :placeholder="t('dash.search.placeholder')"
      :aria-label="t('dash.search.placeholder')"
      @keydown.enter.prevent="open()"
    />
    <div
      v-if="matches.length"
      class="absolute end-0 top-full z-50 mt-1 w-48 rounded border border-default bg-default shadow-lg"
    >
      <button
        v-for="symbol in matches"
        :key="symbol"
        type="button"
        class="block w-full px-3 py-1.5 text-left font-mono text-xs text-highlighted hover:bg-elevated"
        @click="open(symbol)"
      >{{ symbol }}</button>
    </div>
  </div>
</template>
