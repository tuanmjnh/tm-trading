<script setup lang="ts">
// =============================================================================
//  TM Trading V5.0 — ONE Dashboard.
//
//  This file is a THIN composition shell: it owns the header actions, the
//  initial read, the bounded refresh poll and the overlay host. All data logic
//  lives in `useDashboardFeed`; each panel is its own component (V5.0 §3, §4).
// =============================================================================
import { overlayFromQuery, overlayToQuery, OVERLAY_QUERY_KEY, OVERLAY_ITEM_KEY, OVERLAY_SECTION_KEY, OVERLAY_SYMBOL_KEY } from '~/composables/useAppOverlay'
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const overlay = useAppOverlay()
const feed = useDashboardFeed()
const mobileBar = useMobileBar()

const trail = computed(() => [{ label: t('dash.title') }])
const anyLoading = computed(() => Object.values(feed.loading).some(Boolean))

// --- Deep links: /?panel=signal&item=… ---------------------------------------
// Read once on mount, then keep the URL in sync with the overlay state so a
// shared link reopens the same panel. No secret is ever placed in the URL.
function applyQuery() {
  const next = overlayFromQuery(route.query as Record<string, unknown>)
  if (next) overlay.state.value = next
}

onMounted(() => {
  applyQuery()
  void feed.refreshAll()
  feed.startPolling()
})

onUnmounted(() => feed.stopPolling())

watch(() => overlay.state.value, (state) => {
  const current: Record<string, string> = {}
  for (const key of [OVERLAY_QUERY_KEY, OVERLAY_ITEM_KEY, OVERLAY_SYMBOL_KEY, OVERLAY_SECTION_KEY]) {
    if (typeof route.query[key] === 'string') current[key] = String(route.query[key])
  }
  const next = state ? overlayToQuery(state) : {}
  // Only touch the URL when the overlay keys actually differ (avoids a router
  // navigation per poll tick).
  const same = Object.keys(next).every(k => current[k] === next[k])
    && Object.keys(current).every(k => !(k in next))
  if (same) return
  void router.replace({ query: { ...route.query, ...next, ...(state ? {} : clearedQuery()) } })
})

function clearedQuery(): Record<string, undefined> {
  return {
    [OVERLAY_QUERY_KEY]: undefined,
    [OVERLAY_ITEM_KEY]: undefined,
    [OVERLAY_SYMBOL_KEY]: undefined,
    [OVERLAY_SECTION_KEY]: undefined
  }
}

// --- Header actions ---------------------------------------------------------
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-settings-2',
    label: t('dash.controlCenter'),
    primary: true,
    onSelect: () => overlay.open('control', { section: 'services' })
  },
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    disabled: anyLoading.value,
    onSelect: () => { void feed.refreshAll() }
  }
]))

mobileBar.registerInfo(computed(() => ({
  count: feed.events.value.length,
  loading: feed.loading.signals,
  text: t('dash.signal.total', { count: feed.events.value.length })
})))

/** The newest successful section read — the Dashboard's "as of" anchor. */
const lastRead = computed(() => {
  const stamps = Object.values(feed.readAt).filter((v): v is string => typeof v === 'string')
  return stamps.length ? stamps.sort().at(-1) ?? null : null
})

const anyFailed = computed(() => Object.values(feed.failed).filter(Boolean).length)
</script>

<template>
  <BasePage id="dashboard-v5" :title="t('dash.title')" :description="t('dash.description')">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <LazyDashboardSymbolSearch />
        <UBadge
          v-if="lastRead"
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-refresh-cw"
          :label="formatTimeAgo(new Date(lastRead))"
        />
        <UButton
          v-if="anyFailed"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="ghost"
          size="sm"
          :label="t('dash.partial', { count: anyFailed })"
          @click="overlay.open('control', { section: 'services' })"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="anyLoading"
          :aria-label="t('common.refresh')"
          @click="feed.refreshAll"
        />
        <UButton
          icon="i-lucide-settings-2"
          :label="t('dash.controlCenter')"
          color="primary"
          variant="soft"
          size="sm"
          @click="overlay.open('control', { section: 'services' })"
        />
      </div>
    </template>

    <div class="w-full space-y-4 pb-24 lg:pb-4">
      <LazyDashboardSystemHealthStrip />

      <LazyDashboardMarketOverviewStrip />

      <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div class="xl:col-span-8 min-w-0">
          <LazyDashboardSignalCenterPanel />
        </div>
        <div class="xl:col-span-4 min-w-0">
          <LazyDashboardWatchlistPanel />
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div class="xl:col-span-7 min-w-0">
          <LazyDashboardMarketPulsePanel />
        </div>
        <div class="xl:col-span-5 min-w-0">
          <LazyDashboardNewsEventsPanel />
        </div>
      </div>

      <LazyDashboardAiBriefingPanel />
    </div>

    <!-- One overlay host: only one primary overlay is ever rendered. -->
    <LazyDashboardSignalDetailSlideover v-if="overlay.kind.value === 'signal'" />
    <LazyDashboardAssetDetailSlideover v-if="overlay.kind.value === 'asset'" />
    <LazyDashboardNewsDetailSlideover v-if="overlay.kind.value === 'news'" />
    <LazyDashboardControlCenterSlideover v-if="overlay.kind.value === 'control'" />

    <LazyBaseConfirmModal
      :open="overlay.pendingClose.value"
      color="warning"
      :title="t('dash.overlay.dirtyTitle')"
      :description="t('dash.overlay.dirtyDescription')"
      :confirm-label="t('dash.overlay.discard')"
      :cancel-label="t('common.cancel')"
      @update:open="(v: boolean | undefined) => { if (!v) overlay.pendingClose.value = false }"
      @confirm="overlay.closeDiscard()"
    />
  </BasePage>
</template>
