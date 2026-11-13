<script setup lang="ts">
// Control Center (V5.0 §5) — ONE slideover for sources, providers, alerts,
// retention, settings and diagnostics, plus real service control.
//
// Every control action goes through the operations API: the command is ACCEPTED
// (202 + operationId) and then polled to a terminal state. The UI never flips a
// state badge from a click, and it never treats a PID as READY.
import type { OperationsServiceRow } from '#shared/types/operations'
import type { MarketSourceHealth } from '#shared/types/health'
import type { NewsSourcePublic } from '#shared/types/news'
import type { AiProviderConnectionRow, AiProvidersResponse } from '~/types/aiProviders'
import type { AlertRule } from '#shared/types/alertRules'
import type { Dataset } from '#shared/types/data'
import type { ControlCenterSection } from '~/composables/useAppOverlay'
import { SERVICE_ACTIONS_UI, isActionDisabled, type ServiceActionId } from '~/utils/serviceActions'
import { runServiceOperation } from '~/utils/serviceOperation'
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const overlay = useAppOverlay()
const notify = useNotify()
const operationsApi = useOperations()
const healthApi = useSystemHealth()
const alertApi = useAlertRules()
const { services, serviceSummary, health, loadServices } = useDashboardFeed()

const open = computed({
  get: () => overlay.kind.value === 'control',
  set: (value: boolean) => { if (!value) overlay.requestClose() }
})

const section = computed<ControlCenterSection>({
  get: () => (overlay.state.value?.kind === 'control' ? overlay.state.value.payload.section ?? 'services' : 'services'),
  set: (value) => {
    if (overlay.state.value?.kind !== 'control') return
    overlay.open('control', { section: value })
  }
})

const sections: Array<{ key: ControlCenterSection, icon: string }> = [
  { key: 'services', icon: 'i-lucide-server' },
  { key: 'sources', icon: 'i-lucide-database' },
  { key: 'ai', icon: 'i-lucide-cpu' },
  { key: 'alerts', icon: 'i-lucide-bell' },
  { key: 'storage', icon: 'i-lucide-hard-drive' },
  { key: 'settings', icon: 'i-lucide-settings' },
  { key: 'diagnostics', icon: 'i-lucide-stethoscope' }
]

// --- Services ---------------------------------------------------------------
const running = ref<string | null>(null)

const stateColor = (state: string) =>
  state === 'READY' ? 'success' : state === 'DEGRADED' ? 'warning' : state === 'FAILED' ? 'error' : state === 'STARTING' || state === 'STOPPING' ? 'info' : 'neutral'

function actionsFor(row: OperationsServiceRow) {
  return SERVICE_ACTIONS_UI
    .filter(entry => (row.supports ?? []).includes(entry.action))
    .filter(entry => entry.group === 'control')
    .map(entry => ({
      label: t(`operations.services.actions.${entry.action}`),
      icon: entry.icon,
      disabled: isActionDisabled(row, entry.action),
      onSelect: () => { void runAction(row, entry.action) }
    }))
}

async function runAction(row: OperationsServiceRow, action: ServiceActionId) {
  running.value = row.serviceId
  try {
    const result = await runServiceOperation({
      serviceId: row.serviceId,
      action,
      request: (serviceId, act) => operationsApi.command(serviceId, act),
      fetchOperation: operationId => operationsApi.operation(operationId),
      onAccepted: () => notify.info(t('operations.services.result.accepted'), row.label)
    })
    if (result.state === 'SUCCEEDED') notify.success(t('operations.services.result.succeeded'), row.label)
    else if (result.state === 'UNCONFIRMED') notify.warning(t('operations.services.result.unconfirmed'), row.label)
    else if (result.state !== 'CANCELLED') notify.error(t('operations.services.result.failed'), result.error || row.label)
  } catch {
    notify.error(t('operations.services.result.rejected'), row.label)
  } finally {
    running.value = null
    await loadServices()
  }
}

// --- Sources ----------------------------------------------------------------
const venues = ref<MarketSourceHealth[]>([])
const newsSources = ref<NewsSourcePublic[]>([])
const sourcesLoading = ref(false)

async function loadSources() {
  sourcesLoading.value = true
  try {
    const [venueRes, newsRes] = await Promise.all([
      healthApi.marketSources().catch(() => null),
      $fetch<{ sources: NewsSourcePublic[] }>('/api/v1/news/sources').catch(() => null)
    ])
    venues.value = venueRes?.data ?? []
    newsSources.value = newsRes?.sources ?? []
  } finally {
    sourcesLoading.value = false
  }
}

// --- AI providers -----------------------------------------------------------
const providers = ref<AiProvidersResponse | null>(null)
const aiLoading = ref(false)
const testing = ref<string | null>(null)

async function loadProviders() {
  aiLoading.value = true
  try {
    const res = await $fetch<{ data: AiProvidersResponse }>('/api/v1/ai/providers')
    providers.value = res?.data ?? null
  } catch {
    providers.value = null
  } finally {
    aiLoading.value = false
  }
}

/** Explicit, bounded: only runs when the operator asks for it. */
async function testConnection(row: AiProviderConnectionRow) {
  testing.value = row.id
  try {
    await $fetch(`/api/v1/ai/providers/connections/${encodeURIComponent(row.id)}/test`, { method: 'POST' })
    notify.success(t('dash.control.ai.tested'), row.name)
    await loadProviders()
  } catch {
    notify.error(t('dash.control.ai.testFailed'), row.name)
  } finally {
    testing.value = null
  }
}

// --- Storage ----------------------------------------------------------------
// Real evidence only: the dataset retention manifest (count, retention window,
// suspect flag). The API exposes no byte-level size, so none is shown.
const dataCenter = useDataCenter()
const datasets = ref<Dataset[]>([])
const storageLoading = ref(false)

async function loadStorage() {
  storageLoading.value = true
  try {
    datasets.value = await dataCenter.datasets({ limit: 200 })
  } finally {
    storageLoading.value = false
  }
}

/** Per-kind rollup of the manifest — datasets, stored rows, retention window. */
const storageSummary = computed(() => {
  const byKind = new Map<string, { datasets: number, rows: number, minRetention: number, maxRetention: number, suspect: number }>()
  for (const row of datasets.value) {
    const key = row.kind || 'unknown'
    const entry = byKind.get(key) ?? { datasets: 0, rows: 0, minRetention: row.retentionDays, maxRetention: row.retentionDays, suspect: 0 }
    entry.datasets += 1
    entry.rows += row.count ?? 0
    entry.minRetention = Math.min(entry.minRetention, row.retentionDays)
    entry.maxRetention = Math.max(entry.maxRetention, row.retentionDays)
    if (row.suspect) entry.suspect += 1
    byKind.set(key, entry)
  }
  return [...byKind.entries()]
    .map(([kind, entry]) => ({ kind, ...entry }))
    .sort((a, b) => b.rows - a.rows)
})

const suspectDatasets = computed(() => datasets.value.filter(row => row.suspect).length)

// --- Alerts -----------------------------------------------------------------
const rules = ref<AlertRule[]>([])
const rulesLoading = ref(false)

async function loadRules() {
  rulesLoading.value = true
  try {
    rules.value = (await alertApi.list()).items
  } finally {
    rulesLoading.value = false
  }
}

// --- Diagnostics ------------------------------------------------------------
const diagnostics = ref<Awaited<ReturnType<ReturnType<typeof useSystemHealth>['system']>>['data'] | null>(null)

async function loadDiagnostics() {
  try {
    diagnostics.value = (await healthApi.system()).data
  } catch {
    diagnostics.value = null
  }
}

const loaded = new Set<ControlCenterSection>()

async function loadSection(key: ControlCenterSection) {
  if (loaded.has(key)) return
  loaded.add(key)
  if (key === 'sources') await loadSources()
  else if (key === 'ai') await loadProviders()
  else if (key === 'alerts') await loadRules()
  else if (key === 'storage') await loadStorage()
  else if (key === 'diagnostics') await loadDiagnostics()
}

watch([open, section], ([isOpen, key]) => {
  if (!isOpen) return
  if (key === 'services') void loadServices()
  else void loadSection(key)
}, { immediate: true })

const providerEnv = computed(() => providers.value?.env ?? null)
const fmtUtc = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—')
</script>

<template>
  <LazyBaseResponsiveSlideover
    v-model:open="open"
    :title="t('dash.control.title')"
    icon="i-lucide-settings-2"
    :ui="{ content: 'w-screen max-w-3xl flex flex-col' }"
  >
    <div class="space-y-3">
      <div class="flex gap-1 overflow-x-auto pb-1" role="tablist">
        <UButton
          v-for="item in sections"
          :key="item.key"
          :icon="item.icon"
          :label="t(`dash.control.tabs.${item.key}`)"
          size="xs"
          :color="section === item.key ? 'primary' : 'neutral'"
          :variant="section === item.key ? 'soft' : 'ghost'"
          role="tab"
          :aria-selected="section === item.key"
          @click="section = item.key"
        />
      </div>

      <!-- SERVICES -->
      <div v-if="section === 'services'" class="space-y-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge v-if="serviceSummary" color="neutral" variant="subtle" size="xs" :label="`${t('operations.services.summary.total')} ${serviceSummary.total}`" />
          <UBadge v-if="serviceSummary" color="success" variant="subtle" size="xs" :label="`${t('operations.services.summary.ready')} ${serviceSummary.ready}`" />
          <UBadge v-if="serviceSummary" color="warning" variant="subtle" size="xs" :label="`${t('operations.services.summary.degraded')} ${serviceSummary.degraded}`" />
          <UBadge v-if="serviceSummary" color="error" variant="subtle" size="xs" :label="`${t('operations.services.summary.failed')} ${serviceSummary.failed}`" />
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" :aria-label="t('common.refresh')" @click="loadServices" />
        </div>

        <p class="text-[11px] text-muted">{{ t('dash.control.services.note') }}</p>

        <AdminEmptyState v-if="!services.length" :title="t('dash.control.services.empty')" :description="t('dash.control.services.emptyHint')" icon="i-lucide-server" />

        <ul v-else class="divide-y divide-default/60">
          <li v-for="row in services" :key="row.serviceId" class="py-2">
            <div class="flex items-start gap-2 min-w-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-xs font-medium text-highlighted truncate">{{ row.label }}</span>
                  <UBadge :color="stateColor(row.observed)" variant="subtle" size="xs" :label="t(`operations.services.state.${row.observed}`)" />
                  <UBadge color="neutral" variant="outline" size="xs" :label="t(`operations.services.health.${row.health}`)" />
                  <UBadge v-if="row.drift" color="error" variant="outline" size="xs" :label="t('operations.services.flags.drift')" />
                </div>
                <p class="mt-0.5 text-[11px] text-muted truncate">
                  <span class="font-mono">{{ row.serviceId }}</span>
                  · {{ t('operations.services.columns.desired') }} {{ t(`operations.services.desired.${row.desired}`) }}
                  · {{ t('operations.services.columns.heartbeat') }}
                  {{ row.lastHeartbeatAt ? formatTimeAgo(new Date(row.lastHeartbeatAt)) : t('operations.services.neverStarted') }}
                  <span v-if="row.restartCount"> · {{ t('dash.control.services.restarts') }} {{ row.restartCount }}</span>
                </p>
                <p v-if="row.lastError" class="mt-0.5 text-[11px] text-error line-clamp-1">{{ row.lastError }}</p>
              </div>
              <UIcon v-if="running === row.serviceId" name="i-lucide-loader-circle" class="size-4 animate-spin text-primary shrink-0" />
              <UDropdownMenu v-else :items="[actionsFor(row)]" :popper="{ placement: 'bottom-end' }">
                <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" :aria-label="t('operations.services.openMenu')" />
              </UDropdownMenu>
            </div>
          </li>
        </ul>
      </div>

      <!-- DATA SOURCES -->
      <div v-else-if="section === 'sources'" class="space-y-3">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-highlighted">{{ t('dash.control.sources.venues') }}</h3>
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" :aria-label="t('common.refresh')" @click="loadSources" />
        </div>
        <div v-if="sourcesLoading" class="space-y-1"><USkeleton v-for="n in 4" :key="n" class="h-6 w-full" /></div>
        <ul v-else class="divide-y divide-default/60">
          <li v-for="v in venues" :key="v.venue" class="flex items-center gap-2 py-1.5">
            <span class="text-xs font-medium text-highlighted w-24 truncate">{{ v.venue }}</span>
            <UBadge :color="v.status === 'up' ? 'success' : v.status === 'down' ? 'error' : 'neutral'" variant="subtle" size="xs" :label="v.status" />
            <span class="text-[11px] text-muted">{{ v.latencyMs != null ? `${v.latencyMs}ms` : '—' }}</span>
            <span class="text-[11px] text-dimmed ms-auto">{{ v.instruments }} {{ t('dash.control.sources.instruments') }}</span>
          </li>
        </ul>

        <h3 class="text-xs font-semibold text-highlighted pt-2">{{ t('dash.control.sources.news') }}</h3>
        <ul class="divide-y divide-default/60">
          <li v-for="s in newsSources" :key="s.sourceId" class="py-1.5 min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs text-highlighted truncate">{{ s.name }}</span>
              <UBadge :color="s.health.state === 'up' ? 'success' : s.health.state === 'down' ? 'error' : 'neutral'" variant="subtle" size="xs" :label="s.health.state" />
              <UBadge v-if="!s.enabled" color="neutral" variant="outline" size="xs" :label="t('common.inactive')" />
              <UBadge color="neutral" variant="subtle" size="xs" :label="s.licenseStatus" />
              <span class="text-[11px] text-muted ms-auto">{{ s.pollIntervalSec }}s</span>
            </div>
            <p class="text-[10px] text-muted truncate">
              {{ t('dash.control.sources.lastOk') }} {{ fmtUtc(s.health.lastOkAt) }}
              <span v-if="s.health.lastError" class="text-error"> · {{ s.health.lastError }}</span>
            </p>
          </li>
        </ul>
      </div>

      <!-- AI PROVIDERS -->
      <div v-else-if="section === 'ai'" class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            v-if="providerEnv"
            :color="providerEnv.configured ? 'success' : 'neutral'"
            variant="subtle"
            size="xs"
            :label="providerEnv.configured ? `${providerEnv.provider} · ${providerEnv.model}` : t('dash.briefing.aiNotConfigured')"
          />
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" :aria-label="t('common.refresh')" @click="loadProviders" />
        </div>
        <p class="text-[11px] text-muted">{{ t('dash.control.ai.note') }}</p>
        <div v-if="aiLoading" class="space-y-1"><USkeleton v-for="n in 3" :key="n" class="h-8 w-full" /></div>
        <AdminEmptyState v-else-if="!providers?.connections.length" :title="t('dash.control.ai.empty')" :description="t('dash.control.ai.emptyHint')" icon="i-lucide-cpu" />
        <ul v-else class="divide-y divide-default/60">
          <li v-for="c in providers.connections" :key="c.id" class="flex items-start gap-2 py-1.5 min-w-0">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-xs font-medium text-highlighted truncate">{{ c.name }}</span>
                <UBadge color="neutral" variant="subtle" size="xs" :label="c.provider" />
                <UBadge :color="c.enabled ? 'success' : 'neutral'" variant="subtle" size="xs" :label="c.enabled ? t('common.active') : t('common.inactive')" />
                <UBadge color="neutral" variant="outline" size="xs" :label="c.hasSecret ? c.secretMask : t('dash.control.ai.noKey')" />
              </div>
              <p class="text-[11px] text-muted truncate">
                {{ c.model }}
                <span v-if="c.lastTestedAt"> · {{ t('dash.control.ai.lastTested') }} {{ formatTimeAgo(new Date(c.lastTestedAt)) }}</span>
                <span v-if="c.lastError" class="text-error"> · {{ c.lastError }}</span>
              </p>
            </div>
            <UButton
              icon="i-lucide-plug-zap"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="testing === c.id"
              :aria-label="t('dash.control.ai.test')"
              @click="testConnection(c)"
            />
          </li>
        </ul>
      </div>

      <!-- ALERTS -->
      <div v-else-if="section === 'alerts'" class="space-y-2">
        <div class="flex items-center gap-2">
          <UBadge color="neutral" variant="subtle" size="xs" :label="String(rules.length)" />
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" :aria-label="t('common.refresh')" @click="loadRules" />
        </div>
        <p class="text-[11px] text-muted">{{ t('dash.control.alerts.note') }}</p>
        <div v-if="rulesLoading" class="space-y-1"><USkeleton v-for="n in 3" :key="n" class="h-8 w-full" /></div>
        <AdminEmptyState v-else-if="!rules.length" :title="t('dash.control.alerts.empty')" :description="t('dash.control.alerts.emptyHint')" icon="i-lucide-bell" />
        <ul v-else class="divide-y divide-default/60">
          <li v-for="r in rules" :key="r._id" class="py-1.5 min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs text-highlighted truncate">{{ r.name }}</span>
              <UBadge :color="r.enabled ? 'success' : 'neutral'" variant="subtle" size="xs" :label="r.enabled ? t('common.active') : t('common.inactive')" />
              <UBadge color="neutral" variant="subtle" size="xs" :label="`${r.kind} · ${r.minLevel}`" />
              <UBadge color="neutral" variant="outline" size="xs" :label="r.priority" />
            </div>
            <p class="text-[11px] text-muted truncate">
              {{ t('dash.control.alerts.matches') }} {{ r.stats.matches }} · {{ t('dash.control.alerts.notified') }} {{ r.stats.notified }}
              <span v-if="r.stats.lastMatchAt"> · {{ formatTimeAgo(new Date(r.stats.lastMatchAt)) }}</span>
            </p>
          </li>
        </ul>
        <UButton :label="t('dash.control.alerts.manage')" color="neutral" variant="ghost" size="xs" to="/alerts" />
      </div>

      <!-- STORAGE -->
      <div v-else-if="section === 'storage'" class="space-y-3">
        <p class="text-[11px] text-muted">{{ t('dash.control.storage.note') }}</p>

        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-highlighted">{{ t('dash.control.storage.datasets') }}</h3>
          <UBadge v-if="suspectDatasets" color="warning" variant="subtle" size="xs"
            :label="`${suspectDatasets} ${t('dash.control.storage.suspect')}`" />
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs"
            :aria-label="t('common.refresh')" @click="loadStorage" />
        </div>

        <div v-if="storageLoading" class="space-y-1"><USkeleton v-for="n in 3" :key="n" class="h-6 w-full" /></div>
        <p v-else-if="!storageSummary.length" class="text-[11px] text-dimmed">{{ t('dash.control.storage.noDatasets') }}</p>
        <ul v-else class="divide-y divide-default/60">
          <li v-for="row in storageSummary" :key="row.kind" class="flex flex-wrap items-center gap-2 py-1.5">
            <span class="text-xs font-mono text-highlighted w-28 truncate">{{ row.kind }}</span>
            <UBadge color="neutral" variant="subtle" size="xs" :label="`${row.datasets} ${t('dash.control.storage.files')}`" />
            <span class="text-[11px] text-muted">{{ row.rows.toLocaleString() }} {{ t('dash.control.storage.rows') }}</span>
            <span class="text-[11px] text-dimmed ms-auto">
              {{ row.minRetention === row.maxRetention ? row.minRetention : `${row.minRetention}–${row.maxRetention}` }}
              {{ t('dash.control.storage.days') }}
            </span>
          </li>
        </ul>

        <h3 class="text-xs font-semibold text-highlighted pt-1">{{ t('dash.control.storage.news') }}</h3>
        <ul class="divide-y divide-default/60">
          <li v-for="s in newsSources" :key="`ret-${s.sourceId}`" class="flex items-center gap-2 py-1.5">
            <span class="text-xs text-highlighted truncate flex-1">{{ s.name }}</span>
            <UBadge color="neutral" variant="subtle" size="xs" :label="`${s.retentionDays} ${t('dash.control.storage.days')}`" />
          </li>
        </ul>

        <p class="text-[10px] text-dimmed">{{ t('dash.control.storage.sizeNote') }}</p>
        <UButton :label="t('dash.control.storage.open')" color="neutral" variant="ghost" size="xs" to="/data-research/data" />
      </div>

      <!-- SETTINGS -->
      <div v-else-if="section === 'settings'" class="space-y-2">
        <p class="text-[11px] text-muted">{{ t('dash.control.settings.note') }}</p>
        <div class="flex flex-col gap-1">
          <UButton :label="t('dash.control.settings.app')" icon="i-lucide-sliders-horizontal" color="neutral" variant="ghost" size="sm" to="/admin-system/settings" class="justify-start" />
          <UButton :label="t('dash.control.settings.profile')" icon="i-lucide-user-circle" color="neutral" variant="ghost" size="sm" to="/admin-system/profile" class="justify-start" />
          <UButton :label="t('dash.control.settings.hub')" icon="i-lucide-link" color="neutral" variant="ghost" size="sm" to="/admin-system/hub-integration" class="justify-start" />
          <UButton :label="t('dash.control.settings.routes')" icon="i-lucide-route" color="neutral" variant="ghost" size="sm" to="/admin-system/routes" class="justify-start" />
        </div>
      </div>

      <!-- DIAGNOSTICS -->
      <div v-else class="space-y-2">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-highlighted">{{ t('dash.control.diagnostics.title') }}</h3>
          <UButton class="ms-auto" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs" :aria-label="t('common.refresh')" @click="loadDiagnostics" />
        </div>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.status') }}</dt>
            <dd class="text-xs text-highlighted">{{ diagnostics?.status ?? health?.status ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.db') }}</dt>
            <dd class="text-xs text-highlighted">{{ diagnostics?.db ?? health?.db ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.version') }}</dt>
            <dd class="text-xs font-mono text-highlighted">{{ diagnostics?.version ?? health?.version ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.uptime') }}</dt>
            <dd class="text-xs font-mono text-highlighted">
              {{ diagnostics ? `${Math.round(diagnostics.uptimeSec / 60)}m` : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.latency') }}</dt>
            <dd class="text-xs font-mono text-highlighted">{{ diagnostics ? `${diagnostics.latencyMs}ms` : '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.control.diagnostics.time') }}</dt>
            <dd class="text-xs font-mono text-highlighted">{{ fmtUtc(diagnostics?.time) }}</dd>
          </div>
        </dl>
        <p class="text-[11px] text-muted">{{ t('dash.control.diagnostics.note') }}</p>
        <UButton :label="t('dash.control.diagnostics.logs')" color="neutral" variant="ghost" size="xs" to="/admin-system/logs" />
      </div>
    </div>
  </LazyBaseResponsiveSlideover>
</template>
