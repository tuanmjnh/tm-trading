<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { Instrument } from '~~/types/instruments'
import type { MarketSourceHealth } from '~~/types/health'
import type { MetricItem } from '~/components/MetricRibbon.vue'

// =============================================================================
//  Market Explorer (roadmap §57.4 B, §58.5 /markets). Search + discovery over
//  the canonical Instrument Catalog API (§30.1) — never a second symbol list.
//  Data availability = registered market provider per venue; provider health
//  comes from the SAME per-venue probes as admin-system/data-sources (§58 #6),
//  which is DISTINCT from tm-hub connection records (§58.6).
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketExplorer.title',
  descKey: 'marketExplorer.desc'
})
const { viewMode } = useAdminGridView('markets-explorer-view-mode')
const catalog = useMarketCatalog()
const health = useSystemHealth()

const rows = ref<Instrument[]>([])
const providerIds = ref<Set<string>>(new Set())
const sourceHealth = ref<MarketSourceHealth[]>([])
const isLoading = ref(false)
const search = ref('')
const typeFilter = ref('')
const statusFilter = ref('')

const TYPES = ['', 'spot', 'perp', 'future', 'option']
const STATUSES = ['', 'active', 'inactive', 'delisted']

async function refresh() {
  isLoading.value = true
  try {
    const [list, venues, sources] = await Promise.all([
      catalog.instruments({ type: typeFilter.value, status: statusFilter.value }),
      catalog.venues(),
      health.marketSources().catch(() => ({ success: false, data: [] as MarketSourceHealth[], meta: { total: 0, healthy: 0 } }))
    ])
    rows.value = list
    providerIds.value = new Set(venues.filter(v => v.hasProvider).map(v => v.id))
    sourceHealth.value = sources.success ? sources.data : []
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch([typeFilter, statusFilter], refresh)

const healthByVenue = computed(() => {
  const map: Record<string, MarketSourceHealth> = {}
  for (const s of sourceHealth.value) map[s.venue] = s
  return map
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((i) => {
    const hay = [
      i.id, i.symbol, i.base, i.quote, i.engineSymbol ?? '',
      ...i.venues.map(v => `${v.venue} ${v.native}`)
    ].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

type VenueHealth = 'up' | 'down' | 'unknown' | 'none'
function venueHealth(venue: string): VenueHealth {
  if (!providerIds.value.has(venue)) return 'none'
  const st = healthByVenue.value[venue]?.status
  return st === 'up' ? 'up' : st === 'down' ? 'down' : 'unknown'
}
const venueDotClass: Record<VenueHealth, string> = {
  up: 'bg-success',
  down: 'bg-error',
  unknown: 'bg-warning',
  none: 'bg-dimmed'
}
function availability(item: Instrument) {
  const served = item.venues.filter(v => providerIds.value.has(v.venue))
  const up = served.filter(v => venueHealth(v.venue) === 'up').length
  return { up, total: served.length }
}
const statusColor = (s: Instrument['status']) =>
  s === 'active' ? 'success' : s === 'inactive' ? 'warning' : 'neutral'
const typeColor = (ty: Instrument['type']) =>
  ty === 'perp' ? 'primary' : ty === 'spot' ? 'info' : ty === 'future' ? 'warning' : 'neutral'
function tradeTarget(item: Instrument) {
  return item.engineSymbol ? `/trading?instrument=${encodeURIComponent(item.engineSymbol)}` : ''
}

const stats = ref<{ total: number, active: number }>({ total: 0, active: 0 })

async function loadStats() {
  try {
    const list = await catalog.instruments({})
    stats.value = { total: list.length, active: list.filter(i => i.status === 'active').length }
  } catch {
    stats.value = { total: 0, active: 0 }
  }
}
onMounted(loadStats)

const metrics = computed<MetricItem[]>(() => {
  const up = sourceHealth.value.filter(s => s.status === 'up').length
  return [
    { key: 'instruments', label: t('marketExplorer.metrics.instruments'), value: String(stats.value.total), icon: 'i-lucide-database', tone: 'primary' },
    { key: 'active', label: t('marketExplorer.metrics.active'), value: String(stats.value.active), icon: 'i-lucide-circle-check', tone: 'success' },
    { key: 'venues', label: t('marketExplorer.metrics.venues'), value: String(providerIds.value.size), icon: 'i-lucide-component', tone: 'info' },
    { key: 'providersUp', label: t('marketExplorer.metrics.providersUp'), value: sourceHealth.value.length ? `${up}/${sourceHealth.value.length}` : '—', icon: 'i-lucide-activity', tone: up > 0 && up === sourceHealth.value.length ? 'success' : 'warning' }
  ]
})

const trail = computed(() => [{ label: t('nav.markets') }, { label: title.value }])

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('marketExplorer.columns.instrument'), class: 'min-w-36' },
  { key: 'id', label: t('marketExplorer.columns.catalogId'), class: 'min-w-44' },
  { key: 'type', label: t('marketExplorer.columns.type'), class: 'w-20' },
  { key: 'pair', label: t('marketExplorer.columns.pair'), class: 'w-28' },
  { key: 'venues', label: t('marketExplorer.columns.venues'), class: 'min-w-48' },
  { key: 'availability', label: t('marketExplorer.columns.availability'), class: 'w-28' },
  { key: 'status', label: t('marketExplorer.columns.status'), class: 'w-24' },
  { key: 'actions', label: t('marketExplorer.columns.actions'), class: 'w-20' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="markets-explorer" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('marketExplorer.pip')" />
    </template>

    <template #right>
      <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading"
        @click="refresh" />
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UButton v-for="ty in TYPES" :key="ty || 'all-types'"
          :label="ty ? t(`marketExplorer.typeLabels.${ty}`) : t('marketExplorer.allTypes')" size="xs"
          :color="typeFilter === ty ? 'primary' : 'neutral'" :variant="typeFilter === ty ? 'soft' : 'ghost'"
          @click="typeFilter = ty" />
        <USeparator orientation="vertical" class="h-4" />
        <UButton v-for="st in STATUSES" :key="st || 'all-statuses'"
          :label="st ? t(`marketExplorer.statusLabels.${st}`) : t('marketExplorer.allStatuses')" size="xs"
          :color="statusFilter === st ? 'primary' : 'neutral'" :variant="statusFilter === st ? 'soft' : 'ghost'"
          @click="statusFilter = st" />
        <UInput v-model="search" :placeholder="t('marketExplorer.search')" icon="i-lucide-search" size="xs" class="w-52"
          :aria-label="t('marketExplorer.search')" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <MetricRibbon :items="metrics" />
      <LazyGridList :items="filtered" :columns="columns" :loading="isLoading" :can-load-more="false"
        v-model:view-mode="viewMode" item-key="id" storage-key="markets-explorer-view-mode" @refresh="refresh">
        <template #symbol="{ item }">
          <div class="flex flex-col">
            <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
            <span v-if="item.engineSymbol" class="text-[10px] text-dimmed font-mono">{{ item.engineSymbol }}</span>
          </div>
        </template>

        <template #id="{ item }">
          <span class="text-[11px] font-mono text-muted truncate">{{ item.id }}</span>
        </template>

        <template #type="{ item }">
          <UBadge :label="t(`marketExplorer.typeLabels.${item.type}`)" :color="typeColor(item.type)" variant="subtle"
            size="xs" />
        </template>

        <template #pair="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.base }} / {{ item.quote }}</span>
        </template>

        <template #venues="{ item }">
          <div class="flex flex-wrap gap-1.5">
            <UBadge v-for="v in item.venues" :key="`${item.id}-${v.venue}`"
              :color="venueHealth(v.venue) === 'up' ? 'success' : venueHealth(v.venue) === 'down' ? 'error' : 'neutral'"
              variant="subtle" size="xs">
              <span class="flex items-center gap-1.5">
                <span class="size-1.5 rounded-full" :class="venueDotClass[venueHealth(v.venue)]" />
                {{ v.venue }}
              </span>
            </UBadge>
          </div>
        </template>

        <template #availability="{ item }">
          <span v-if="availability(item).total" class="text-[11px] font-mono"
            :class="availability(item).up === availability(item).total ? 'text-success' : availability(item).up ? 'text-warning' : 'text-error'">{{
              availability(item).up }}/{{ availability(item).total }}</span>
          <span v-else class="text-[11px] text-dimmed">{{ t('marketExplorer.noProvider') }}</span>
        </template>

        <template #status="{ item }">
          <UBadge :label="t(`marketExplorer.statusLabels.${item.status}`)" :color="statusColor(item.status)"
            variant="subtle" size="xs" />
        </template>

        <template #actions="{ item }">
          <UButton icon="i-lucide-panel-top-open" size="xs" variant="ghost" color="primary" :to="tradeTarget(item)"
            :disabled="!item.engineSymbol" :title="t('marketExplorer.openTerminal')"
            :aria-label="t('marketExplorer.openTerminal')" :ui="{ label: 'hidden' }" />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex flex-col gap-1.5 w-full">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
              <div class="flex items-center gap-1.5">
                <UBadge :label="t(`marketExplorer.typeLabels.${item.type}`)" :color="typeColor(item.type)"
                  variant="subtle" size="xs" />
                <UBadge :label="t(`marketExplorer.statusLabels.${item.status}`)" :color="statusColor(item.status)"
                  variant="subtle" size="xs" />
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <UBadge v-for="v in item.venues" :key="`m-${item.id}-${v.venue}`" :label="`${v.venue} · ${v.native}`"
                :color="venueHealth(v.venue) === 'up' ? 'success' : venueHealth(v.venue) === 'down' ? 'error' : 'neutral'"
                variant="subtle" size="xs" />
            </div>
            <UButton v-if="item.engineSymbol" icon="i-lucide-panel-top-open" :label="t('marketExplorer.openTerminal')"
              size="xs" variant="soft" color="primary" :to="tradeTarget(item)" />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState :title="t('marketExplorer.empty')" :description="t('marketExplorer.emptyHint')"
            icon="i-lucide-telescope" />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
