<script setup lang="ts">
import type { EvidenceSet } from '~~/types/research'
import { getErrorMessage } from '~/shared/utils/errors'

// Evidence Set detail (roadmap §59.15 Slice E).
//
// Opens one frozen set and re-verifies it: the stored hash is re-derived from the
// content, so a set edited after the freeze is reported as TAMPERED rather than
// quietly believed. Sufficiency is shown next to the metrics for the same reason
// — a set below the trade floor cannot support a claim (D12), and this page says
// so instead of printing a confident dashboard.
//
// Read-only by design: evidence is immutable. The only write anywhere near it is
// the append-only citation list on the experiments that used it.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const api = useResearch()

const setId = computed(() => String(route.params.id ?? ''))
const set = ref<EvidenceSet | null>(null)
const isLoading = ref(true)

async function load() {
  isLoading.value = true
  try {
    set.value = await api.evidenceSet(setId.value)
  } catch (err) {
    notify.error(t('research.sets.detail.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoading.value = false
  }
}
onMounted(load)

const title = computed(() => set.value?.setId || setId.value)
const description = computed(() =>
  set.value ? `${t(`research.sets.kinds.${set.value.kind}`)} · ${set.value.sourceId}` : setId.value)

const trail = computed(() => [
  { label: t('nav.data_research') },
  { label: t('research.sets.title'), to: '/data-research/research/evidence' },
  { label: setId.value }
])

const integrityOk = computed(() => set.value?.integrity?.ok === true)
const sufficient = computed(() => set.value?.sufficiency?.sufficient === true)

// G8.3: frozen evidence must be shippable, not just viewable. The endpoint
// answers with a self-contained JSON bundle (attachment), so a second party can
// re-verify the hash offline — including when this dashboard is gone.
const exportUrl = computed(() => `/api/v1/research/evidence-sets/${encodeURIComponent(setId.value)}/export`)

const metrics = computed(() => {
  const s = set.value
  if (!s) return []
  return [
    {
      key: 'integrity',
      label: t('research.sets.detail.integrity'),
      value: integrityOk.value ? t('research.sets.detail.verified') : (s.integrity?.code || '—'),
      icon: integrityOk.value ? 'i-lucide-shield-check' : 'i-lucide-shield-alert',
      tone: integrityOk.value ? 'success' as const : 'error' as const
    },
    {
      key: 'sufficiency',
      label: t('research.sets.detail.sufficiency'),
      value: sufficient.value ? t('research.sufficient') : t('research.insufficientSample'),
      icon: sufficient.value ? 'i-lucide-check-circle' : 'i-lucide-triangle-alert',
      tone: sufficient.value ? 'success' as const : 'warning' as const
    },
    {
      key: 'trades',
      label: t('research.sets.metrics.trades'),
      value: String(s.metrics?.trades ?? 0),
      icon: 'i-lucide-list-ordered'
    },
    {
      key: 'rMeasured',
      label: t('research.sets.metrics.rMeasured'),
      value: `${s.metrics?.rMeasured ?? 0} / ${s.metrics?.minTrades ?? 0}`,
      icon: 'i-lucide-ruler'
    }
  ]
})

const fmtDate = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—')
const fmtNum = (v: number | null | undefined, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—')
const fmtPct = (v: number | null | undefined) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

const sampleRows = computed(() => {
  const m = set.value?.metrics
  if (!m) return []
  return [
    { key: 'trades', label: t('research.sets.metrics.trades'), value: String(m.trades) },
    { key: 'wins', label: t('research.sets.metrics.wins'), value: String(m.wins) },
    { key: 'losses', label: t('research.sets.metrics.losses'), value: String(m.losses) },
    { key: 'winRate', label: t(`research.metrics.winRate`), value: fmtPct(m.winRate) },
    { key: 'expectancyR', label: t('research.sets.metrics.expectancy'), value: `${fmtNum(m.expectancyR, 3)}R` },
    { key: 'totalR', label: t('research.sets.metrics.totalR'), value: `${fmtNum(m.totalR, 2)}R` },
    { key: 'netPnlAbs', label: t('research.sets.metrics.net'), value: fmtNum(m.netPnlAbs) },
    { key: 'floor', label: t('research.sets.metrics.floor'), value: String(m.minTrades) }
  ]
})

const identityRows = computed(() => {
  const s = set.value
  if (!s) return []
  return [
    { key: 'setId', label: t('research.sets.detail.setId'), value: s.setId || s._id, mono: true },
    { key: 'kind', label: t('research.sets.columns.kind'), value: t(`research.sets.kinds.${s.kind}`) },
    { key: 'sourceId', label: t('research.sets.detail.sourceId'), value: s.sourceId, mono: true },
    { key: 'sessionId', label: t('research.sets.detail.sessionId'), value: s.sessionId || '—', mono: true },
    { key: 'state', label: t('research.sets.detail.sourceState'), value: s.state || '—' },
    { key: 'strategyVersionId', label: t('research.detail.strategyVersionLabel'), value: s.strategyVersionId || '—', mono: true },
    { key: 'accountId', label: t('sessions.account'), value: s.accountId || '—' },
    { key: 'instrument', label: t('research.sets.detail.instruments'), value: s.instruments?.join(', ') || '—', mono: true },
    { key: 'timeframes', label: t('research.sets.detail.timeframes'), value: s.timeframes?.join(', ') || '—', mono: true },
    { key: 'frozenAt', label: t('research.sets.columns.frozen'), value: fmtDate(s.pointInTime?.frozenAt) },
    { key: 'startedAt', label: t('research.sets.detail.sessionStartedAt'), value: fmtDate(s.pointInTime?.sessionStartedAt) },
    { key: 'stoppedAt', label: t('research.sets.detail.sessionStoppedAt'), value: fmtDate(s.pointInTime?.sessionStoppedAt) },
    { key: 'createdBy', label: t('research.sets.detail.createdBy'), value: s.createdBy || '—' },
    { key: 'schemaVersion', label: t('research.sets.detail.schemaVersion'), value: s.schemaVersion, mono: true }
  ]
})

const counts = computed(() => {
  const c = set.value?.counts
  return [
    { key: 'orders', label: t('sessions.ordersTab'), value: String(c?.orders ?? 0) },
    { key: 'fills', label: t('sessions.fillsTab'), value: String(c?.fills ?? 0) },
    { key: 'trades', label: t('research.sets.metrics.trades'), value: String(c?.trades ?? 0) }
  ]
})

const trades = computed(() => (set.value?.trades ?? []).slice(0, 200))

const citedBy = computed(() => set.value?.usedByExperimentIds ?? [])

const openExperiment = (id: string) =>
  navigateTo(`/data-research/research/experiments/${encodeURIComponent(id)}`)

const openSource = computed(() => {
  const s = set.value
  if (!s) return null
  if (s.kind === 'paper-session' || s.kind === 'replay-session') {
    const id = s.sessionId || s.sourceId
    return id ? `/sessions/${encodeURIComponent(id)}` : null
  }
  if (s.kind === 'backtest-run') return `/test-center/runs/${encodeURIComponent(s.sourceId)}`
  if (s.kind === 'dataset') return `/data-research/data/datasets`
  return null
})

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="research-evidence-detail" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('research.pips.evidence')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          v-if="set"
          icon="i-lucide-download"
          :label="t('research.sets.detail.exportBundle')"
          variant="soft"
          color="primary"
          size="sm"
          :to="exportUrl"
          target="_blank"
          external
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          v-if="openSource"
          icon="i-lucide-layers"
          :label="set?.kind === 'dataset' ? t('research.sets.detail.openDatasets') : t('research.sets.detail.openSource')"
          variant="soft"
          color="neutral"
          size="sm"
          :to="openSource"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-arrow-left"
          :label="t('research.sets.title')"
          variant="ghost"
          color="neutral"
          size="sm"
          to="/data-research/research/evidence"
        />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="load" />
      </div>
    </template>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
    </div>

    <div v-else-if="!set" class="py-6">
      <AdminEmptyState :title="t('research.sets.detail.noSet')" :description="setId" icon="i-lucide-lock" />
    </div>

    <div v-else class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />

      <!-- Integrity: the whole reason this document is hashed -->
      <UAlert
        :color="integrityOk ? 'success' : 'error'"
        variant="subtle"
        :icon="integrityOk ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
        :title="integrityOk ? t('research.sets.detail.integrityOk') : t('research.sets.detail.integrityFailed')"
        :description="`${t('research.sets.columns.hash')}: ${set.hash}`"
      />

      <UAlert
        :color="sufficient ? 'success' : 'warning'"
        variant="subtle"
        :icon="sufficient ? 'i-lucide-check-circle' : 'i-lucide-triangle-alert'"
        :title="sufficient ? t('research.sufficient') : t('research.insufficientSample')"
        :description="(set.sufficiency?.reasons ?? []).join(' · ') || undefined"
      />

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <!-- Identity -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('research.sets.detail.identity') }}</h3>
            </div>
          </template>
          <dl class="flex flex-col divide-y divide-default/40">
            <div v-for="row in identityRows" :key="row.key" class="flex items-start justify-between gap-3 py-1.5 text-xs">
              <dt class="text-muted shrink-0">{{ row.label }}</dt>
              <dd class="text-highlighted text-right break-all" :class="row.mono ? 'font-mono text-[11px]' : ''">{{ row.value }}</dd>
            </div>
          </dl>
        </UCard>

        <div class="flex flex-col gap-6">
          <!-- Sample -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-calculator" class="w-4 h-4 text-primary" />
                  <h3 class="font-semibold text-sm">{{ t('research.sets.detail.sample') }}</h3>
                </div>
                <UBadge
                  v-if="set.sealed === false"
                  :label="t('research.sets.detail.moving')"
                  color="warning"
                  variant="subtle"
                  size="xs"
                />
              </div>
            </template>
            <dl class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
              <div v-for="row in sampleRows" :key="row.key" class="min-w-0">
                <dt class="text-[10px] text-muted uppercase tracking-wider truncate">{{ row.label }}</dt>
                <dd class="text-xs font-mono text-highlighted">{{ row.value }}</dd>
              </div>
            </dl>
          </UCard>

          <!-- Frozen counts -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-package-check" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('research.sets.detail.counts') }}</h3>
              </div>
            </template>
            <MetricRibbon :items="counts" cols="grid-cols-3" />

            <div class="mt-4 pt-4 border-t border-default space-y-2 text-xs">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">{{ t('research.sets.detail.dataQuality') }}</span>
                <UBadge :label="set.dataQuality?.state || 'unknown'" color="neutral" variant="subtle" size="xs" />
              </div>
              <div class="flex items-start justify-between gap-3">
                <span class="text-muted shrink-0">{{ t('nav.datasets') }}</span>
                <span class="font-mono text-[11px] text-highlighted text-right break-all">
                  {{ set.dataQuality?.datasets?.join(', ') || '—' }}
                </span>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- Limitations: why a reader could NOT conclude something -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-triangle-alert" class="w-4 h-4 text-warning" />
            <h3 class="font-semibold text-sm">{{ t('research.sets.detail.limitations') }}</h3>
            <UBadge :label="String(set.limitations?.length ?? 0)" variant="subtle" size="xs" />
          </div>
        </template>
        <ul v-if="set.limitations?.length" class="space-y-1.5 text-xs text-muted list-disc list-inside">
          <li v-for="(l, i) in set.limitations" :key="i">{{ l }}</li>
        </ul>
        <span v-else class="text-xs text-dimmed">{{ t('research.sets.detail.noLimitations') }}</span>
      </UCard>

      <!-- Cited by -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-flask-conical" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('research.sets.detail.citedBy') }}</h3>
            <UBadge :label="String(citedBy.length)" variant="subtle" size="xs" />
          </div>
        </template>
        <div v-if="citedBy.length" class="flex flex-wrap gap-1.5">
          <UButton
            v-for="id in citedBy"
            :key="id"
            :label="id"
            size="xs"
            color="primary"
            variant="soft"
            class="font-mono"
            @click="openExperiment(id)"
          />
        </div>
        <span v-else class="text-xs text-dimmed">{{ t('research.sets.detail.citedByEmpty') }}</span>
      </UCard>

      <!-- Frozen trades -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-list-ordered" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('research.sets.detail.trades') }}</h3>
            </div>
            <span class="text-[11px] text-dimmed">{{ set.metrics?.rMeasured ?? 0 }} R-measured</span>
          </div>
        </template>

        <div v-if="trades.length" class="overflow-x-auto">
          <table class="w-full text-xs min-w-[760px]">
            <thead class="bg-muted/50">
              <tr class="text-left text-dimmed">
                <th class="font-medium py-1 pe-3">{{ t('research.sets.trade.key') }}</th>
                <th class="font-medium py-1 px-2">{{ t('research.sets.trade.symbol') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.sets.trade.entry') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.sets.trade.exit') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.sets.trade.r') }}</th>
                <th class="font-medium py-1 ps-2">{{ t('research.sets.trade.reason') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tr in trades" :key="tr.key" class="border-t border-default">
                <td class="py-1 pe-3 font-mono text-[11px] text-muted truncate max-w-56">{{ tr.key }}</td>
                <td class="py-1 px-2">
                  <span class="font-mono text-highlighted">{{ tr.symbol }}</span>
                  <UBadge
                    v-if="tr.dir"
                    :label="tr.dir === 1 ? 'LONG' : 'SHORT'"
                    :color="tr.dir === 1 ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                    class="ms-1.5"
                  />
                </td>
                <td class="py-1 px-2 text-right font-mono text-muted">{{ fmtNum(tr.entryPrice) }}</td>
                <td class="py-1 px-2 text-right font-mono text-muted">{{ tr.exitPrice === null ? '—' : fmtNum(tr.exitPrice) }}</td>
                <td
                  class="py-1 px-2 text-right font-mono"
                  :class="(tr.rMultiple ?? 0) > 0 ? 'text-success' : (tr.rMultiple ?? 0) < 0 ? 'text-error' : 'text-dimmed'"
                >
                  {{ tr.rMultiple === null ? '—' : `${fmtNum(tr.rMultiple, 3)}R` }}
                </td>
                <td class="py-1 ps-2 text-[11px] text-muted truncate">{{ tr.exitReason || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <AdminEmptyState v-else :title="t('research.sets.detail.noTrades')" icon="i-lucide-list-ordered" />
      </UCard>
    </div>
  </BasePage>
</template>
