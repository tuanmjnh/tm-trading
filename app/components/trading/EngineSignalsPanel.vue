<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { NativeSignalItem } from '~~/types/signals'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Native engine signals panel (roadmap §61.17 Phase D — D5).
//
//  Reads the attributed signals the NATIVE engine produced (collection signals)
//  through /api/v1/signals/native — the surface that does NOT depend on the
//  TradingView webhook. Self-contained: list, honest refresh/empty/error state,
//  metrics. The parent (trading/signals.vue) owns the source switch, ribbon and
//  footer and drives refresh through the exposed API.
// =============================================================================

const { t } = useI18n()
const notify = useNotify()
const { viewMode } = useAdminGridView('engine-signals-view-mode')
const api = useNativeSignals()
const { version: workspaceVersion } = useTradingWorkspace()
const { error: loadError, hasError, isStale, run } = useResourceState()

const mongoDown = ref(false)

const list = useCursorPagination<NativeSignalItem>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await api.list({ cursor: typeof cursor === 'string' ? cursor : null, limit })
    mongoDown.value = res.meta?.mongo === 'down'
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items, loading, hasMore } = list

const handleError = (err: unknown) => notify.error(t('signals.title'), getErrorMessage(err, key => t(key)))

async function refresh() {
  await run(async () => { await list.refresh() })
  if (hasError.value) handleError(loadError.value)
}

async function loadMore() {
  try {
    await list.loadMore()
  } catch (err) {
    handleError(err)
  }
}

onMounted(refresh)
// §61.17 Phase C/D: a new signal bumps the signals view — reconcile live.
watch(workspaceVersion('signals'), refresh)

const columns = computed<GridColumn[]>(() => [
  { key: 'ts', label: t('signals.time'), class: 'w-36' },
  { key: 'symbol', label: t('signals.symbol'), class: 'w-44' },
  { key: 'tf', label: t('signals.tf'), class: 'w-14' },
  { key: 'type', label: t('signals.type'), class: 'w-28' },
  { key: 'strategyVersion', label: t('signals.strategyVersion'), class: 'w-40' },
  { key: 'engineVersion', label: t('signals.engineVersion'), class: 'w-24' },
  { key: 'price', label: t('signals.price'), class: 'w-24' },
  { key: 'params', label: t('signals.params'), class: 'w-28' }
])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
const shortHash = (h: string | undefined) => (h ? h.slice(0, 8) : '—')
const strategyOf = (s: NativeSignalItem) => s.attribution?.strategyVersion || '—'
const engineOf = (s: NativeSignalItem) => s.attribution?.engineVersion || '—'
const paramsOf = (s: NativeSignalItem) => shortHash(s.attribution?.paramsHash)

const typeColor = (ty: string) =>
  ty === 'ST LONG' ? 'success' : ty === 'ST SHORT' ? 'error' : ty === 'SV' ? 'warning' : 'info'

// Header stats derived ONLY from the loaded page (cursor-paginated, so the hint
// says so when more pages exist). Never faked.
const metrics = computed<MetricItem[]>(() => {
  const rows = items.value
  const longs = rows.filter(s => s.type === 'ST LONG').length
  const shorts = rows.filter(s => s.type === 'ST SHORT').length
  const strategies = new Set(rows.map(s => s.attribution?.strategyVersion).filter((v): v is string => !!v))
  const hint = hasMore.value ? t('signals.metrics.loadedHint') : t('signals.metrics.allHint')
  return [
    { key: 'total', label: t('signals.metrics.engineTotal'), value: String(rows.length), tone: 'primary', hint },
    { key: 'long', label: t('signals.metrics.long'), value: String(longs), tone: 'success' },
    { key: 'short', label: t('signals.metrics.short'), value: String(shorts), tone: 'error' },
    { key: 'strategies', label: t('signals.metrics.strategies'), value: String(strategies.size), tone: 'default' }
  ]
})

// The parent drives the ribbon/footer/refresh through this API.
defineExpose({ refresh, loadMore, items, loading, hasMore, mongoDown, metrics })
</script>

<template>
  <div class="flex flex-col w-full min-h-0 gap-3">
    <div class="flex items-center gap-2 shrink-0">
      <UBadge
        v-if="mongoDown"
        :label="t('signals.mongoDown')"
        color="warning"
        variant="subtle"
        size="xs"
      />
      <UBadge
        :label="t('signals.source_engine')"
        icon="i-lucide-cpu"
        color="info"
        variant="subtle"
        size="xs"
      />
    </div>

    <SharedRefreshNotice
      :stale="isStale"
      :retrying="loading"
      :message="t('common.staleData')"
      @retry="refresh"
    />

    <LazyGridList
      :items="items"
      :columns="columns"
      :loading="loading"
      :can-load-more="hasMore"
      v-model:view-mode="viewMode"
      item-key="id"
      storage-key="engine-signals-view-mode"
      @load-more="loadMore"
      @refresh="refresh"
    >
      <template #ts="{ item }">
        <time :datetime="item.ts" class="text-[11px] text-muted">
          {{ formatTimeAgo(new Date(item.ts)) }}
        </time>
      </template>

      <template #symbol="{ item }">
        <div class="flex flex-col min-w-0 gap-0.5">
          <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
          <span class="text-[10px] text-dimmed font-mono truncate">{{ item.method }}</span>
        </div>
      </template>

      <template #tf="{ item }">
        <span class="text-xs text-muted">{{ item.tf ?? '—' }}</span>
      </template>

      <template #type="{ item }">
        <UBadge :label="item.type" :color="typeColor(item.type)" variant="subtle" size="xs" />
      </template>

      <template #strategyVersion="{ item }">
        <span class="text-xs text-highlighted font-mono">{{ strategyOf(item) }}</span>
      </template>

      <template #engineVersion="{ item }">
        <span class="text-xs text-muted font-mono">{{ engineOf(item) }}</span>
      </template>

      <template #price="{ item }">
        <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.price) }}</span>
      </template>

      <template #params="{ item }">
        <span class="text-[11px] text-dimmed font-mono" :title="item.attribution?.paramsHash ?? ''">{{ paramsOf(item) }}</span>
      </template>

      <template #mobile-content="{ item }">
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs">
              <span class="font-semibold text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
              <UBadge :label="item.type" :color="typeColor(item.type)" variant="subtle" size="xs" />
            </div>
            <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
              {{ strategyOf(item) }} · {{ fmtPrice(item.price) }}
            </div>
          </div>
          <time :datetime="item.ts" class="text-[10px] text-muted shrink-0">
            {{ formatTimeAgo(new Date(item.ts)) }}
          </time>
        </div>
      </template>

      <template #empty>
        <AdminEmptyState
          v-if="hasError"
          :title="t('common.loadErrorTitle')"
          :description="t('common.loadErrorHint')"
          icon="i-lucide-triangle-alert"
          :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: refresh }]"
        />
        <AdminEmptyState
          v-else
          :title="t('signals.engineEmpty')"
          :description="t('signals.engineEmptyHint')"
          icon="i-lucide-cpu"
        />
      </template>
    </LazyGridList>
  </div>
</template>
