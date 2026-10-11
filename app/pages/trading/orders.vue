<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { PaperOrderItem } from '~~/types/orders'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Paper Orders lifecycle + history (roadmap §17.2, §26.4, §58.5 /orders).
//  First-class `paper_orders` docs from engine/models/order.mjs (D1). This page
//  is READ + CANCEL only: the executor owns every other transition, and cancel
//  is compare-and-swapped server-side at the alert level so a race can never
//  stop an already-filling order (D14).
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'paperOrders.title',
  descKey: 'paperOrders.desc'
})
const { viewMode } = useAdminGridView('orders-view-mode')
const orders = usePaperOrders()

const items = ref<PaperOrderItem[]>([])
const meta = ref<PaperOrdersListResult['meta'] | null>(null)
const mongoDown = ref(false)
const isLoading = ref(false)
const statusFilter = ref('')
const symbolFilter = ref('')
const cancelTarget = ref<PaperOrderItem | null>(null)
const cancelReason = ref('')
const cancelBusy = ref(false)

const STATUSES = ['', 'riskChecked', 'pending', 'partiallyFilled', 'filled', 'cancelled', 'expired', 'rejected']

async function refresh() {
  isLoading.value = true
  try {
    const res = await orders.list({ status: statusFilter.value, symbol: symbolFilter.value.trim() })
    items.value = res.items
    meta.value = res.meta
    mongoDown.value = res.mongo === 'down'
  } catch (err) {
    items.value = []
    notify.error(t('paperOrders.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch(statusFilter, refresh)

function askCancel(row: PaperOrderItem) {
  cancelTarget.value = row
  cancelReason.value = ''
}

async function doCancel() {
  const row = cancelTarget.value
  if (!row) return
  cancelBusy.value = true
  try {
    await orders.cancel(row.clientOrderId || row.id, { reason: cancelReason.value.trim() || undefined })
    notify.success(t('paperOrders.cancel'), t('paperOrders.cancelOk'))
    cancelTarget.value = null
    await refresh()
  } catch (err) {
    notify.error(t('paperOrders.cancel'), getErrorMessage(err, key => t(key)))
  } finally {
    cancelBusy.value = false
  }
}

const statusColor = (s: PaperOrderItem['status']) =>
  s === 'filled' ? 'success'
    : s === 'rejected' ? 'error'
      : s === 'cancelled' || s === 'expired' ? 'neutral'
        : s === 'partiallyFilled' ? 'warning' : 'info'

const sideColor = (s: PaperOrderItem['side']) => (s === 'BUY' ? 'success' : 'error')
const fmtNum = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 5 }))
const fmtTime = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—')

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('paperOrders.columns.symbol'), class: 'min-w-32' },
  { key: 'side', label: t('paperOrders.columns.side'), class: 'w-20' },
  { key: 'type', label: t('paperOrders.columns.type'), class: 'w-20' },
  { key: 'qty', label: t('paperOrders.columns.qty'), class: 'w-24' },
  { key: 'price', label: t('paperOrders.columns.price'), class: 'w-28' },
  { key: 'fill', label: t('paperOrders.columns.fill'), class: 'w-28' },
  { key: 'status', label: t('paperOrders.columns.status'), class: 'w-28' },
  { key: 'times', label: t('paperOrders.columns.created'), class: 'w-36' },
  { key: 'actions', label: t('paperOrders.columns.actions'), class: 'w-24' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))
mobileBar.registerInfo(computed(() => ({
  count: items.value.length,
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="paper-orders" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown"
          :label="t('paperOrders.mongoDown')"
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
          @click="refresh"
        />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UButton
          v-for="s in STATUSES"
          :key="s || 'all'"
          :label="s ? t(`paperOrders.statusLabels.${s}`) : t('paperOrders.allStatuses')"
          size="xs"
          :color="statusFilter === s ? 'primary' : 'neutral'"
          :variant="statusFilter === s ? 'soft' : 'ghost'"
          @click="statusFilter = s"
        />
        <UInput
          v-model="symbolFilter"
          :placeholder="t('paperOrders.searchSymbol')"
          icon="i-lucide-search"
          size="xs"
          class="w-32"
          :aria-label="t('paperOrders.columns.symbol')"
          @keyup.enter="refresh"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="items.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-4 pb-24 lg:pb-6">
      <div class="grid grid-cols-3 md:grid-cols-6 gap-2">
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaLive') }}</span>
          <span class="text-sm font-bold font-mono text-info">{{ meta?.live ?? 0 }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaFilled') }}</span>
          <span class="text-sm font-bold font-mono text-success">{{ meta?.filled ?? 0 }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaCancelled') }}</span>
          <span class="text-sm font-bold font-mono text-muted">{{ meta?.cancelled ?? 0 }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaRejected') }}</span>
          <span class="text-sm font-bold font-mono text-error">{{ meta?.rejected ?? 0 }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaExpired') }}</span>
          <span class="text-sm font-bold font-mono text-dimmed">{{ meta?.expired ?? 0 }}</span>
        </div>
        <div class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ t('paperOrders.metaTotal') }}</span>
          <span class="text-sm font-bold font-mono text-highlighted">{{ meta?.total ?? 0 }}</span>
        </div>
      </div>

      <LazyGridList
        :items="items"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="id"
        storage-key="orders-view-mode"
        @refresh="refresh"
      >
        <template #symbol="{ item }">
          <div class="flex flex-col">
            <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
            <span class="text-[10px] text-dimmed font-mono truncate">{{ item.clientOrderId || item.orderId }}</span>
          </div>
        </template>

        <template #side="{ item }">
          <UBadge :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
        </template>

        <template #type="{ item }">
          <span class="text-[11px] text-muted uppercase">{{ item.type }}</span>
        </template>

        <template #qty="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ fmtNum(item.qty) }}</span>
        </template>

        <template #price="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ fmtNum(item.price) }}</span>
        </template>

        <template #fill="{ item }">
          <div class="flex flex-col">
            <span class="text-[11px] font-mono text-highlighted">{{ fmtNum(item.fillPrice) }}</span>
            <span v-if="item.status === 'partiallyFilled'" class="text-[10px] text-warning font-mono">{{ fmtNum(item.filledQty) }} / {{ fmtNum(item.qty) }}</span>
          </div>
        </template>

        <template #status="{ item }">
          <div class="flex flex-col gap-0.5">
            <UBadge :label="t(`paperOrders.statusLabels.${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
            <span v-if="item.status === 'rejected' && item.rejectReason" class="text-[10px] text-error truncate max-w-40" :title="item.rejectReason">{{ item.rejectReason }}</span>
            <span v-else-if="item.status === 'cancelled' && item.cancelReason" class="text-[10px] text-dimmed truncate max-w-40" :title="item.cancelReason">{{ item.cancelReason }}</span>
          </div>
        </template>

        <template #times="{ item }">
          <span class="text-[11px] font-mono text-dimmed">{{ fmtTime(item.submittedAt || item.createdAt) }}</span>
        </template>

        <template #actions="{ item }">
          <UButton
            v-if="item.cancelable"
            icon="i-lucide-x"
            :label="t('paperOrders.cancel')"
            size="xs"
            variant="soft"
            color="error"
            @click="askCancel(item)"
          />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex flex-col gap-1.5 w-full">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-highlighted font-mono">{{ item.symbol }}</span>
              <div class="flex items-center gap-1.5">
                <UBadge :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
                <UBadge :label="t(`paperOrders.statusLabels.${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
              </div>
            </div>
            <div class="text-[11px] text-muted font-mono">
              {{ item.type }} · {{ fmtNum(item.qty) }} @ {{ fmtNum(item.price ?? item.fillPrice) }}
            </div>
            <UButton
              v-if="item.cancelable"
              icon="i-lucide-x"
              :label="t('paperOrders.cancel')"
              size="xs"
              variant="soft"
              color="error"
              class="self-start"
              @click="askCancel(item)"
            />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('paperOrders.empty')"
            :description="t('paperOrders.emptyHint')"
            icon="i-lucide-list-checks"
          />
        </template>
      </LazyGridList>

      <!-- Inline cancel confirm (executor-guarded server-side, D14) -->
      <div
        v-if="cancelTarget"
        class="rounded-lg bg-default ring ring-warning/50 p-4 flex flex-col gap-3"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('paperOrders.cancelConfirm', { symbol: cancelTarget.symbol, id: cancelTarget.clientOrderId || cancelTarget.orderId })"
          :actions="[
            { label: t('paperOrders.confirmCancel'), color: 'error', variant: 'solid', loading: cancelBusy, onClick: doCancel },
            { label: t('common.cancel'), variant: 'ghost', color: 'neutral', onClick: () => { cancelTarget = null } }
          ]"
        />
        <UInput
          v-model="cancelReason"
          :placeholder="t('paperOrders.cancelReason')"
          size="xs"
          class="w-full"
          :aria-label="t('paperOrders.cancelReason')"
        />
      </div>
    </div>
  </BasePage>
</template>
