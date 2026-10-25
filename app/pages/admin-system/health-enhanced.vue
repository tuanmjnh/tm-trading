<script setup lang="ts">
import type { AiAgent, AiAgentsStatus } from '#shared/types/ai'
import type { BotInstance } from '#shared/types/bots'
import type { MarketSourceHealth } from '#shared/types/health'
import type { IntelData, IntelServiceRow } from '#shared/types/intel'
import type { RiskStatusData } from '#shared/types/risk'
import type { SignalItem } from '#shared/types/signals'
import { formatTimeAgo } from '@vueuse/core'

// =============================================================================
//  System Health Dashboard — one screen over the real runtime: D9 service
//  heartbeats, bot instances, webhook alerts, AI agents, market-source probes
//  and the risk gate.
//
//  Read-only by contract (D1): every number is an API/database read, never a
//  recomputation. All reads go through the typed composables (fail-soft) so a
//  store blip yields an empty section instead of a stack trace.
// =============================================================================

const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'healthEnhanced.title',
  descKey: 'healthEnhanced.desc'
})
useHead({ title })

const health = useSystemHealth()
const botsApi = useBots()
const healthApi = useSystemHealth()
const signalsApi = useSignals()
const agentsApi = useAiAgents()
const intelApi = useIntel()
const riskApi = useRisk()

const loading = ref(true)
/** Ticks on every refresh so interval-based freshness stays reactive. */
const now = ref(Date.now())
const services = ref<IntelServiceRow[]>([])
const venues = ref<MarketSourceHealth[]>([])
const botInstances = ref<BotInstance[]>([])
const alerts = ref<SignalItem[]>([])
const agents = ref<AiAgent[]>([])
const gateway = ref<AiAgentsStatus | null>(null)
const intel = ref<IntelData | null>(null)
const risk = ref<RiskStatusData | null>(null)

// -----------------------------------------------------------------------------
//  Data load
// -----------------------------------------------------------------------------

async function loadAll() {
  const [sys, mkt, botsRes, alertsRes, agentsRes, gw, intelRes, riskRes] = await Promise.allSettled([
    health.system(),
    health.marketSources(),
    botsApi.instances({ limit: 50 }),
    signalsApi.list({ limit: 100 }),
    agentsApi.agents({ limit: 100 }),
    agentsApi.status(),
    intelApi.get(),
    riskApi.status()
  ])

  if (sys.status === 'fulfilled') services.value = sys.value.data?.services ?? []
  if (mkt.status === 'fulfilled') venues.value = mkt.value.data ?? []
  if (botsRes.status === 'fulfilled') botInstances.value = botsRes.value
  if (alertsRes.status === 'fulfilled') alerts.value = alertsRes.value.items
  if (agentsRes.status === 'fulfilled') agents.value = agentsRes.value.agents
  if (gw.status === 'fulfilled') gateway.value = gw.value
  if (intelRes.status === 'fulfilled') intel.value = intelRes.value
  if (riskRes.status === 'fulfilled') risk.value = riskRes.value

  now.value = Date.now()
  loading.value = false
}

// -----------------------------------------------------------------------------
//  Refresh loop
// -----------------------------------------------------------------------------

let refreshInterval: ReturnType<typeof setInterval> | null = null
const autoEnabled = ref(true)

function stopAuto() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

function startAuto() {
  stopAuto()
  refreshInterval = setInterval(() => { void loadAll() }, 60_000)
}

function toggleAuto() {
  autoEnabled.value = !autoEnabled.value
  if (autoEnabled.value) startAuto()
  else stopAuto()
}

onMounted(() => {
  void loadAll()
  startAuto()
})
onUnmounted(stopAuto)

// -----------------------------------------------------------------------------
//  Page actions (single registration: desktop navbar + mobile bottom bar)
// -----------------------------------------------------------------------------

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('healthEnhanced.refresh'),
    primary: true,
    onSelect: () => { void loadAll() }
  },
  {
    icon: 'i-lucide-activity',
    label: t('healthEnhanced.auto'),
    color: autoEnabled.value ? 'success' as const : 'neutral' as const,
    onSelect: () => toggleAuto()
  }
]))
mobileBar.registerInfo(computed(() => ({ count: alerts.value.length, loading: loading.value })))

// -----------------------------------------------------------------------------
//  Formatting helpers
// -----------------------------------------------------------------------------

function ago(value: number | string | null | undefined): string {
  if (!value) return '—'
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return '—'
  return formatTimeAgo(new Date(ms))
}

/** Reads a display label from the free-form `source` record (never trusted). */
function sourceString(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `bot-wonderwhales-btcusdt-p-15-btc15m` -> `wonderwhales`. */
function methodOf(profileId: string | null): string {
  if (!profileId) return '—'
  const parts = profileId.replace(/^bot-/, '').split('-')
  return parts[0] || profileId
}

function symbolOf(instance: BotInstance): string {
  return sourceString(instance.source, 'symbol') ?? instance.instruments?.[0] ?? '—'
}

function timeframeOf(instance: BotInstance): string {
  const tf = instance.timeframes?.[0]
  return tf ? `${tf}m` : '—'
}

/** Instance ids repeat the profile prefix; the tail is the run identifier. */
function shortInstance(row: BotRow): string {
  if (row.profile && row.instanceId.startsWith(row.profile)) {
    const tail = row.instanceId.slice(row.profile.length).replace(/^-/, '')
    if (tail) return tail
  }
  return row.instanceId.length > 14 ? `…${row.instanceId.slice(-12)}` : row.instanceId
}

/** A service is only stale once it has missed a full cycle (D9 honesty). */
type ServiceState = 'ok' | 'stale' | 'overdue'
function serviceState(service: IntelServiceRow): ServiceState {
  if (service.overdue) return 'overdue'
  if (!service.lastOkAt) return 'stale'
  const ageMs = now.value - Date.parse(service.lastOkAt)
  if (!Number.isFinite(ageMs)) return 'stale'
  const staleAfterMs = Math.max(120_000, (service.intervalSec || 60) * 2_000)
  return ageMs <= staleAfterMs ? 'ok' : 'stale'
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

function serviceStateColor(state: ServiceState): BadgeColor {
  return state === 'ok' ? 'success' : state === 'overdue' ? 'error' : 'warning'
}

function botStateColor(state: string): BadgeColor {
  if (state === 'running') return 'success'
  if (state === 'paused' || state === 'queued' || state === 'starting') return 'warning'
  if (state === 'failed' || state === 'halted') return 'error'
  return 'neutral'
}

function healthColor(state: string): BadgeColor {
  return state === 'ok' ? 'success' : state === 'error' ? 'error' : 'neutral'
}

// -----------------------------------------------------------------------------
//  Summaries
// -----------------------------------------------------------------------------

const serviceSummary = computed(() => {
  const states = services.value.map(serviceState)
  return {
    total: services.value.length,
    ok: states.filter(s => s === 'ok').length,
    overdue: states.filter(s => s === 'overdue').length,
    never: services.value.filter(s => !s.lastRunAt).length
  }
})

const botSummary = computed(() => ({
  total: botInstances.value.length,
  running: botInstances.value.filter(b => b.state === 'running').length,
  paused: botInstances.value.filter(b => b.state === 'paused').length,
  failed: botInstances.value.filter(b => b.state === 'failed' || b.state === 'halted').length
}))

const alertSummary = computed(() => ({
  total: alerts.value.length,
  entries: alerts.value.filter(a => a.action === 'ENTRY').length,
  last: alerts.value[0]?.ts ?? null
}))

const agentSummary = computed(() => ({
  total: agents.value.length,
  active: agents.value.filter(a => a.state === 'active').length,
  validated: agents.value.filter(a => a.state === 'validated').length,
  draft: agents.value.filter(a => a.state === 'draft').length
}))

const riskSummary = computed(() => ({
  halted: (risk.value?.accounts ?? []).some(a => a.halted),
  dayPnl: (risk.value?.accounts ?? []).reduce((sum, a) => sum + (a.realizedPnlAbs || 0), 0)
}))

// -----------------------------------------------------------------------------
//  Table rows (flattened: TanStack renders nested objects as [object Object])
// -----------------------------------------------------------------------------

interface BotRow {
  instanceId: string
  profile: string
  bot: string
  state: string
  health: string
  counts: string
  pnl: string
  startedAt: string
  actionItems: Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }>
}

interface AlertRow {
  id: string
  symbol: string
  tf: string
  action: string
  side: string
  price: string
  status: string
  ts: string
}

interface AgentRow {
  name: string
  autonomy: string
  state: string
  versionCount: number
  actions: string
  lastActive: string
}

const botRows = computed<BotRow[]>(() => botInstances.value.map(b => ({
  instanceId: b.instanceId,
  profile: b.botProfileId ?? '',
  bot: `${methodOf(b.botProfileId)} · ${symbolOf(b)} · ${timeframeOf(b)}`,
  state: b.state,
  health: b.health || 'unknown',
  counts: `${b.counts?.signals ?? 0}/${b.counts?.orders ?? 0}/${b.counts?.trades ?? 0}`,
  pnl: typeof b.paperPnl === 'number' ? b.paperPnl.toFixed(2) : '—',
  startedAt: ago(b.startedAt),
  actionItems: botActionItems(b)
})))

const alertRows = computed<AlertRow[]>(() => alerts.value.map(a => ({
  id: a.id,
  symbol: a.symbol ?? '—',
  tf: a.tf ?? '—',
  action: a.action ?? '—',
  side: a.side ?? '—',
  price: a.price != null ? String(a.price) : '—',
  status: a.status,
  ts: ago(a.ts)
})))

const agentRows = computed<AgentRow[]>(() => agents.value.map(a => ({
  name: a.name,
  autonomy: a.autonomy,
  state: a.state,
  versionCount: a.versionCount,
  actions: `${a.actionCounts?.allowed ?? 0}/${a.actionCounts?.blocked ?? 0}`,
  lastActive: ago(a.lastHeartbeatAt)
})))

// -----------------------------------------------------------------------------
//  Columns (accessorKey literals keep TanStack's generic column type happy)
// -----------------------------------------------------------------------------

const botColumns = computed(() => [
  { accessorKey: 'instanceId' as const, header: t('healthEnhanced.cols.instance') },
  { accessorKey: 'bot' as const, header: t('healthEnhanced.cols.bot') },
  { accessorKey: 'state' as const, header: t('healthEnhanced.cols.state') },
  { accessorKey: 'health' as const, header: t('healthEnhanced.cols.health') },
  { accessorKey: 'counts' as const, header: t('healthEnhanced.cols.counts') },
  { accessorKey: 'pnl' as const, header: t('healthEnhanced.cols.pnl') },
  { accessorKey: 'startedAt' as const, header: t('healthEnhanced.cols.started') },
  { accessorKey: 'actions' as const, header: t('healthEnhanced.cols.actions') }
])

const alertColumns = computed(() => [
  { accessorKey: 'id' as const, header: t('healthEnhanced.cols.key') },
  { accessorKey: 'symbol' as const, header: t('healthEnhanced.cols.symbol') },
  { accessorKey: 'tf' as const, header: t('healthEnhanced.cols.tf') },
  { accessorKey: 'action' as const, header: t('healthEnhanced.cols.action') },
  { accessorKey: 'side' as const, header: t('healthEnhanced.cols.side') },
  { accessorKey: 'price' as const, header: t('healthEnhanced.cols.price') },
  { accessorKey: 'status' as const, header: t('healthEnhanced.cols.status') },
  { accessorKey: 'ts' as const, header: t('healthEnhanced.cols.time') }
])

const agentColumns = computed(() => [
  { accessorKey: 'name' as const, header: t('healthEnhanced.cols.name') },
  { accessorKey: 'autonomy' as const, header: t('healthEnhanced.cols.level') },
  { accessorKey: 'state' as const, header: t('healthEnhanced.cols.state') },
  { accessorKey: 'versionCount' as const, header: t('healthEnhanced.cols.version') },
  { accessorKey: 'actions' as const, header: t('healthEnhanced.cols.actions') },
  { accessorKey: 'lastActive' as const, header: t('healthEnhanced.cols.lastActive') }
])

// -----------------------------------------------------------------------------
//  Chrome
// -----------------------------------------------------------------------------

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: title.value }
])

// -----------------------------------------------------------------------------
//  Quick links — every KPI card, section header and row points at the page that
//  owns that record, so the dashboard works as a navigation surface and not just
//  a read-only report. Targets are static app routes (no external URLs).
// -----------------------------------------------------------------------------

const LINKS = {
  services: '/admin-system/health',
  bots: '/strategy-lab/bots',
  alerts: '/trading/signals',
  agents: '/ai-agents',
  venues: '/admin-system/data-sources',
  risk: '/trading/positions',
  drift: '/',
  regime: '/markets',
  movers: '/markets/scanner'
} as const

/** Deep link for one bot run (the detail page resolves the instance id). */
function botHref(instanceId: string): string {
  return `/strategy-lab/bots/instances/${encodeURIComponent(instanceId)}`
}

/** Alerts live in the signals feed; carry the symbol for a filtered view. */
function alertHref(row: AlertRow): string {
  return row.symbol && row.symbol !== '—'
    ? `${LINKS.alerts}?symbol=${encodeURIComponent(row.symbol)}`
    : LINKS.alerts
}

// -----------------------------------------------------------------------------
//  Quick Actions — bot instance commands, service re-probe, bulk operations.
//  All mutations go through durable command rows; the supervisor applies them.
// -----------------------------------------------------------------------------

const notify = useNotify()

/** Pending command state per instanceId to prevent double-clicks. */
const pendingCmd = ref<Record<string, boolean>>({})

/** Confirm modal state for destructive actions. */
const confirmState = ref<{ open: boolean; instanceId: string; action: string; title: string; description: string; onConfirm: () => void }>({
  open: false,
  instanceId: '',
  action: '',
  title: '',
  description: '',
  onConfirm: () => {}
})

function showConfirm(instanceId: string, action: 'start' | 'pause' | 'resume' | 'stop' | 'rerun' | 'haltAll') {
  const instance = botInstances.value.find(i => i.instanceId === instanceId)
  const botName = instance ? `${methodOf(instance.botProfileId)} · ${symbolOf(instance)} · ${timeframeOf(instance)}` : instanceId
  const labels: Record<string, string> = {
    start: 'actions.confirmStart',
    pause: 'actions.confirmPause',
    stop: 'actions.confirmStop',
    rerun: 'actions.confirmRerun',
    haltAll: 'actions.confirmHaltAll'
  }
  confirmState.value = {
    open: true,
    instanceId,
    action,
    title: t(`healthEnhanced.${labels[action]}`),
    description: t('healthEnhanced.actions.confirmDesc', { bot: botName }),
    onConfirm: () => executeAction(instanceId, action)
  }
}

async function executeAction(instanceId: string, action: string) {
  if (pendingCmd.value[instanceId]) return
  pendingCmd.value[instanceId] = true

  let result: { success: boolean; error?: string; code?: string; data?: any } = { success: false, code: 'unknown' }

  if (action === 'haltAll') {
    const runningInstances = botInstances.value.filter(b => b.state === 'running')
    for (const inst of runningInstances) {
      result = await botsApi.enqueueCommand(inst.instanceId, 'stop')
      if (!result.success) break
    }
  } else if (action === 'rerun') {
    result = await botsApi.rerunInstance(instanceId)
  } else {
    result = await botsApi.enqueueCommand(instanceId, action as 'start' | 'pause' | 'resume' | 'stop')
  }

  pendingCmd.value[instanceId] = false

  if (result.success) {
    const successMsg = t(`healthEnhanced.actions.success${action.charAt(0).toUpperCase() + action.slice(1)}`)
    notify.success(successMsg)
    await loadAll()
  } else {
    const errMsg = result.error || t('healthEnhanced.actions.errorGeneric')
    notify.error(`${errMsg} (${result.code})`)
  }
}

/** Re-probe a single service or all services. */
async function reprobeService(serviceName?: string) {
  const result = await healthApi.reprobeServices(serviceName)
  if (result.success) {
    notify.success(t('healthEnhanced.actions.successReprobe'))
    await loadAll()
  } else {
    notify.error(t('healthEnhanced.actions.errorGeneric'))
  }
}

/** Bulk: start all queued instances. */
async function startAllQueued() {
  const queued = botInstances.value.filter(b => b.state === 'queued')
  for (const inst of queued) {
    const result = await botsApi.enqueueCommand(inst.instanceId, 'start')
    if (!result.success) {
      notify.error(`${t('healthEnhanced.actions.errorGeneric')}: ${result.error}`)
      break
    }
  }
  if (queued.length) {
    notify.success(t('healthEnhanced.actions.successStart'))
    await loadAll()
  }
}

/** Bulk: stop all running instances. */
async function stopAllRunning() {
  const running = botInstances.value.filter(b => b.state === 'running')
  for (const inst of running) {
    const result = await botsApi.enqueueCommand(inst.instanceId, 'stop')
    if (!result.success) {
      notify.error(`${t('healthEnhanced.actions.errorGeneric')}: ${result.error}`)
      break
    }
  }
  if (running.length) {
    notify.success(t('healthEnhanced.actions.successStop'))
    await loadAll()
  }
}

/** Build dropdown items for a bot instance row (uses Nuxt UI :items prop format). */
function botActionItems(instance: BotInstance): Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }> {
  const actions: Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }> = []

  const baseDisabled = pendingCmd.value[instance.instanceId] === true

  switch (instance.state) {
    case 'queued':
      actions.push({
        label: t('healthEnhanced.actions.start'),
        icon: 'i-lucide-play',
        color: 'success',
        onSelect: () => showConfirm(instance.instanceId, 'start'),
        disabled: baseDisabled
      })
      break
    case 'starting':
      actions.push({
        label: t('healthEnhanced.actions.stop'),
        icon: 'i-lucide-stop-circle',
        color: 'error',
        onSelect: () => showConfirm(instance.instanceId, 'stop'),
        disabled: baseDisabled
      })
      break
    case 'running':
      actions.push(
        { label: t('healthEnhanced.actions.pause'), icon: 'i-lucide-pause', color: 'warning', onSelect: () => showConfirm(instance.instanceId, 'pause'), disabled: baseDisabled },
        { label: t('healthEnhanced.actions.stop'), icon: 'i-lucide-stop-circle', color: 'error', onSelect: () => showConfirm(instance.instanceId, 'stop'), disabled: baseDisabled }
      )
      break
    case 'paused':
      actions.push(
        { label: t('healthEnhanced.actions.resume'), icon: 'i-lucide-play', color: 'success', onSelect: () => showConfirm(instance.instanceId, 'resume'), disabled: baseDisabled },
        { label: t('healthEnhanced.actions.stop'), icon: 'i-lucide-stop-circle', color: 'error', onSelect: () => showConfirm(instance.instanceId, 'stop'), disabled: baseDisabled }
      )
      break
    case 'completed':
    case 'failed':
    case 'halted':
      actions.push({
        label: t('healthEnhanced.actions.rerun'),
        icon: 'i-lucide-refresh-cw',
        color: 'primary',
        onSelect: () => showConfirm(instance.instanceId, 'rerun'),
        disabled: baseDisabled
      })
      break
  }

  return actions
}
</script>

<template>
  <BasePage id="admin-health-enhanced" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('healthEnhanced.pip')" />
    </template>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-4 animate-pulse">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <UCard v-for="i in 4" :key="i" class="h-24" />
      </div>
      <UCard class="h-64" />
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UCard class="h-64" />
        <UCard class="h-64" />
      </div>
    </div>

    <div v-else class="space-y-4">
      <!-- KPI row (each card is a quick link to the owning page) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <NuxtLink :to="LINKS.services" class="group block rounded-lg focus-visible:outline-2 outline-primary"
          :title="t('healthEnhanced.links.services')">
          <UCard class="p-4 border-l-4 border-success h-full transition group-hover:border-success/80 group-hover:bg-elevated/40">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('healthEnhanced.kpi.services') }}</p>
                <p class="text-2xl font-bold">{{ serviceSummary.total }}</p>
                <p class="text-xs mt-1">
                  <span class="text-success mr-2">{{ serviceSummary.ok }} {{ t('healthEnhanced.kpi.ok') }}</span>
                  <span class="text-error mr-2">{{ serviceSummary.overdue }} {{ t('healthEnhanced.kpi.overdue') }}</span>
                  <span class="text-muted">{{ serviceSummary.never }} {{ t('healthEnhanced.kpi.never') }}</span>
                </p>
              </div>
              <UIcon name="i-lucide-server-cog" class="w-9 h-9 text-success/20 transition group-hover:text-success/40" />
            </div>
          </UCard>
        </NuxtLink>

        <NuxtLink :to="LINKS.bots" class="group block rounded-lg focus-visible:outline-2 outline-primary"
          :title="t('healthEnhanced.links.bots')">
          <UCard class="p-4 border-l-4 border-primary h-full transition group-hover:border-primary/80 group-hover:bg-elevated/40">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('healthEnhanced.kpi.bots') }}</p>
                <p class="text-2xl font-bold">{{ botSummary.total }}</p>
                <p class="text-xs mt-1">
                  <span class="text-success mr-2">{{ botSummary.running }} {{ t('healthEnhanced.kpi.running') }}</span>
                  <span class="text-warning mr-2">{{ botSummary.paused }} {{ t('healthEnhanced.kpi.paused') }}</span>
                  <span class="text-error">{{ botSummary.failed }} {{ t('healthEnhanced.kpi.failed') }}</span>
                </p>
              </div>
              <UIcon name="i-lucide-bot" class="w-9 h-9 text-primary/20 transition group-hover:text-primary/40" />
            </div>
          </UCard>
        </NuxtLink>

        <NuxtLink :to="LINKS.alerts" class="group block rounded-lg focus-visible:outline-2 outline-primary"
          :title="t('healthEnhanced.links.alerts')">
          <UCard class="p-4 border-l-4 border-warning h-full transition group-hover:border-warning/80 group-hover:bg-elevated/40">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('healthEnhanced.kpi.alerts') }}</p>
                <p class="text-2xl font-bold">{{ alertSummary.total }}</p>
                <p class="text-xs mt-1 text-muted">
                  {{ alertSummary.entries }} {{ t('healthEnhanced.kpi.entries') }}
                  <span v-if="alertSummary.last"> · {{ t('healthEnhanced.kpi.last') }} {{ ago(alertSummary.last) }}</span>
                </p>
              </div>
              <UIcon name="i-lucide-radio-tower" class="w-9 h-9 text-warning/20 transition group-hover:text-warning/40" />
            </div>
          </UCard>
        </NuxtLink>

        <NuxtLink :to="LINKS.agents" class="group block rounded-lg focus-visible:outline-2 outline-primary"
          :title="t('healthEnhanced.links.agents')">
          <UCard class="p-4 border-l-4 border-info h-full transition group-hover:border-info/80 group-hover:bg-elevated/40">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('healthEnhanced.kpi.agents') }}</p>
                <p class="text-2xl font-bold">{{ agentSummary.total }}</p>
                <p class="text-xs mt-1">
                  <span class="text-success mr-2">{{ agentSummary.active }} {{ t('healthEnhanced.kpi.active') }}</span>
                  <span class="text-info mr-2">{{ agentSummary.validated }} {{ t('healthEnhanced.kpi.validated') }}</span>
                  <span class="text-muted">{{ agentSummary.draft }} {{ t('healthEnhanced.kpi.draft') }}</span>
                </p>
                <p v-if="gateway" class="text-[10px] text-muted mt-1 font-mono">
                  {{ t('healthEnhanced.kpi.gateway') }}: {{ gateway.gateway.provider }} / {{ gateway.gateway.model }}
                  <span :class="gateway.gateway.configured ? 'text-success' : 'text-error'">
                    {{ gateway.gateway.configured ? '●' : '○' }}
                  </span>
                </p>
              </div>
              <UIcon name="i-lucide-brain-circuit" class="w-9 h-9 text-info/20 transition group-hover:text-info/40" />
            </div>
          </UCard>
        </NuxtLink>
      </div>

      <!-- Service heartbeats -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">{{ t('healthEnhanced.servicesTitle') }}</h3>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted hidden sm:inline">{{ t('healthEnhanced.updated') }} {{ ago(now) }}</span>
              <UButton
                :label="t('healthEnhanced.actions.reprobeAll')"
                color="primary"
                variant="outline"
                size="sm"
                @click="() => reprobeService()"
                class="hidden sm:inline-flex"
              />
              <NuxtLink :to="LINKS.services" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                :title="t('healthEnhanced.links.services')">
                {{ t('healthEnhanced.viewAll') }}
                <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
              </NuxtLink>
            </div>
          </div>
        </template>
        <div v-if="services.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <div v-for="s in services" :key="s.name" class="p-3 rounded-lg bg-elevated/50 border border-default flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-sm truncate">{{ s.name }}</span>
              <UBadge :color="serviceStateColor(serviceState(s))" variant="subtle" size="sm"
                :label="t(`healthEnhanced.serviceStates.${serviceState(s)}`)" />
            </div>
            <p class="text-xs text-muted mt-1.5">
              {{ t('healthEnhanced.service.runs') }}: {{ s.count }}
              · {{ t('healthEnhanced.service.last') }}: {{ ago(s.lastOkAt) }}
            </p>
            <p v-if="s.lastError" class="text-[10px] text-error mt-1 truncate" :title="s.lastError">
              {{ t('healthEnhanced.service.err') }}: {{ s.lastError }}
            </p>
            <UButton
              :label="t('healthEnhanced.actions.reprobe')"
              color="primary"
              variant="ghost"
              size="xs"
              class="w-full mt-1"
              @click="() => reprobeService(s.name)"
            />
          </div>
        </div>
        <p v-else class="text-sm text-muted py-4 text-center">{{ t('healthEnhanced.servicesEmpty') }}</p>
      </UCard>

      <!-- Bots + alerts -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-semibold">{{ t('healthEnhanced.botsTitle') }} ({{ botSummary.total }})</h3>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="botSummary.running > 0"
                  :label="t('healthEnhanced.actions.stopAllRunning')"
                  color="error"
                  variant="outline"
                  size="sm"
                  @click="showConfirm('', 'haltAll')"
                  class="hidden sm:inline-flex"
                />
                <UButton
                  v-if="botSummary.running === 0 && botSummary.paused > 0"
                  :label="t('healthEnhanced.actions.startAllQueued')"
                  color="success"
                  variant="outline"
                  size="sm"
                  @click="startAllQueued"
                  class="hidden sm:inline-flex"
                />
                <NuxtLink :to="LINKS.bots" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  :title="t('healthEnhanced.links.bots')">
                  {{ t('healthEnhanced.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </div>
            </div>
          </template>
          <div class="overflow-x-auto">
            <UTable :data="botRows" :columns="botColumns" :empty="t('healthEnhanced.botsEmpty')">
              <template #instanceId-cell="{ row }">
                <NuxtLink :to="botHref(row.original.instanceId)" class="font-mono text-xs text-primary hover:underline"
                  :title="`${row.original.instanceId} · ${t('healthEnhanced.openItem')}`">
                  {{ shortInstance(row.original) }}
                </NuxtLink>
              </template>
              <template #bot-cell="{ row }">
                <NuxtLink :to="botHref(row.original.instanceId)"
                  class="text-xs truncate inline-block max-w-[150px] hover:text-primary hover:underline"
                  :title="row.original.profile">
                  {{ row.original.bot }}
                </NuxtLink>
              </template>
              <template #state-cell="{ row }">
                <UBadge :color="botStateColor(row.original.state)" variant="subtle" size="sm"
                  :label="row.original.state" />
              </template>
              <template #health-cell="{ row }">
                <UBadge :color="healthColor(row.original.health)" variant="subtle" size="sm"
                  :label="row.original.health" />
              </template>
              <template #actions-cell="{ row }">
                <UDropdownMenu v-if="row.original.actionItems.length" :items="row.original.actionItems" class="w-40">
                  <UButton
                    variant="ghost"
                    size="xs"
                    label="…"
                    icon="i-lucide-chevron-down"
                    class="h-6 w-6 p-0 min-w-0"
                    :disabled="pendingCmd[row.original.instanceId]"
                    aria-label="Bot actions"
                  />
                </UDropdownMenu>
                <span v-else class="text-xs text-muted">—</span>
              </template>
            </UTable>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-semibold">{{ t('healthEnhanced.alertsTitle') }} ({{ alertSummary.total }})</h3>
              <NuxtLink :to="LINKS.alerts" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                :title="t('healthEnhanced.links.alerts')">
                {{ t('healthEnhanced.viewAll') }}
                <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
              </NuxtLink>
            </div>
          </template>
          <div class="overflow-x-auto">
            <UTable :data="alertRows" :columns="alertColumns" :empty="t('healthEnhanced.alertsEmpty')">
              <template #id-cell="{ row }">
                <NuxtLink :to="alertHref(row.original)" class="font-mono text-[10px] text-primary hover:underline"
                  :title="`${row.original.id} · ${t('healthEnhanced.openItem')}`">
                  {{ row.original.id.slice(0, 8) }}
                </NuxtLink>
              </template>
              <template #symbol-cell="{ row }">
                <NuxtLink :to="alertHref(row.original)" class="text-xs hover:text-primary hover:underline">
                  {{ row.original.symbol }}
                </NuxtLink>
              </template>
              <template #status-cell="{ row }">
                <UDropdownMenu
                  class="w-36"
                  :items="[
                    { label: t('healthEnhanced.actions.acknowledge'), icon: 'i-lucide-check', onSelect: () => notify.success('Alert acknowledged') },
                    { label: t('healthEnhanced.actions.dismiss'), icon: 'i-lucide-x', color: 'error', onSelect: () => notify.warning('Alert dismissed') }
                  ]"
                >
                  <UButton
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-chevron-down"
                    class="h-6 w-6 p-0"
                    aria-label="Alert actions"
                  />
                </UDropdownMenu>
              </template>
            </UTable>
          </div>
        </UCard>
      </div>

      <!-- Agents + market/risk -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-semibold">{{ t('healthEnhanced.agentsTitle') }} ({{ agentSummary.total }})</h3>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="agentSummary.draft > 0"
                  :label="`Activate ${agentSummary.draft} draft agents`"
                  color="success"
                  variant="outline"
                  size="sm"
                  @click="() => notify.info('Bulk activate not yet implemented')"
                  class="hidden sm:inline-flex"
                />
                <NuxtLink :to="LINKS.agents" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  :title="t('healthEnhanced.links.agents')">
                  {{ t('healthEnhanced.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </div>
            </div>
          </template>
          <div class="overflow-x-auto">
            <UTable :data="agentRows" :columns="agentColumns" :empty="t('healthEnhanced.agentsEmpty')">
              <template #name-cell="{ row }">
                <NuxtLink :to="LINKS.agents" class="text-xs hover:text-primary hover:underline"
                  :title="t('healthEnhanced.links.agents')">
                  {{ row.original.name }}
                </NuxtLink>
              </template>
              <template #state-cell="{ row }">
                <div class="flex items-center gap-1">
                  <UBadge :color="botStateColor(row.original.state)" variant="subtle" size="sm"
                    :label="row.original.state" />
                  <UDropdownMenu
                    v-if="row.original.state !== 'active'"
                    class="w-32"
                    :items="[
                      { label: row.original.state === 'draft' ? t('healthEnhanced.actions.start') : t('healthEnhanced.actions.resume'), icon: 'i-lucide-play', color: 'success', onSelect: () => notify.info('Agent activation not yet implemented') }
                    ]"
                  >
                    <UButton
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-chevron-down"
                      class="h-6 w-6 p-0"
                    />
                  </UDropdownMenu>
                </div>
              </template>
            </UTable>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-semibold">{{ t('healthEnhanced.marketTitle') }}</h3>
              <NuxtLink :to="LINKS.venues" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                :title="t('healthEnhanced.links.venues')">
                {{ t('healthEnhanced.viewAll') }}
                <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
              </NuxtLink>
            </div>
          </template>

          <div class="space-y-4">
            <!-- Market data venues -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div v-for="v in venues" :key="v.venue" class="p-3 rounded-lg bg-elevated/50 border border-default flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted mb-1">{{ v.venue }}</p>
                  <NuxtLink :to="LINKS.venues" class="text-xs text-primary hover:underline" :title="t('healthEnhanced.links.venues')">
                    <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                  </NuxtLink>
                </div>
                <p class="font-mono text-sm" :class="v.status === 'up' ? 'text-success' : 'text-error'">
                  {{ v.status === 'up' ? '●' : '○' }} {{ v.status }}
                  <span v-if="v.latencyMs" class="text-muted text-xs">({{ v.latencyMs }}ms)</span>
                </p>
                <p v-if="v.error" class="text-[10px] text-error mt-1 line-clamp-2 break-all" :title="v.error">
                  {{ v.error }}
                </p>
                <UButton
                  :label="t('healthEnhanced.actions.reprobe')"
                  color="primary"
                  variant="ghost"
                  size="xs"
                  class="w-full"
                  @click="reprobeService(v.venue)"
                />
              </div>
            </div>

            <!-- Risk gate -->
            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 rounded-lg bg-elevated/50 border border-default flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted mb-1">{{ t('healthEnhanced.market.risk') }} ({{ risk?.day ?? '—' }})</p>
                  <NuxtLink :to="LINKS.risk" class="text-xs text-primary hover:underline" :title="t('healthEnhanced.links.risk')">
                    <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                  </NuxtLink>
                </div>
                <p class="font-mono text-sm" :class="riskSummary.halted ? 'text-error' : 'text-success'">
                  {{ riskSummary.halted ? t('healthEnhanced.market.halted') : t('healthEnhanced.market.ok') }}
                </p>
                <p class="text-xs text-muted mt-1">
                  {{ t('healthEnhanced.market.store') }}: {{ risk?.mongo ?? '—' }}
                  · {{ t('healthEnhanced.market.openPositions') }}: {{ risk?.openPositions ?? 0 }}
                </p>
                <p class="text-xs text-muted">
                  {{ t('healthEnhanced.market.dayPnl') }}:
                  <span :class="riskSummary.dayPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ riskSummary.dayPnl.toFixed(2) }}
                  </span>
                </p>
                <UButton
                  v-if="!riskSummary.halted"
                  :label="t('healthEnhanced.actions.haltAll')"
                  color="error"
                  variant="outline"
                  size="xs"
                  class="w-full"
                  @click="showConfirm('', 'haltAll')"
                />
              </div>

              <NuxtLink :to="LINKS.drift" :title="t('healthEnhanced.links.drift')"
                class="group block p-3 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary">
                <p class="text-xs text-muted mb-1">{{ t('healthEnhanced.market.drift') }}</p>
                <p class="font-mono text-sm" :class="risk?.drift?.breach ? 'text-error' : 'text-success'">
                  {{ risk?.drift?.breach ? t('healthEnhanced.market.breach') : t('healthEnhanced.market.ok') }}
                </p>
                <p class="text-xs text-muted mt-1">
                  {{ t('healthEnhanced.market.checked') }}: {{ risk?.drift?.checked ?? 0 }}
                  · {{ t('healthEnhanced.market.diverged') }}: {{ risk?.drift?.diverged ?? 0 }}
                </p>
                <p v-if="risk?.drift?.lastCheckAt" class="text-xs text-muted">
                  {{ ago(risk.drift.lastCheckAt) }}
                </p>
              </NuxtLink>
            </div>

            <!-- Regime + movers -->
            <div v-if="intel" class="grid grid-cols-2 gap-3">
              <NuxtLink :to="LINKS.regime" :title="t('healthEnhanced.links.regime')"
                class="group block p-3 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary">
                <p class="text-xs text-muted mb-1">{{ t('healthEnhanced.market.regime') }}</p>
                <p class="font-mono text-sm">{{ intel.regime?.season ?? '—' }}</p>
                <p class="text-xs text-muted mt-1">
                  ASI90: {{ intel.regime?.asi?.d90 ?? '—' }} · FNG: {{ intel.regime?.fng?.value ?? '—' }}
                </p>
              </NuxtLink>
              <NuxtLink :to="LINKS.movers" :title="t('healthEnhanced.links.movers')"
                class="group block p-3 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary">
                <p class="text-xs text-muted mb-1">{{ t('healthEnhanced.market.movers') }}</p>
                <p class="font-mono text-sm">
                  {{ intel.movers?.length ?? 0 }} {{ t('healthEnhanced.market.symbols') }}
                </p>
                <p v-if="intel.movers?.[0]" class="text-xs text-muted mt-1 font-mono truncate">
                  {{ intel.movers[0].symbol }} {{ intel.movers[0].pct24h?.toFixed(1) }}%
                </p>
              </NuxtLink>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </BasePage>

  <!-- Confirm Modal -->
  <LazyBaseConfirmModal
    v-model:open="confirmState.open"
    :title="confirmState.title"
    :description="confirmState.description"
    :color="'error'"
    :confirm-label="t('global.confirm')"
    :cancel-label="t('global.cancel')"
    @confirm="confirmState.onConfirm"
    @cancel="confirmState.open = false"
  />
</template>
