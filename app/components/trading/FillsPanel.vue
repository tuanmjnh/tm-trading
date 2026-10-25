<script setup lang="ts">
// =============================================================================
//  FillsPanel (roadmap v3 §18.5/§18.6/§26.5) — paper execution ledger.
//  Each row is a FACT the executor recorded when a state CAS matched (entry
//  open + each remainder execution). READ-ONLY viewer of execution quality:
//  measured fill price/qty, fee rate + amount, spread, slippage, latency chain
//  (signal → decision → event). No intent, no writes.
// =============================================================================
import type { FillsListResponse, PaperFillItem } from '#shared/types/fills'
import { formatPrice } from '../../utils/marketFeed'
import { getErrorMessage, isAuthError } from '../../shared/utils/errors'

defineProps<{
  reload?: number
}>()

const { t } = useI18n()

const items = ref<PaperFillItem[]>([])
const meta = ref<FillsListResponse['meta'] | null>(null)
const mongo = ref<'up' | 'down'>('up')
const error = ref('')

/** Session lost (401) — polling is suspended until re-authentication. */
const halted = ref(false)

let timer: ReturnType<typeof setInterval> | null = null
// 429 backoff: one full budget window of silence after a rate-limit hit.
let notBefore = 0

const stopPolling = (): void => {
  if (timer) clearInterval(timer)
  timer = null
}

const startPolling = (): void => {
  if (timer) return
  timer = setInterval(() => void fetchFills(), 10000)
}

const fetchFills = async (): Promise<void> => {
  // After an auth failure nothing can succeed until the user signs in again,
  // so skip the call rather than emit a 401 every tick. Same for a 429.
  if (halted.value || Date.now() < notBefore) return
  try {
    const res = await $fetch<FillsListResponse>('/api/v1/fills', {
      params: { limit: 12 }
    })
    items.value = res.items
    meta.value = res.meta
    mongo.value = res.mongo
    error.value = ''
    halted.value = false
  } catch (err) {
    error.value = getErrorMessage(err, key => t(key))
    if (isAuthError(err)) {
      halted.value = true
      stopPolling()
      error.value = t('trade.sessionExpired')
    }
    const status = (err as { response?: { status?: unknown } })?.response?.status
    if (status === 429) notBefore = Date.now() + 60_000
  }
}

// Resume polling once the user re-authenticates.
const { isAuthenticated } = useAuth()
watch(isAuthenticated, (authed) => {
  if (authed) {
    halted.value = false
    void fetchFills()
    startPolling()
  }
})

// Budget guard: same 5s/60-req-min rationale as OrdersPanel — pause while
// the tab is hidden, refetch on show.
const onVisibility = (): void => {
  if (document.hidden) {
    stopPolling()
  } else if (!halted.value) {
    void fetchFills()
    startPolling()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  if (document.hidden) return // first visible will fetch via onVisibility
  void fetchFills()
  startPolling()
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  stopPolling()
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('trade.fills') }}</h3>
      <div v-if="mongo === 'down'" class="text-[10px] text-muted">
        {{ t('trade.fillsMongoDown') }}
      </div>
      <div v-else-if="meta" class="flex items-center gap-1.5">
        <span class="font-mono text-[10px] text-muted">{{ meta.total }}</span>
      </div>
    </div>

    <p v-if="!items.length && !error" class="text-[11px] text-muted">
      {{ t('trade.fillsEmpty') }}
    </p>

    <div v-else class="flex max-h-56 flex-col gap-1 overflow-y-auto">
      <div
        v-for="f in items"
        :key="f.id"
        class="grid grid-cols-12 items-center gap-1 font-mono text-[11px]"
      >
        <span class="col-span-2" :class="f.side === 'BUY' ? 'text-success' : 'text-error'">
          {{ f.side === 'BUY' ? t('trade.sides.buy') : t('trade.sides.sell') }}
        </span>
        <span class="col-span-2 truncate" :title="f.symbol">{{ f.symbol }}</span>
        <span class="col-span-3 text-right">{{ formatPrice(f.fillPrice) }}</span>
        <span class="col-span-2 text-right">{{ f.fillQty }}</span>
        <span class="col-span-2 text-right text-muted">{{ f.feeAmount }} / {{
          f.feeRateBps ?? '—' }}</span>
        <span
          class="col-span-1 text-right"
          :title="t('trade.fillsLatency')"
          :class="f.latencyMs > 500 ? 'text-error' : 'text-muted'"
        >
          {{ f.latencyMs > 0 ? `${f.latencyMs}ms` : '—' }}
        </span>
      </div>
    </div>

    <p v-if="error" class="text-[11px] text-error">{{ t('trade.fillsError') }}: {{ error }}</p>
  </div>
</template>