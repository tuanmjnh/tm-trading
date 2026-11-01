<script setup lang="ts">
// V4.2 §1 Watchlist & Signals workspace — futures signals plus their forward-test
// history. Panels reuse the existing pages directly (see components/workspace/Shell.vue).
// `/trading/signals` and `/test-center/forward` stay routable as deep links.
import TradingSignalsPage from '~/pages/trading/signals.vue'
import ForwardTestsPage from '~/pages/test-center/forward.vue'

const tabs = [
  { key: 'signals', icon: 'i-lucide-radio-tower', component: TradingSignalsPage },
  { key: 'history', icon: 'i-lucide-history', component: ForwardTestsPage }
]
</script>

<template>
  <WorkspaceShell namespace="watchlistWorkspace" :tabs="tabs" />
</template>
