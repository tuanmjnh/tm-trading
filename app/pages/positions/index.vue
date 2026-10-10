<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { PositionItem } from '~~/types/positions'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'positions.title',
  descKey: 'positions.desc'
})
const { viewMode } = useAdminGridView('positions-view-mode')
const { buildRowActions } = useAdminRowActions()
const positionsApi = usePositions()

const statusFilter = ref('all')
const sourceFilter = ref('all')

// Global header stats (not filtered) — open/closed/realized across accounts.
const meta = ref<{ open: number; closed: number; realizedPnlAbs: number | null; mongo: 'up' | 'down' } | null>(null)

const positionsList = useCursorPagination<PositionItem>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await positionsApi.list({
      cursor: typeof cursor === 'string' ? cursor : null,
      limit,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      source: sourceFilter.value === 'all' ? undefined : sourceFilter.value
    })
    meta.value = res.meta
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: rows, loading: isLoading, hasMore } = positionsList

const statusItems = computed(() => [
  { label: t('positions.statusAll'), value: 'all' },
  { label: t('positions.statusOpen'), value: 'open' },
  { label: t('positions.statusClosed'), value: 'closed' },
  { label: t('positions.statusCancelled'), value: 'cancelled' }
])
const sourceItems = computed(() => [
  { label: t('positions.filterAll'), value: 'all' },
  { label: t('positions.srcPaper'), value: 'paper' },
  { label: t('positions.srcMt5'), value: 'mt5' },
  { label: t('positions.srcExchange'), value: 'exchange' },
  { label: t('positions.srcManual'), value: 'manual' }
])

async function refreshPositions() {
  try {
    await positionsList.refresh()
  } catch (err) {
    notify.error(t('positions.title'), getErrorMessage(err, key => t(key)))
  }
}

async function loadMorePositions() {
  try {
    await positionsList.loadMore()
  } catch (err) {
    notify.error(t('positions.title'), getErrorMessage(err, key => t(key)))
  }
}

watch([statusFilter, sourceFilter], () => {
  refreshPositions()
})

onMounted(refreshPositions)

const columns = computed<GridColumn[]>(() => [
  { key: 'entryTime', label: t('positions.colTime'), class: 'w-36' },
  { key: 'symbol', label: t('positions.colSymbol'), class: 'w-40' },
  { key: 'dir', label: t('positions.colDir'), class: 'w-20' },
  { key: 'qty', label: t('positions.colQty'), class: 'w-24' },
  { key: 'entryPrice', label: t('positions.colEntry'), class: 'w-24' },
  { key: 'sl', label: t('positions.colSl'), class: 'w-24' },
  { key: 'status', label: t('positions.colStatus'), class: 'w-24' },
  { key: 'pnl', label: t('positions.colPnl'), class: 'w-28' },
  { key: 'source', label: t('positions.colSource'), class: 'w-32' }
])

const rowActions = () => buildRowActions([])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
const fmtMoney = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const moneyClass = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const fmtPct = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

const dirLabel = (d: number) => (d === 1 ? t('positions.dirLong') : t('positions.dirShort'))
const statusLabel = (s: string) =>
  s === 'open' ? t('positions.statusOpen')
    : s === 'closed' ? t('positions.statusClosed')
      : s === 'cancelled' ? t('positions.statusCancelled') : s
const statusColor = (s: string): 'success' | 'neutral' | 'warning' =>
  s === 'open' ? 'success' : s === 'cancelled' ? 'warning' : 'neutral'

const statCards = computed(() => [
  { key: 'open', label: t('positions.statOpen'), value: meta.value ? String(meta.value.open) : '—' },
  { key: 'closed', label: t('positions.statClosed'), value: meta.value ? String(meta.value.closed) : '—' },
  {
    key: 'realized',
    label: t('positions.statRealized'),
    value: meta.value ? fmtMoney(meta.value.realizedPnlAbs) : '—',
    money: meta.value?.realizedPnlAbs ?? null
  }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refreshPositions }
]))
mobileBar.registerInfo(computed(() => ({
  count: rows.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="positions" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="meta?.mongo === 'down'"
          :label="t('positions.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshPositions"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <USelect
              v-model="statusFilter"
              :items="statusItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('positions.statusLabel')"
            />
            <USelect
              v-model="sourceFilter"
              :items="sourceItems"
              value-key="value"
              size="sm"
              class="w-full sm:w-40"
              :aria-label="t('positions.sourceLabel')"
            />
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter
        :count="rows.length"
        :has-more="hasMore"
        :loading="isLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <div class="grid grid-cols-3 gap-2 shrink-0">
        <div
          v-for="c in statCards"
          :key="c.key"
          class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0"
        >
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ c.label }}</span>
          <span
            class="text-sm font-bold font-mono truncate"
            :class="'money' in c ? moneyClass(c.money) : 'text-highlighted'"
          >{{ c.value }}</span>
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="rows"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="hasMore"
          :action-options="rowActions"
          v-model:view-mode="viewMode"
          item-key="id"
          storage-key="positions-view-mode"
          @load-more="loadMorePositions"
          @refresh="refreshPositions"
        >
          <template #entryTime="{ item }">
            <time :datetime="item.entryTime" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.entryTime)) }}
            </time>
          </template>

          <template #symbol="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.tf ?? '—' }}</span>
            </div>
          </template>

          <template #dir="{ item }">
            <UBadge
              :label="dirLabel(item.dir)"
              :color="item.dir === 1 ? 'success' : 'error'"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #qty="{ item }">
            <span class="text-xs text-highlighted font-mono">{{ item.qty }}</span>
          </template>

          <template #entryPrice="{ item }">
            <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.entryPrice) }}</span>
          </template>

          <template #sl="{ item }">
            <span class="text-xs font-mono" :class="item.sl != null ? 'text-error' : 'text-dimmed'">
              {{ fmtPrice(item.sl) }}
            </span>
          </template>

          <template #status="{ item }">
            <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
          </template>

          <template #pnl="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-mono" :class="moneyClass(item.pnlAbs)">{{ fmtMoney(item.pnlAbs) }}</span>
              <span v-if="item.pnlPct != null" class="text-[10px] font-mono" :class="moneyClass(item.pnlAbs)">
                {{ fmtPct(item.pnlPct) }}
              </span>
            </div>
          </template>

          <template #source="{ item }">
            <div class="flex flex-col min-w-0 gap-0.5">
              <span class="text-xs text-highlighted truncate">{{ item.source }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.account }}</span>
            </div>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                  <span class="text-dimmed font-mono">{{ item.tf ?? '—' }}</span>
                  <UBadge
                    :label="dirLabel(item.dir)"
                    :color="item.dir === 1 ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                  {{ fmtPrice(item.entryPrice) }}
                  <span v-if="item.sl != null" class="text-error"> · SL {{ fmtPrice(item.sl) }}</span>
                </div>
                <div class="text-[10px] text-dimmed truncate mt-0.5">
                  {{ item.source }} · {{ item.account }} · {{ item.qty }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
                <span
                  class="block text-[11px] font-mono mt-1"
                  :class="moneyClass(item.pnlAbs)"
                >{{ fmtMoney(item.pnlAbs) }}</span>
                <time :datetime="item.entryTime" class="block text-[10px] text-muted">
                  {{ formatTimeAgo(new Date(item.entryTime)) }}
                </time>
              </div>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('positions.empty')"
              :description="t('positions.emptyHint')"
              icon="i-lucide-layers"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
