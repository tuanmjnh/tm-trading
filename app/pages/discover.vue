<script setup lang="ts">
// V4.2 §1 Discover workspace — one top-level route that hosts the market
// scanner surfaces as tabs. The tab panels ARE the existing pages (imported
// directly, each keeping its own BasePage); no page was rewritten. The reused
// leaves (`/markets`, `/markets/scanner`, `/markets/explorer`) stay routable as
// deep links and are hidden from the primary nav by the seed.
import MarketIntelPage from '~/pages/markets/index.vue'
import MarketScannerPage from '~/pages/markets/scanner.vue'
import MarketExplorerPage from '~/pages/markets/explorer.vue'
import MarketVolatilityPage from '~/pages/markets/volatility.vue'
import MarketFundingPage from '~/pages/markets/funding.vue'
import MarketLowcapPage from '~/pages/markets/lowcap.vue'

const tabs = [
  { key: 'market', icon: 'i-lucide-radar', component: MarketIntelPage },
  { key: 'scanner', icon: 'i-lucide-zap', component: MarketScannerPage },
  { key: 'volatility', icon: 'i-lucide-activity', component: MarketVolatilityPage },
  { key: 'funding', icon: 'i-lucide-banknote', component: MarketFundingPage },
  { key: 'lowcap', icon: 'i-lucide-circle-dollar', component: MarketLowcapPage },
  { key: 'topCoins', icon: 'i-lucide-coins', component: MarketExplorerPage }
]
</script>

<template>
  <WorkspaceShell namespace="discover" :tabs="tabs" />
</template>
