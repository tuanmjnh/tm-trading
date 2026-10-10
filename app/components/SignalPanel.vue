<script setup lang="ts">
// =============================================================================
//  SignalPanel (S8 / roadmap 7T) — webhook alerts feed (collection `alerts`).
//
//  Read-only view of GET /api/v1/signals filtered by the active symbol.
//  Fail-soft contract: the API returns 200 + meta.mongo='down' + empty list
//  when Mongo is unreachable — we surface that as a badge, never as a crash.
//  Polls every 15s (signals arrive out-of-band from TradingView webhooks).
// =============================================================================
import type { SignalItem, SignalsListResponse } from '../../types/signals'
import { fmtSigned, fmtUtcTime, mongoTone, sideTone, signalTone } from '../utils/terminal'

const props = defineProps<{ symbol: string, reloadKey?: number }>()

const { t, te } = useI18n()

const items = ref<SignalItem[]>([])
const total = ref(0)
const mongo = ref<'up' | 'down'>('up')
const loading = ref(true)
const error = ref<string | null>(null)
const updatedAt = ref<number | null>(null)

const errorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { data?: { message?: string }; message?: string }
    return e.data?.message || e.message || 'request-failed'
  }
  return String(err)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<SignalsListResponse>('/api/v1/signals', {
      params: { symbol: props.symbol, limit: 20 }
    })
    items.value = res.data
    total.value = res.meta?.total ?? res.data.length
    mongo.value = res.meta?.mongo ?? 'up'
    updatedAt.value = Date.now()
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

watch(() => props.symbol, () => { void load() }, { immediate: true })
// TradeTicket bumps reloadKey after a successful POST — refresh without waiting
// for the 15s poll so the new alert shows up immediately.
watch(() => props.reloadKey, () => { void load() })
useIntervalFn(() => { void load() }, 15_000, { immediate: false })

const sideLabel = (side: string | null): string => {
  if (!side) return '—'
  const key = `trade.sides.${side}`
  return te(key) ? t(key) : side.toUpperCase()
}

const statusLabel = (status: string): string => {
  const key = `trade.st.${status}`
  return te(key) ? t(key) : status
}

const time = (iso: string): string => fmtUtcTime(iso)
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.signals') }}</h3>
      <div class="flex items-center gap-1.5">
        <UBadge v-if="mongo === 'down'" :color="mongoTone(mongo)" variant="subtle" size="sm">
          {{ t('trade.mongoDown') }}
        </UBadge>
        <span class="font-mono text-[10px] text-muted">{{ total }}</span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :aria-label="t('trade.refresh')"
          @click="load"
        />
      </div>
    </div>

    <div v-if="error" class="grid place-items-center gap-2 py-4 text-center">
      <UIcon name="i-lucide-triangle-alert" class="size-5 text-error" />
      <p class="max-w-[16rem] font-mono text-[11px] break-all text-error/80">{{ error }}</p>
      <UButton size="xs" color="primary" variant="soft" @click="load">{{ t('trade.retry') }}</UButton>
    </div>

    <div v-else-if="loading && !items.length" class="grid place-items-center gap-2 py-6">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
      <p class="text-xs text-muted">{{ t('trade.loadData') }}</p>
    </div>

    <div v-else-if="items.length" class="flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5">
      <div
        v-for="s in items"
        :key="s.id"
        class="flex flex-col gap-0.5 rounded-sm bg-elevated/40 px-2 py-1.5"
      >
        <div class="flex items-center gap-1.5 text-[11px]">
          <span class="font-mono text-muted">{{ time(s.ts) }}</span>
          <UBadge :color="sideTone(s.side)" variant="subtle" size="sm">
            {{ sideLabel(s.side) }}
          </UBadge>
          <span class="truncate text-default/80">{{ s.action ?? s.mode ?? '—' }}</span>
          <UBadge
            :color="signalTone(s.status)"
            variant="subtle"
            size="sm"
            class="ml-auto"
          >
            {{ statusLabel(s.status) }}
          </UBadge>
        </div>
        <div class="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted">
          <span v-if="s.price != null">
            <span class="text-muted/80">{{ t('trade.price') }}</span>
            {{ s.price }}
          </span>
          <span v-if="s.sl != null">
            <span class="text-muted/80">{{ t('trade.sl') }}</span>
            {{ s.sl }}
          </span>
          <span v-if="s.tps.length">
            <span class="text-muted/80">{{ t('trade.tp') }}</span>
            {{ s.tps[0] }}
          </span>
          <span v-if="s.conf != null">
            <span class="text-muted/80">{{ t('trade.conf') }}</span>
            {{ fmtSigned(s.conf, 2) }}
          </span>
          <span v-if="s.rejectReason" class="text-error/70">{{ s.rejectReason }}</span>
        </div>
      </div>
    </div>

    <p v-else class="py-6 text-center text-xs text-muted">{{ t('trade.signalsEmpty') }}</p>

    <span v-if="updatedAt" class="text-right font-mono text-[10px] text-muted/70">
      {{ fmtUtcTime(new Date(updatedAt).toISOString()) }}
    </span>
  </div>
</template>
