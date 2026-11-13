<script setup lang="ts">
// Signal / observation detail (V5.0 §3.2, §4). Read-only: evidence, provenance,
// times and lifecycle. No value is derived here — the record is shown as stored.
import type { NativeSignalItem } from '#shared/types/signals'
import type { FeedEvent } from '~/composables/useDashboardFeed'
import { freshnessOf } from '~/composables/useDashboardFeed'

const { t } = useI18n()
const overlay = useAppOverlay()
const { events } = useDashboardFeed()
const signalsApi = useNativeSignals()

const record = ref<NativeSignalItem | null>(null)
const loading = ref(false)
const error = ref('')

const open = computed({
  get: () => overlay.kind.value === 'signal',
  set: (value: boolean) => { if (!value) overlay.requestClose() }
})

const row = computed<FeedEvent | null>(() => {
  if (overlay.state.value?.kind !== 'signal') return null
  const id = overlay.state.value.payload.id
  return events.value.find(e => e.key === id) ?? null
})

const lifecycleColor = (status: string) =>
  status === 'active' ? 'success' : status === 'expired' ? 'warning' : status === 'invalidated' ? 'error' : 'neutral'

async function load() {
  const current = row.value
  record.value = null
  error.value = ''
  if (!current?.recordId || current.category !== 'indicator') return
  loading.value = true
  try {
    record.value = await signalsApi.get(current.recordId)
  } catch {
    error.value = t('dash.signal.detailFailed')
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => { if (isOpen) void load() })

const metaEntries = computed(() => {
  const meta = record.value?.meta
  if (!meta) return []
  return Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 12)
})

const fmtUtc = (iso: string | null | undefined) =>
  iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—'
</script>

<template>
  <LazyBaseResponsiveSlideover
    v-model:open="open"
    :title="row?.symbol ? `${row.symbol} · ${row.context}` : t('dash.signal.detail')"
    icon="i-lucide-radio"
    :loading="loading"
  >
    <div v-if="!row" class="p-4">
      <AdminEmptyState :title="t('dash.signal.notFound')" :description="t('dash.signal.notFoundHint')" icon="i-lucide-search-x" />
    </div>

    <div v-else class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge color="neutral" variant="subtle" size="sm" :label="t(`dash.signal.filter.${row.category}`)" />
        <UBadge color="neutral" variant="subtle" size="sm" :label="row.timeframe" />
        <UBadge
          :color="lifecycleColor(record?.lifecycleStatus ?? row.status)"
          variant="subtle"
          size="sm"
          :label="record?.lifecycleStatus ?? row.status"
        />
        <UBadge
          :color="row.category === 'news' ? 'info' : freshnessOf(row.detectedAt, row.category === 'indicator' ? 'signals' : 'intel') === 'fresh' ? 'success' : 'warning'"
          variant="subtle"
          size="sm"
          :label="t(`dash.freshness.${freshnessOf(row.detectedAt, row.category === 'indicator' ? 'signals' : 'intel')}`)"
        />
      </div>

      <UAlert v-if="error" color="warning" variant="subtle" :title="error" :description="t('dash.signal.detailFailedHint')" />

      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.detected') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ fmtUtc(row.detectedAt) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.source') }}</dt>
          <dd class="text-xs text-highlighted break-words">{{ row.method }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.price') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ record?.price ?? row.price ?? '—' }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.quality') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ row.quality ?? '—' }}</dd>
        </div>
        <div v-if="record?.expiresAt" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.expires') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ fmtUtc(record.expiresAt) }}</dd>
        </div>
        <div v-if="record" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.signal.recordId') }}</dt>
          <dd class="text-xs font-mono text-highlighted break-all">{{ record.id }}</dd>
        </div>
      </dl>

      <div v-if="record?.attribution" class="rounded border border-default/60 p-3 space-y-1.5">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted">{{ t('dash.signal.provenance') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <p class="text-[11px] text-toned"><span class="text-muted">method</span> {{ record.attribution.method }} {{ record.attribution.methodVersion }}</p>
          <p class="text-[11px] text-toned"><span class="text-muted">engine</span> {{ record.attribution.engineVersion }}</p>
          <p class="text-[11px] text-toned break-all"><span class="text-muted">paramsHash</span> {{ record.attribution.paramsHash }}</p>
          <p class="text-[11px] text-toned"><span class="text-muted">strategy</span> {{ record.attribution.strategyVersion }}</p>
        </div>
        <p v-if="record.attribution.indicatorRefs.length" class="text-[11px] text-muted">
          {{ t('dash.signal.indicators') }}:
          <span class="font-mono">{{ record.attribution.indicatorRefs.map(r => `${r.id}@${r.version}`).join(', ') }}</span>
        </p>
      </div>

      <div v-if="metaEntries.length" class="rounded border border-default/60 p-3">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{{ t('dash.signal.evidence') }}</h3>
        <dl class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div v-for="[key, value] in metaEntries" :key="key" class="min-w-0">
            <dt class="text-[10px] text-muted truncate">{{ key }}</dt>
            <dd class="text-[11px] font-mono text-highlighted truncate">{{ String(value) }}</dd>
          </div>
        </dl>
      </div>

      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('dash.signal.noEvidence')"
        :description="t('dash.signal.noEvidenceHint')"
      />

      <p v-if="record?.lifecycleNote" class="text-[11px] text-muted">
        {{ t('dash.signal.lifecycleNote') }}: {{ record.lifecycleNote }}
      </p>
    </div>
  </LazyBaseResponsiveSlideover>
</template>
