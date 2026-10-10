<script setup lang="ts">
// =============================================================================
//  FillsPanel (roadmap v3 §18.5/§18.6/§26.5) — paper execution ledger.
//  Each row is a FACT the executor recorded when a state CAS matched (entry
//  open + each remainder execution). READ-ONLY viewer of execution quality:
//  measured fill price/qty, fee rate + amount, spread, slippage, latency chain
//  (signal → decision → event). No intent, no writes.
// =============================================================================
import type { FillsListResponse, PaperFillItem } from '~~/types/fills'
import { formatPrice } from '../utils/marketFeed'

defineProps<{
  reload?: number
}>()

const { t } = useI18n()

const items = ref<PaperFillItem[]>([])
const meta = ref<FillsListResponse['meta'] | null>(null)
const mongo = ref<'up' | 'down'>('up')
const error = ref('')

const fetchFills = async (): Promise<void> => {
  try {
    const res = await $fetch<FillsListResponse>('/api/v1/fills', {
      params: { limit: 12 }
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
  void fetchFills()
  timer = setInterval(() => void fetchFills(), 5000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg bg-default ring ring-default p-3">
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