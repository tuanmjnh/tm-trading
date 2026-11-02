<script setup lang="ts">
// V4.2 §1 Watchlist & Signals workspace — futures signals plus their forward-test
// history. Panels reuse the existing pages directly (see components/workspace/Shell.vue).
// `/trading/signals` and `/test-center/forward` stay routable as deep links.
import { defineAsyncComponent } from 'vue'
import TradingSignalsPage from '~/pages/trading/signals.vue'
import ForwardTestsPage from '~/pages/test-center/forward.vue'

// ListsTab mounts on demand (S8 chunk 1) — the Lazy prefix defers its chunk
// until the user actually opens the tab.
const ListsTab = defineAsyncComponent(() => import('~/components/watchlist/ListsTab.vue'))

const tabs = [
  { key: 'signals', icon: 'i-lucide-radio-tower', component: TradingSignalsPage },
  { key: 'history', icon: 'i-lucide-history', component: ForwardTestsPage },
  { key: 'lists', icon: 'i-lucide-list', component: ListsTab }
]
</script>

<template>
  <WorkspaceShell namespace="watchlistWorkspace" :tabs="tabs" />
</template>
