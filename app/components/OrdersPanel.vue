<script setup lang="ts">
// =============================================================================
//  OrdersPanel (roadmap v3 §17.2/§26.4) — LIVE paper orders, first-class docs
//  from `paper_orders` (GET /api/v1/orders). Shows the state machine rows and
//  lets the user CANCEL an order still in flight (D14): the terminal only asks
//  the server, which guards cancel at the alert level (received/working).
//  Everything here is read-polls + one confirmable intent — the executor keeps
//  full ownership of every other transition.
// =============================================================================
import type { OrdersListResponse, PaperOrderItem } from '~~/types/orders'
import { formatPrice } from '../utils/marketFeed'

const props = defineProps<{
  /** bump to force one refresh immediately (e.g. after a ticket submit). */
  reload?: number
}>()

const { t } = useI18n()
const toast = useToast()

const items = ref<PaperOrderItem[]>([])
const meta = ref<OrdersListResponse['meta'] | null>(null)
const mongo = ref<'up' | 'down'>('up')
const error = ref('')
const busy = ref(false)
const cancellingId = ref<string | null>(null)

const reloadOn = computed(() => props.reload ?? 0)

const statusLabel = (s: PaperOrderItem['status']): string =>
  t(`trade.orderStatus.${s}`)

const statusColor = (s: PaperOrderItem['status']): 'success' | 'warning' | 'neutral' | 'error' =>
  s === 'filled' ? 'success'
  : s === 'cancelled' || s === 'expired' || s === 'rejected' ? 'neutral'
  : s === 'pending' ? 'warning'
  : 'success'

const fetchOrders = async (): Promise<void> => {
  try {
    const res = await $fetch<OrdersListResponse>('/api/v1/orders', {
      params: { limit: 24 }
    })
    items.value = res.items
    meta.value = res.meta
    mongo.value = res.mongo
    error.value = ''
  } catch (err) {
    error.value = (err as { data?: { message?: string } })?.data?.message ?? String(err)
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void fetchOrders()
  timer = setInterval(() => void fetchOrders(), 5000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

watch(reloadOn, () => void fetchOrders())

const cancelOrder = async (o: PaperOrderItem): Promise<void> => {
  if (!o.cancelable || cancellingId.value) return
  cancellingId.value = o.id
  try {
    await $fetch(`/api/v1/orders/${encodeURIComponent(o.clientOrderId || o.id)}/cancel`, {
      method: 'POST',
      body: { by: 'terminal', reason: 'user' }
    })
    toast.add({ title: t('trade.ordersCancelOk'), icon: 'i-lucide-x-circle', color: 'success' })
    void fetchOrders()
  } catch (err) {
    const msg = (err as { data?: { message?: string } })?.data?.message
    toast.add({
      title: msg ?? t('trade.ordersCancelFailed'),
      icon: 'i-lucide-alert-triangle',
      color: 'error'
    })
    void fetchOrders()
  } finally {
    cancellingId.value = null
  }
}

const priceText = (o: PaperOrderItem): string =>
  o.fillPrice != null ? formatPrice(o.fillPrice) : o.price != null ? formatPrice(o.price) : '—'

const qtyText = (o: PaperOrderItem): string =>
  o.filledQty > 0 && o.filledQty < o.qty ? `${o.filledQty}/${o.qty}` : String(o.qty)
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('trade.orders') }}</h3>
      <div v-if="mongo === 'down'" class="text-[10px] text-muted">
        {{ t('trade.ordersMongoDown') }}
      </div>
      <div v-else-if="meta" class="flex items-center gap-1.5">
        <UBadge color="warning" variant="subtle" size="sm">
          {{ t('trade.ordersLive') }} {{ meta.live }}
        </UBadge>
      </div>
    </div>

    <div v-if="!items.length && !error" class="text-[11px] text-muted">
      {{ t('trade.ordersEmpty') }}
    </div>

    <div v-else class="flex max-h-56 flex-col gap-1 overflow-y-auto">
      <div
        v-for="o in items"
        :key="o.id"
        class="grid grid-cols-12 items-center gap-1 font-mono text-[11px]"
      >
        <span class="col-span-2" :class="o.side === 'BUY' ? 'text-success' : 'text-error'">
          {{ o.side === 'BUY' ? t('trade.sides.buy') : t('trade.sides.sell') }}
        </span>
        <span class="col-span-2 truncate" :title="o.symbol">{{ o.symbol }}</span>
        <span class="col-span-1 text-muted">{{ o.type }}</span>
        <span class="col-span-2 text-right">{{ qtyText(o) }}</span>
        <span class="col-span-2 text-right">{{ priceText(o) }}</span>
        <span class="col-span-2 truncate">
          <UBadge :color="statusColor(o.status)" variant="subtle" size="xs">
            {{ statusLabel(o.status) }}
          </UBadge>
        </span>
        <span class="col-span-1 text-right">
          <UButton
            v-if="o.cancelable"
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-x"
            :loading="cancellingId === o.id"
            :disabled="busy || cancellingId !== null"
            :aria-label="t('trade.ordersCancel') + ' ' + o.symbol"
            @click="cancelOrder(o)"
          >
            {{ t('trade.ordersCancel') }}
          </UButton>
        </span>
      </div>
    </div>

    <p v-if="error" class="text-[11px] text-error">{{ t('trade.ordersError') }}: {{ error }}</p>
  </div>
</template>