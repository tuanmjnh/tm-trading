<script setup lang="ts">
import type { AiAgent, AiAgentAction, AiAgentDetail, AiAgentsStatus } from '#shared/types/ai'
import type { BotInstance } from '#shared/types/bots'
import type { MarketSourceHealth } from '#shared/types/health'
import type { IntelData, IntelServiceRow } from '#shared/types/intel'
import type { PositionItem } from '#shared/types/positions'
import type { RiskStatusData } from '#shared/types/risk'
import type { SignalItem } from '#shared/types/signals'
import type { PaperAccountSummary } from '~/composables/usePaperAccounts'
import { formatTimeAgo } from '@vueuse/core'

// =============================================================================
//  Operations Center — one screen over the real runtime: D9 service
//  heartbeats, bot instances, webhook alerts, AI agents, market-source probes
//  and the risk gate.
//
//  Read-only by contract (D1): every number is an API/database read, never a
//  recomputation. All reads go through the typed composables (fail-soft) so a
//  store blip yields an empty section instead of a stack trace.
// =============================================================================

const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'operationsCenter.title',
  descKey: 'operationsCenter.desc'
})
useHead({ title })

const health = useSystemHealth()
const botsApi = useBots()
const healthApi = useSystemHealth()
const signalsApi = useSignals()
const agentsApi = useAiAgents()
const intelApi = useIntel()
const riskApi = useRisk()
const positionsApi = usePositions()
const paperAccountsApi = usePaperAccounts()
const marketStream = useMarketStream()

const loading = ref(true)
/** Ticks on every refresh so interval-based freshness stays reactive. */
const now = ref(Date.now())
const services = ref<IntelServiceRow[]>([])
const venues = ref<MarketSourceHealth[]>([])
const botInstances = ref<BotInstance[]>([])
const alerts = ref<SignalItem[]>([])
const agents = ref<AiAgent[]>([])
const positions = ref<PositionItem[]>([])
const positionMeta = ref<{ open: number; closed: number; realizedPnlAbs: number | null } | null>(null)
const positionFilter = ref<'all' | 'open' | 'closed'>('all')
const paperAccounts = ref<PaperAccountSummary[]>([])
const selectedAgentAccount = ref<string>('all')
const gateway = ref<AiAgentsStatus | null>(null)
const intel = ref<IntelData | null>(null)
const risk = ref<RiskStatusData | null>(null)

// -----------------------------------------------------------------------------
//  Data load
// -----------------------------------------------------------------------------

async function loadAll() {
  const [sys, mkt, botsRes, alertsRes, agentsRes, gw, intelRes, riskRes, posRes, accsRes] = await Promise.allSettled([
    health.system(),
    health.marketSources(),
    botsApi.instances({ limit: 50 }),
    signalsApi.list({ limit: 100 }),
    agentsApi.agents({ limit: 100 }),
    agentsApi.status(),
    intelApi.get(),
    riskApi.status(),
    positionsApi.list({ limit: 100 }),
    paperAccountsApi.accounts()
  ])

  if (sys.status === 'fulfilled') services.value = sys.value.data?.services ?? []
  if (mkt.status === 'fulfilled') venues.value = mkt.value.data ?? []
  if (botsRes.status === 'fulfilled') botInstances.value = botsRes.value
  if (alertsRes.status === 'fulfilled') alerts.value = alertsRes.value.items
  if (agentsRes.status === 'fulfilled') agents.value = agentsRes.value.agents
  if (gw.status === 'fulfilled') gateway.value = gw.value
  if (intelRes.status === 'fulfilled') intel.value = intelRes.value
  if (riskRes.status === 'fulfilled') risk.value = riskRes.value
  if (posRes.status === 'fulfilled') {
    positions.value = posRes.value.items
    positionMeta.value = posRes.value.meta
  }
  if (accsRes.status === 'fulfilled') {
    paperAccounts.value = accsRes.value.items
  }

  now.value = Date.now()
  loading.value = false
}

// -----------------------------------------------------------------------------
//  Refresh loop
// -----------------------------------------------------------------------------

let refreshInterval: ReturnType<typeof setInterval> | null = null
let positionsInterval: ReturnType<typeof setInterval> | null = null
const autoEnabled = ref(true)

function stopAuto() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (positionsInterval) {
    clearInterval(positionsInterval)
    positionsInterval = null
  }
}

function startAuto() {
  stopAuto()
  refreshInterval = setInterval(() => { void loadAll() }, 15_000)
  positionsInterval = setInterval(async () => {
    try {
      const res = await positionsApi.list({ limit: 100 })
      positions.value = res.items
      positionMeta.value = res.meta
    } catch { /* fail-soft */ }
  }, 3_000)
}

function toggleAuto() {
  autoEnabled.value = !autoEnabled.value
  if (autoEnabled.value) startAuto()
  else stopAuto()
}

const botsLive = useBotsLive()
const aiLive = useAiAgentsLive()

watch(botsLive.instances, (liveInsts) => {
  if (liveInsts?.length) {
    botInstances.value = liveInsts.map(live => {
      const prev = botInstances.value.find(b => b.instanceId === live.instanceId)
      return prev ? { ...prev, ...live, source: live.source || prev.source, accountId: live.accountId || prev.accountId } : live
    })
  }
})

watch(aiLive.agents, (liveAgents) => {
  if (liveAgents?.length) {
    agents.value = liveAgents.map(live => {
      const prev = agents.value.find(a => a.agentId === live.agentId)
      return prev ? { ...prev, ...live, accountId: live.accountId || prev.accountId } : live
    })
  }
})

onMounted(() => {
  void loadAll()
  startAuto()
  botsLive.start()
  aiLive.start()
  marketStream.connect()
})

onUnmounted(() => {
  stopAuto()
  botsLive.stop()
  aiLive.stop()
  marketStream.disconnect()
})

// -----------------------------------------------------------------------------
//  Page actions (single registration: desktop navbar + mobile bottom bar)
// -----------------------------------------------------------------------------

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('operationsCenter.refresh'),
    primary: true,
    onSelect: () => { void loadAll() }
  },
  {
    icon: 'i-lucide-play-circle',
    label: t('operationsCenter.runAllServices'),
    color: 'success' as const,
    onSelect: () => runAllServices()
  },
  {
    icon: 'i-lucide-activity',
    label: t('operationsCenter.auto'),
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

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
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
  const sym = sourceString(instance.source, 'symbol')
    ?? (instance.instruments && instance.instruments.length > 0 ? instance.instruments[0] : null)
    ?? (instance as any).symbol
  if (sym) return sym
  const idToParse = instance.botProfileId || instance.instanceId || ''
  const parts = idToParse.split('-')
  if (parts.length >= 4) {
    if (parts[3] === 'p') return `${parts[2]!.toUpperCase()}.P`
    return parts[2]!.toUpperCase()
  }
  return '—'
}

function timeframeOf(instance: BotInstance): string {
  const tf = (instance.timeframes && instance.timeframes.length > 0 ? instance.timeframes[0] : null)
    ?? sourceString(instance.source, 'tf')
    ?? sourceString(instance.source, 'timeframe')
    ?? (instance as any).timeframe
  if (tf) {
    const s = String(tf)
    return s.endsWith('m') || s.endsWith('h') || s.endsWith('d') || s === 'D' ? s : `${s}m`
  }
  const idToParse = instance.botProfileId || instance.instanceId || ''
  const m = idToParse.match(/-(\d+)(?:m)?(?:-[^0-9]|$)/i) || idToParse.match(/-(\d+m?)-/i)
  if (m && m[1]) {
    const s = m[1]
    return s.endsWith('m') ? s : `${s}m`
  }
  return '—'
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

const botSummary = computed(() => {
  const total = botInstances.value.length
  const running = botInstances.value.filter(b => b.state === 'running').length
  const paused = botInstances.value.filter(b => b.state === 'paused').length
  const failed = botInstances.value.filter(b => b.state === 'failed' || b.state === 'halted').length

  const rows = botRows.value
  const totalEquity = rows.reduce((sum, r) => sum + r.equity, 0)
  const totalPnl = rows.reduce((sum, r) => sum + r.pnl, 0)
  const totalTradedVolume = rows.reduce((sum, r) => sum + r.tradedVolume, 0)
  const baseCapital = totalEquity - totalPnl
  const pnlPct = baseCapital > 0 ? (totalPnl / baseCapital) * 100 : 0
  const totalSignals = botInstances.value.reduce((sum, b) => sum + (b.counts?.signals ?? 0), 0)
  const totalOrders = botInstances.value.reduce((sum, b) => sum + (b.counts?.orders ?? 0), 0)
  const totalTrades = rows.reduce((sum, r) => sum + (r.raw.counts?.trades || 0), 0)

  return {
    total,
    running,
    paused,
    failed,
    totalEquity,
    totalPnl,
    totalTradedVolume,
    pnlPct,
    totalSignals,
    totalOrders,
    totalTrades
  }
})

const positionSummary = computed(() => {
  const openList = positions.value.filter(p => p.status === 'open')
  const closedList = positions.value.filter(p => p.status === 'closed')
  const openCount = positionMeta.value?.open ?? openList.length
  const closedCount = positionMeta.value?.closed ?? closedList.length
  const realizedPnl = positionMeta.value?.realizedPnlAbs ?? closedList.reduce((sum, p) => sum + (p.pnlAbs ?? 0), 0)
  const unrealizedPnl = openList.reduce((sum, p) => sum + (p.live?.unrealized ?? p.pnlAbs ?? 0), 0)
  return {
    total: positions.value.length,
    open: openCount,
    closed: closedCount,
    realizedPnl,
    unrealizedPnl
  }
})

const alertSummary = computed(() => ({
  total: alerts.value.length,
  entries: alerts.value.filter(a => a.action === 'ENTRY').length,
  last: alerts.value[0]?.ts ?? null
}))

const agentSummary = computed(() => {
  let allowed = 0
  let blocked = 0
  for (const a of agents.value) {
    allowed += a.actionCounts?.allowed ?? 0
    blocked += a.actionCounts?.blocked ?? 0
  }
  return {
    total: agents.value.length,
    active: agents.value.filter(a => a.state === 'active').length,
    validated: agents.value.filter(a => a.state === 'validated').length,
    draft: agents.value.filter(a => a.state === 'draft').length,
    allowed,
    blocked
  }
})

const agentAccounts = computed(() => {
  const set = new Set<string>()
  for (const a of agents.value) {
    if (a.accountId) set.add(a.accountId)
  }
  for (const acc of paperAccounts.value) {
    if (acc.accountId) set.add(acc.accountId)
  }
  return Array.from(set).sort()
})

const selectedAccountData = computed(() => {
  if (selectedAgentAccount.value === 'all') {
    const totalPnl = (risk.value?.accounts ?? []).reduce((sum, a) => sum + (a.realizedPnlAbs || 0), 0)
    const baseCapital = 10000
    const pnlPct = baseCapital > 0 ? (totalPnl / baseCapital) * 100 : 0
    return {
      accountId: 'all',
      equity: baseCapital + totalPnl,
      realizedPnl: totalPnl,
      unrealizedPnl: 0,
      pnlPct,
      agentCount: agents.value.length
    }
  }
  const accId = selectedAgentAccount.value
  const r = (risk.value?.accounts ?? []).find(a => a.account === accId)
  const paperAcc = paperAccounts.value.find(a => a.accountId === accId)
  const initBal = paperAcc?.initialBalance ?? 10000
  const realPnl = r?.realizedPnlAbs ?? 0
  const pnlPct = r?.realizedPnlPct ?? (initBal > 0 ? (realPnl / initBal) * 100 : 0)
  const equity = initBal + realPnl
  const agentCount = agents.value.filter(a => (a.accountId || 'default') === accId).length

  return {
    accountId: accId,
    equity,
    realizedPnl: realPnl,
    unrealizedPnl: 0,
    pnlPct,
    agentCount
  }
})

const riskSummary = computed(() => ({
  halted: (risk.value?.accounts ?? []).some(a => a.halted),
  dayPnl: (risk.value?.accounts ?? []).reduce((sum, a) => sum + (a.realizedPnlAbs || 0), 0)
}))

// -----------------------------------------------------------------------------
//  Tabs (Unified Console: Bots, Positions, Alerts, Agents)
// -----------------------------------------------------------------------------

type ConsoleTab = 'bots' | 'positions' | 'alerts' | 'agents'
const activeTab = ref<ConsoleTab>('bots')

const tabItems = computed(() => [
  {
    label: `${t('operationsCenter.botsTitle')} (${botSummary.value.total})`,
    value: 'bots',
    icon: 'i-lucide-bot'
  },
  {
    label: `${t('operationsCenter.positionsTitle')} (${positionSummary.value.open}/${positionSummary.value.closed})`,
    value: 'positions',
    icon: 'i-lucide-layers'
  },
  {
    label: `${t('operationsCenter.alertsTitle')} (${alertSummary.value.total})`,
    value: 'alerts',
    icon: 'i-lucide-radio-tower'
  },
  {
    label: `${t('operationsCenter.agentsTitle')} (${agentSummary.value.total})`,
    value: 'agents',
    icon: 'i-lucide-brain-circuit'
  }
])

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
  equity: number
  equityFormatted: string
  pnl: number
  pnlPct: number
  pnlFormatted: string
  tradedVolume: number
  tradedVolumeFormatted: string
  accountId: string
  symbol: string
  timeframe: string
  method: string
  startedAt: string
  raw: BotInstance
  actionItems: Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }>
}

interface PositionRow {
  id: string
  symbol: string
  dir: 1 | -1
  dirLabel: string
  method: string
  qty: number
  entryPriceFormatted: string
  exitPriceFormatted: string
  tpslFormatted: string
  pnl: number
  pnlPct: number
  pnlFormatted: string
  status: string
  time: string
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
  id: string
  name: string
  description: string
  model: string
  accountId: string
  autonomy: string
  state: string
  health: string
  versionCount: number
  instruments: string[]
  actions: string
  allowed: number
  blocked: number
  pnl: number
  pnlPct: number
  pnlFormatted: string
  equityFormatted: string
  lastActive: string
  raw: AiAgent
}

const showBotModal = ref(false)
const selectedBotRow = ref<BotRow | null>(null)
const selectedBotDetail = ref<BotInstance | null>(null)
const botDetailLoading = ref(false)
const botModalTab = ref<'overview' | 'positions' | 'events'>('overview')
const editBotSizingType = ref<'percentage' | 'fixed_value'>('percentage')
const editBotSizingValue = ref<number>(1)
const savingBotConfig = ref(false)

const botModalTabs = computed(() => [
  { label: t('operationsCenter.botModal.overview'), value: 'overview', icon: 'i-lucide-activity' },
  { label: t('operationsCenter.botModal.ordersAndPositions'), value: 'positions', icon: 'i-lucide-layers' },
  { label: t('operationsCenter.botModal.eventLogs'), value: 'events', icon: 'i-lucide-list-checks' }
])

async function openBotDetail(row: BotRow) {
  selectedBotRow.value = row
  showBotModal.value = true
  botDetailLoading.value = true
  botModalTab.value = 'overview'
  try {
    const res = await botsApi.instance(row.instanceId)
    selectedBotDetail.value = res || row.raw
    const exec = (res?.execution || row.raw?.execution) as Record<string, unknown> | undefined
    editBotSizingType.value = (exec?.sizingType === 'fixed_value') ? 'fixed_value' : 'percentage'
    editBotSizingValue.value = Number(exec?.sizingValue) || (editBotSizingType.value === 'fixed_value' ? 500 : 1)
  } catch {
    selectedBotDetail.value = row.raw
  } finally {
    botDetailLoading.value = false
  }
}

async function saveBotConfig() {
  const instanceId = selectedBotRow.value?.instanceId
  if (!instanceId) return
  savingBotConfig.value = true
  try {
    const res = await $fetch<{ success: boolean }>(`/api/v1/bots/instances/${instanceId}`, {
      method: 'PATCH',
      body: {
        execution: {
          sizingType: editBotSizingType.value,
          sizingValue: Number(editBotSizingValue.value) || 1
        }
      }
    })
    if (res.success) {
      notify.success(t('operationsCenter.botModal.configSaved'))
      if (selectedBotDetail.value) {
        selectedBotDetail.value.execution = {
          ...(selectedBotDetail.value.execution || {}),
          sizingType: editBotSizingType.value,
          sizingValue: Number(editBotSizingValue.value) || 1
        }
      }
    }
  } catch (err) {
    notify.error('Update failed', String(err))
  } finally {
    savingBotConfig.value = false
  }
}

const selectedBotPositions = computed(() => {
  if (!selectedBotRow.value) return []
  const accId = selectedBotRow.value.accountId
  const sym = selectedBotRow.value.symbol
  return positions.value.filter(p => p.account === accId || (sym !== '—' && p.symbol === sym))
})

const showAgentModal = ref(false)
const selectedAgentId = ref<string | null>(null)
const selectedAgentRow = ref<AgentRow | null>(null)
const agentDetail = ref<AiAgentDetail | null>(null)
const agentActivities = ref<AiAgentAction[]>([])
const agentDetailLoading = ref(false)
const agentModalTab = ref<'overview' | 'actions'>('overview')
const editAgentAccountId = ref<string>('')
const savingAgentAccount = ref(false)

async function openAgentDetail(row: AgentRow) {
  selectedAgentId.value = row.id
  selectedAgentRow.value = row
  editAgentAccountId.value = row.accountId
  showAgentModal.value = true
  agentDetailLoading.value = true
  agentModalTab.value = 'overview'
  try {
    const [detailRes, actRes] = await Promise.allSettled([
      agentsApi.agent(row.id),
      agentsApi.activity(row.id, 50)
    ])
    if (detailRes.status === 'fulfilled' && detailRes.value) {
      agentDetail.value = detailRes.value
      editAgentAccountId.value = detailRes.value.agent.accountId || row.accountId
    }
    if (actRes.status === 'fulfilled') {
      agentActivities.value = actRes.value
    }
  } finally {
    agentDetailLoading.value = false
  }
}

async function saveAgentAccount() {
  if (!selectedAgentId.value || !editAgentAccountId.value) return
  savingAgentAccount.value = true
  try {
    const updated = await agentsApi.update(selectedAgentId.value, { accountId: editAgentAccountId.value })
    if (updated) {
      notify.success(t('operationsCenter.agentModal.accountSaved'))
      const idx = agents.value.findIndex(a => a.agentId === selectedAgentId.value)
      if (idx !== -1 && agents.value[idx]) {
        agents.value[idx]!.accountId = editAgentAccountId.value
      }
      if (selectedAgentRow.value) {
        selectedAgentRow.value.accountId = editAgentAccountId.value
      }
      if (agentDetail.value?.agent) {
        agentDetail.value.agent.accountId = editAgentAccountId.value
      }
    }
  } catch (err) {
    notify.error('Update Failed', String(err))
  } finally {
    savingAgentAccount.value = false
  }
}

async function handleAgentMove(action: 'start' | 'pause' | 'resume' | 'disable') {
  if (!selectedAgentId.value) return
  try {
    const moved = await agentsApi.move(selectedAgentId.value, action)
    if (moved) {
      notify.success(`${action} agent successful`)
      const idx = agents.value.findIndex(a => a.agentId === selectedAgentId.value)
      if (idx !== -1) {
        agents.value[idx] = moved
      }
      if (selectedAgentRow.value) {
        selectedAgentRow.value.state = moved.state
      }
      if (agentDetail.value?.agent) {
        agentDetail.value.agent.state = moved.state
      }
    }
  } catch (err) {
    notify.error('Agent action failed', String(err))
  }
}

function autonomyColor(level: string): 'primary' | 'info' | 'warning' | 'error' | 'neutral' {
  if (level === 'A0') return 'neutral'
  if (level === 'A1') return 'primary'
  if (level === 'A2') return 'info'
  if (level === 'A3' || level === 'A4') return 'warning'
  return 'neutral'
}

const botRows = computed<BotRow[]>(() => botInstances.value.map(b => {
  const sym = symbolOf(b)
  const tf = timeframeOf(b)
  const method = methodOf(b.botProfileId)
  const accId = (b.source?.accountId as string) || (b as any).accountId || 'default'
  const acc = paperAccounts.value.find(a => a.accountId === accId)
  const r = (risk.value?.accounts ?? []).find(a => a.account === accId)
  const realPnl = r?.realizedPnlAbs ?? 0
  const realEquity = (acc?.initialBalance ?? 10000) + realPnl

  const equity = typeof b.paperEquity === 'number' && b.paperEquity > 0 ? b.paperEquity : realEquity
  const pnl = typeof b.paperPnl === 'number' && b.paperPnl !== 0 ? b.paperPnl : realPnl
  const base = equity - pnl
  const pnlPct = r?.realizedPnlPct ?? (base > 0 ? (pnl / base) * 100 : 0)

  const cleanSym = sym !== '—' ? sym.replace(/\.P$/i, '').toUpperCase() : ''
  const botPositions = positions.value.filter(p => {
    if (accId !== 'default' && p.account === accId) return true
    if (cleanSym) {
      const pSym = (p.symbol || '').replace(/\.P$/i, '').toUpperCase()
      return pSym === cleanSym
    }
    return false
  })
  const tradedVolume = botPositions.reduce((sum, p) => sum + (p.qty * p.entryPrice), 0)
  const tradeCount = (b.counts?.trades && b.counts.trades > 0) ? b.counts.trades : botPositions.length

  return {
    instanceId: b.instanceId,
    profile: b.botProfileId ?? '',
    bot: `${method} · ${sym} · ${tf}`,
    state: b.state,
    health: b.health || 'unknown',
    counts: `${b.counts?.signals ?? 0}/${b.counts?.orders ?? 0}/${tradeCount}`,
    equity,
    equityFormatted: fmtMoney(equity),
    pnl,
    pnlPct,
    pnlFormatted: fmtSignedMoney(pnl),
    tradedVolume,
    tradedVolumeFormatted: fmtMoney(tradedVolume),
    accountId: accId,
    symbol: sym,
    timeframe: tf,
    method,
    startedAt: ago(b.startedAt),
    raw: b,
    actionItems: botActionItems(b)
  }
}))

const positionRows = computed<PositionRow[]>(() => {
  let list = positions.value
  if (positionFilter.value === 'open') {
    list = list.filter(p => p.status === 'open')
  } else if (positionFilter.value === 'closed') {
    list = list.filter(p => p.status === 'closed')
  }

  return list.map(p => {
    const isLive = p.status === 'open'
    const symClean = (p.symbol || '').replace(/\.P$/i, '').toUpperCase()
    const liveQ = marketStream.state.quotes[p.symbol]
      || marketStream.state.quotes[symClean]
      || marketStream.state.quotes[`${symClean}.P`]
    const liveT = marketStream.state.lastTrades[p.symbol]
      || marketStream.state.lastTrades[symClean]
    const markPrice = isLive
      ? (liveQ?.bid && liveQ?.ask ? (p.dir === 1 ? liveQ.bid : liveQ.ask) : (liveQ?.last ?? liveT?.price ?? p.live?.mark ?? null))
      : null

    let pnl = p.pnlAbs ?? 0
    let pnlPct = p.pnlPct ?? 0

    if (isLive && markPrice && p.entryPrice && p.qty) {
      const gross = (markPrice - p.entryPrice) * p.dir * p.qty
      pnl = gross - (p.fees ?? 0)
      pnlPct = ((markPrice - p.entryPrice) * p.dir / p.entryPrice) * 100
    } else if (isLive && p.live?.unrealized != null) {
      pnl = p.live.unrealized
      pnlPct = p.live.unrealizedPct ?? 0
    }

    const slText = p.sl ? `SL: ${p.sl}` : ''
    const tpText = p.tps?.length ? `TP: ${p.tps[0]}` : ''
    const tpslFormatted = [tpText, slText].filter(Boolean).join(' · ') || '—'

    return {
      id: p.id,
      symbol: p.symbol,
      dir: p.dir,
      dirLabel: p.dir === 1 ? 'LONG' : 'SHORT',
      method: p.method || 'manual',
      qty: p.qty,
      entryPriceFormatted: fmtPrice(p.entryPrice),
      exitPriceFormatted: p.status === 'open' ? (markPrice ? fmtPrice(markPrice) : (p.live?.mark ? fmtPrice(p.live.mark) : '—')) : fmtPrice(p.exitPrice),
      tpslFormatted,
      pnl,
      pnlPct,
      pnlFormatted: fmtSignedMoney(pnl),
      status: p.status,
      time: ago(p.status === 'open' ? p.entryTime : (p.exitTime || p.entryTime))
    }
  })
})

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

const agentRows = computed<AgentRow[]>(() => {
  let list = agents.value
  if (selectedAgentAccount.value !== 'all') {
    list = list.filter(a => (a.accountId || 'default') === selectedAgentAccount.value)
  }
  return list.map(a => {
    const accId = a.accountId || 'default'
    const r = (risk.value?.accounts ?? []).find(acc => acc.account === accId)
    const pnl = r?.realizedPnlAbs ?? 0
    const pnlPct = r?.realizedPnlPct ?? 0
    const paperAcc = paperAccounts.value.find(acc => acc.accountId === accId)
    const equity = (paperAcc?.initialBalance ?? 10000) + pnl

    let model = 'AI Model'
    if (a.name.toLowerCase().includes('gemini')) model = 'Gemini 1.5'
    else if (a.name.toLowerCase().includes('gpt')) model = 'GPT-4o'
    else if (a.name.toLowerCase().includes('deepseek')) model = 'DeepSeek R1'
    else if (gateway.value?.gateway.model) model = gateway.value.gateway.model

    return {
      id: a.agentId,
      name: a.name,
      description: a.description || '',
      model,
      accountId: accId,
      autonomy: a.autonomy,
      state: a.state,
      health: 'ok',
      versionCount: a.versionCount || 1,
      instruments: a.instruments || [],
      actions: `${a.actionCounts?.allowed ?? 0}/${a.actionCounts?.blocked ?? 0}`,
      allowed: a.actionCounts?.allowed ?? 0,
      blocked: a.actionCounts?.blocked ?? 0,
      pnl,
      pnlPct,
      pnlFormatted: fmtSignedMoney(pnl),
      equityFormatted: fmtMoney(equity),
      lastActive: ago(a.lastHeartbeatAt || a.lastEventAt),
      raw: a
    }
  })
})

// -----------------------------------------------------------------------------
//  Columns (accessorKey literals keep TanStack's generic column type happy)
// -----------------------------------------------------------------------------

const botColumns = computed(() => [
  { accessorKey: 'instanceId' as const, header: t('operationsCenter.cols.instance') },
  { accessorKey: 'bot' as const, header: t('operationsCenter.cols.bot') },
  { accessorKey: 'state' as const, header: t('operationsCenter.cols.state') },
  { accessorKey: 'health' as const, header: t('operationsCenter.cols.health') },
  { accessorKey: 'counts' as const, header: t('operationsCenter.cols.counts') },
  { accessorKey: 'equityFormatted' as const, header: t('operationsCenter.cols.equity') },
  { accessorKey: 'tradedVolumeFormatted' as const, header: t('operationsCenter.cols.tradedVolume') },
  { accessorKey: 'pnlFormatted' as const, header: t('operationsCenter.cols.pnl') },
  { accessorKey: 'startedAt' as const, header: t('operationsCenter.cols.started') },
  { accessorKey: 'actions' as const, header: '#', class: 'w-30' }
])

const positionColumns = computed(() => [
  { accessorKey: 'symbol' as const, header: t('operationsCenter.cols.symbol') },
  { accessorKey: 'dirLabel' as const, header: t('operationsCenter.cols.side') },
  { accessorKey: 'qty' as const, header: t('operationsCenter.cols.qty') },
  { accessorKey: 'entryPriceFormatted' as const, header: t('operationsCenter.cols.entryPrice') },
  { accessorKey: 'exitPriceFormatted' as const, header: t('operationsCenter.cols.exitPrice') },
  { accessorKey: 'tpslFormatted' as const, header: t('operationsCenter.cols.tpsl') },
  { accessorKey: 'pnlFormatted' as const, header: t('operationsCenter.cols.pnl') },
  { accessorKey: 'status' as const, header: t('operationsCenter.cols.status') },
  { accessorKey: 'time' as const, header: t('operationsCenter.cols.time') }
])

const alertColumns = computed(() => [
  { accessorKey: 'id' as const, header: t('operationsCenter.cols.key') },
  { accessorKey: 'symbol' as const, header: t('operationsCenter.cols.symbol') },
  { accessorKey: 'tf' as const, header: t('operationsCenter.cols.tf') },
  { accessorKey: 'action' as const, header: t('operationsCenter.cols.action') },
  { accessorKey: 'side' as const, header: t('operationsCenter.cols.side') },
  { accessorKey: 'price' as const, header: t('operationsCenter.cols.price') },
  { accessorKey: 'status' as const, header: t('operationsCenter.cols.status') },
  { accessorKey: 'ts' as const, header: t('operationsCenter.cols.time') }
])

const agentColumns = computed(() => [
  { accessorKey: 'name' as const, header: t('operationsCenter.cols.name') },
  { accessorKey: 'accountId' as const, header: t('operationsCenter.cols.account') },
  { accessorKey: 'autonomy' as const, header: t('operationsCenter.cols.level') },
  { accessorKey: 'state' as const, header: t('operationsCenter.cols.state') },
  { accessorKey: 'actions' as const, header: t('operationsCenter.cols.actions') },
  { accessorKey: 'pnlFormatted' as const, header: t('operationsCenter.cols.accountPnl') },
  { accessorKey: 'lastActive' as const, header: t('operationsCenter.cols.lastActive') },
  { accessorKey: 'actionItems' as const, header: '#', class: 'w-30' }
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
  positions: '/trading/positions',
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
  onConfirm: () => { }
})

function showConfirm(instanceId: string, action: 'start' | 'pause' | 'resume' | 'stop' | 'rerun' | 'continue' | 'haltAll') {
  const instance = botInstances.value.find(i => i.instanceId === instanceId)
  const botName = instance ? `${methodOf(instance.botProfileId)} · ${symbolOf(instance)} · ${timeframeOf(instance)}` : instanceId
  const labels: Record<string, string> = {
    start: 'actions.confirmStart',
    pause: 'actions.confirmPause',
    resume: 'actions.confirmResume',
    stop: 'actions.confirmStop',
    rerun: 'actions.confirmRerunReset',
    continue: 'actions.confirmRerunContinue',
    haltAll: 'actions.confirmHaltAll'
  }
  const actionText = action === 'rerun'
    ? t('operationsCenter.actions.rerunReset')
    : action === 'continue'
      ? t('operationsCenter.actions.rerunContinue')
      : t(`operationsCenter.actions.${action}`)

  const description = action === 'haltAll'
    ? t('operationsCenter.actions.confirmHaltAllDesc')
    : action === 'continue'
      ? t('operationsCenter.actions.confirmRerunContinueDesc')
      : t('operationsCenter.actions.confirmDesc', { action: actionText.toLowerCase(), bot: botName })

  confirmState.value = {
    open: true,
    instanceId,
    action,
    title: t(`operationsCenter.${labels[action]}`),
    description,
    onConfirm: () => executeAction(instanceId, action)
  }
}

async function executeAction(instanceId: string, action: string) {
  confirmState.value.open = false
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
    result = await botsApi.rerunInstance(instanceId, { mode: 'reset' })
  } else if (action === 'continue') {
    result = await botsApi.rerunInstance(instanceId, { mode: 'continue' })
  } else {
    result = await botsApi.enqueueCommand(instanceId, action as 'start' | 'pause' | 'resume' | 'stop')
  }

  pendingCmd.value[instanceId] = false

  if (result.success) {
    const successKey = action === 'continue' ? 'successContinue' : `success${action.charAt(0).toUpperCase() + action.slice(1)}`
    const successMsg = t(`operationsCenter.actions.${successKey}`)
    notify.success(successMsg)
    await loadAll()
  } else {
    const errMsg = result.error || t('operationsCenter.actions.errorGeneric')
    notify.error(`${errMsg} (${result.code})`)
  }
}

/** Re-probe a single service or all services. */
async function reprobeService(serviceName?: string) {
  const result = await healthApi.reprobeServices(serviceName)
  if (result.success) {
    notify.success(t('operationsCenter.actions.successReprobe'))
    const sys = await health.system()
    if (sys.data?.services) {
      services.value = sys.data.services
    }
  } else {
    notify.error(t('operationsCenter.actions.errorGeneric'))
  }
}

/** Bulk: start all queued instances. */
async function startAllQueued() {
  const queued = botInstances.value.filter(b => b.state === 'queued')
  for (const inst of queued) {
    const result = await botsApi.enqueueCommand(inst.instanceId, 'start')
    if (!result.success) {
      notify.error(`${t('operationsCenter.actions.errorGeneric')}: ${result.error}`)
      break
    }
  }
  if (queued.length) {
    notify.success(t('operationsCenter.actions.successStart'))
    await loadAll()
  }
}

/** Bulk: stop all running instances. */
async function stopAllRunning() {
  const running = botInstances.value.filter(b => b.state === 'running')
  for (const inst of running) {
    const result = await botsApi.enqueueCommand(inst.instanceId, 'stop')
    if (!result.success) {
      notify.error(`${t('operationsCenter.actions.errorGeneric')}: ${result.error}`)
      break
    }
  }
  if (running.length) {
    notify.success(t('operationsCenter.actions.successStop'))
    await loadAll()
  }
}

/** Run all services once. */
async function runAllServices() {
  const result = await $fetch<{ success: boolean; data?: any }>('/api/v1/admin/services/run-once', { method: 'POST' })
  if (result.success) {
    notify.success(t('operationsCenter.actions.successRunAllServices'))
    await loadAll()
  } else {
    notify.error(t('operationsCenter.actions.errorGeneric'))
  }
}

/** Build dropdown items for a bot instance row (uses Nuxt UI :items prop format). */
function botActionItems(instance: BotInstance): Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }> {
  const actions: Array<{ label: string; icon?: string; color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'; onSelect: () => void; disabled?: boolean }> = []

  const baseDisabled = pendingCmd.value[instance.instanceId] === true

  // 1. Action Xem chi tiết luôn nằm đầu menu thả xuống
  actions.push({
    label: t('operationsCenter.botModal.viewDetail'),
    icon: 'i-lucide-activity',
    color: 'primary',
    onSelect: () => {
      const row = botRows.value.find(r => r.instanceId === instance.instanceId)
      if (row) openBotDetail(row)
    }
  })

  switch (instance.state) {
    case 'queued':
      actions.push({
        label: t('operationsCenter.actions.start'),
        icon: 'i-lucide-play',
        color: 'success',
        onSelect: () => showConfirm(instance.instanceId, 'start'),
        disabled: baseDisabled
      })
      break
    case 'starting':
      actions.push({
        label: t('operationsCenter.actions.stop'),
        icon: 'i-lucide-stop-circle',
        color: 'error',
        onSelect: () => showConfirm(instance.instanceId, 'stop'),
        disabled: baseDisabled
      })
      break
    case 'running':
      actions.push(
        { label: t('operationsCenter.actions.pause'), icon: 'i-lucide-pause', color: 'warning', onSelect: () => showConfirm(instance.instanceId, 'pause'), disabled: baseDisabled },
        { label: t('operationsCenter.actions.stop'), icon: 'i-lucide-stop-circle', color: 'error', onSelect: () => showConfirm(instance.instanceId, 'stop'), disabled: baseDisabled }
      )
      break
    case 'paused':
      actions.push(
        { label: t('operationsCenter.actions.resume'), icon: 'i-lucide-play', color: 'success', onSelect: () => showConfirm(instance.instanceId, 'resume'), disabled: baseDisabled },
        { label: t('operationsCenter.actions.stop'), icon: 'i-lucide-stop-circle', color: 'error', onSelect: () => showConfirm(instance.instanceId, 'stop'), disabled: baseDisabled }
      )
      break
    case 'completed':
    case 'failed':
    case 'halted':
      actions.push(
        {
          label: t('operationsCenter.actions.rerunReset'),
          icon: 'i-lucide-rotate-ccw',
          color: 'primary',
          onSelect: () => showConfirm(instance.instanceId, 'rerun'),
          disabled: baseDisabled
        },
        {
          label: t('operationsCenter.actions.rerunContinue'),
          icon: 'i-lucide-play-circle',
          color: 'success',
          onSelect: () => showConfirm(instance.instanceId, 'continue'),
          disabled: baseDisabled
        }
      )
      break
  }

  return actions
}
</script>

<template>
  <BasePage id="admin-operations-center" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('operationsCenter.pip')" />
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

    <div v-else class="space-y-4 pb-6">
      <!-- KPI row (each card is a quick link to the owning page and activates the matching tab) -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 lg:gap-4">
        <!-- Services KPI Card -->
        <NuxtLink :to="LINKS.services" class="group block rounded-lg focus-visible:outline-2 outline-primary"
          :title="t('operationsCenter.links.services')">
          <UCard
            class="p-2.5 sm:p-3.5 lg:p-4 border-l-3 sm:border-l-4 border-l-success h-full transition-colors duration-150 group-hover:border-success/70">
            <div class="flex items-start justify-between gap-1">
              <div class="min-w-0 flex-1">
                <p class="text-xs sm:text-sm text-muted truncate">{{ t('operationsCenter.kpi.services') }}</p>
                <p class="text-xl sm:text-2xl font-bold leading-tight mt-0.5">{{ serviceSummary.total }}</p>
                <p class="text-[11px] sm:text-xs mt-1 truncate">
                  <span class="text-success mr-1.5">{{ serviceSummary.ok }} {{ t('operationsCenter.kpi.ok') }}</span>
                  <span v-if="serviceSummary.overdue > 0" class="text-error mr-1.5">{{ serviceSummary.overdue }} {{
                    t('operationsCenter.kpi.overdue') }}</span>
                  <span class="text-muted hidden xs:inline">{{ serviceSummary.never }} {{
                    t('operationsCenter.kpi.never')
                    }}</span>
                </p>
              </div>
              <UIcon name="i-lucide-server-cog"
                class="w-6 h-6 sm:w-8 sm:h-8 text-success/30 transition-colors group-hover:text-success/70 shrink-0" />
            </div>
          </UCard>
        </NuxtLink>

        <!-- Bots KPI Card -->
        <div role="button" tabindex="0"
          class="group block rounded-lg cursor-pointer focus-visible:outline-2 outline-primary transition"
          :title="t('operationsCenter.links.bots')" @click="activeTab = 'bots'" @keydown.enter="activeTab = 'bots'"
          @keydown.space.prevent="activeTab = 'bots'">
          <UCard
            class="p-2.5 sm:p-3.5 lg:p-4 border-l-3 sm:border-l-4 border-l-primary h-full transition-colors duration-150 group-hover:border-primary/70"
            :class="activeTab === 'bots' ? 'ring-2 ring-primary/40 border-primary/70' : ''">
            <div class="flex items-start justify-between gap-1">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <p class="text-xs sm:text-sm text-muted truncate">{{ t('operationsCenter.kpi.bots') }}</p>
                  <NuxtLink :to="LINKS.bots" class="text-muted hover:text-primary transition shrink-0"
                    :title="t('operationsCenter.links.bots')" @click.stop>
                    <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </NuxtLink>
                </div>
                <div class="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                  <p class="text-xl sm:text-2xl font-bold leading-tight">{{ botSummary.total }}</p>
                  <span class="font-mono text-xs sm:text-sm font-semibold text-highlighted">
                    {{ fmtMoney(botSummary.totalEquity) }}
                  </span>
                </div>
                <p class="text-[11px] sm:text-xs mt-1 truncate">
                  <span class="font-mono font-medium mr-1.5"
                    :class="botSummary.totalPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtSignedMoney(botSummary.totalPnl) }} ({{ fmtPct(botSummary.pnlPct) }})
                  </span>
                  <span class="text-muted hidden xs:inline">
                    · {{ botSummary.running }} {{ t('operationsCenter.kpi.running') }}
                  </span>
                </p>
              </div>
              <UIcon name="i-lucide-bot"
                class="w-6 h-6 sm:w-8 sm:h-8 text-primary/30 transition-colors group-hover:text-primary/70 shrink-0" />
            </div>
          </UCard>
        </div>

        <!-- Alerts KPI Card -->
        <div role="button" tabindex="0"
          class="group block rounded-lg cursor-pointer focus-visible:outline-2 outline-primary transition"
          :title="t('operationsCenter.links.alerts')" @click="activeTab = 'alerts'"
          @keydown.enter="activeTab = 'alerts'" @keydown.space.prevent="activeTab = 'alerts'">
          <UCard
            class="p-2.5 sm:p-3.5 lg:p-4 border-l-3 sm:border-l-4 border-l-warning h-full transition-colors duration-150 group-hover:border-warning/70"
            :class="activeTab === 'alerts' ? 'ring-2 ring-warning/40 border-warning/70' : ''">
            <div class="flex items-start justify-between gap-1">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <p class="text-xs sm:text-sm text-muted truncate">{{ t('operationsCenter.kpi.alerts') }}</p>
                  <NuxtLink :to="LINKS.alerts" class="text-muted hover:text-warning transition shrink-0"
                    :title="t('operationsCenter.links.alerts')" @click.stop>
                    <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </NuxtLink>
                </div>
                <p class="text-xl sm:text-2xl font-bold leading-tight mt-0.5">{{ alertSummary.total }}</p>
                <p class="text-[11px] sm:text-xs mt-1 text-muted truncate">
                  {{ alertSummary.entries }} {{ t('operationsCenter.kpi.entries') }}
                  <span v-if="alertSummary.last" class="hidden xs:inline"> · {{ ago(alertSummary.last) }}</span>
                </p>
              </div>
              <UIcon name="i-lucide-radio-tower"
                class="w-6 h-6 sm:w-8 sm:h-8 text-warning/30 transition-colors group-hover:text-warning/70 shrink-0" />
            </div>
          </UCard>
        </div>

        <!-- AI Agents KPI Card -->
        <div role="button" tabindex="0"
          class="group block rounded-lg cursor-pointer focus-visible:outline-2 outline-primary transition"
          :title="t('operationsCenter.links.agents')" @click="activeTab = 'agents'"
          @keydown.enter="activeTab = 'agents'" @keydown.space.prevent="activeTab = 'agents'">
          <UCard
            class="p-2.5 sm:p-3.5 lg:p-4 border-l-3 sm:border-l-4 border-l-info h-full transition-colors duration-150 group-hover:border-info/70"
            :class="activeTab === 'agents' ? 'ring-2 ring-info/40 border-info/70' : ''">
            <div class="flex items-start justify-between gap-1">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <p class="text-xs sm:text-sm text-muted truncate">{{ t('operationsCenter.kpi.agents') }}</p>
                  <NuxtLink :to="LINKS.agents" class="text-muted hover:text-info transition shrink-0"
                    :title="t('operationsCenter.links.agents')" @click.stop>
                    <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </NuxtLink>
                </div>
                <p class="text-xl sm:text-2xl font-bold leading-tight mt-0.5">{{ agentSummary.total }}</p>
                <p class="text-[11px] sm:text-xs mt-1 truncate">
                  <span class="text-success mr-1.5">{{ agentSummary.active }} {{ t('operationsCenter.kpi.active')
                    }}</span>
                  <span class="text-info hidden xs:inline">{{ agentSummary.validated }} {{
                    t('operationsCenter.kpi.validated') }}</span>
                </p>
                <p v-if="gateway"
                  class="text-[9px] sm:text-[10px] text-muted mt-0.5 font-mono truncate hidden sm:block">
                  {{ gateway.gateway.provider }}/{{ gateway.gateway.model }}
                  <span :class="gateway.gateway.configured ? 'text-success' : 'text-error'">
                    {{ gateway.gateway.configured ? '●' : '○' }}
                  </span>
                </p>
              </div>
              <UIcon name="i-lucide-brain-circuit"
                class="w-6 h-6 sm:w-8 sm:h-8 text-info/30 transition-colors group-hover:text-info/70 shrink-0" />
            </div>
          </UCard>
        </div>
      </div>

      <!-- Main Unified Operations Console: Tabs (Bots, Positions, Alerts, AI Agents) with bounded scroll height -->
      <UCard>
        <template #header>
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <!-- Tabs -->
            <UTabs v-model="activeTab" :items="tabItems" :content="false" size="sm" class="w-full sm:w-auto" />

            <!-- Contextual action buttons based on active tab -->
            <div class="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <template v-if="activeTab === 'bots'">
                <UButton v-if="botSummary.running > 0" :label="t('operationsCenter.actions.stopAllRunning')"
                  color="error" variant="soft" size="xs" @click="showConfirm('', 'haltAll')"
                  class="hidden sm:inline-flex" />
                <UButton v-if="botSummary.running === 0 && botSummary.paused > 0"
                  :label="t('operationsCenter.actions.startAllQueued')" color="success" variant="soft" size="xs"
                  @click="startAllQueued" class="hidden sm:inline-flex" />
                <NuxtLink :to="LINKS.bots"
                  class="text-xs text-primary inline-flex items-center gap-1 hover:underline ml-1"
                  :title="t('operationsCenter.links.bots')">
                  {{ t('operationsCenter.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </template>

              <template v-else-if="activeTab === 'positions'">
                <UBadge color="success" variant="subtle" size="xs"
                  :label="`${positionSummary.open} ${t('operationsCenter.openPositions')}`" />
                <NuxtLink :to="LINKS.positions"
                  class="text-xs text-primary inline-flex items-center gap-1 hover:underline ml-1"
                  :title="t('operationsCenter.links.positions')">
                  {{ t('operationsCenter.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </template>

              <template v-else-if="activeTab === 'alerts'">
                <UBadge v-if="alertSummary.entries > 0" color="warning" variant="subtle" size="xs"
                  :label="`${alertSummary.entries} ${t('operationsCenter.kpi.entries')}`" />
                <NuxtLink :to="LINKS.alerts"
                  class="text-xs text-primary inline-flex items-center gap-1 hover:underline ml-1"
                  :title="t('operationsCenter.links.alerts')">
                  {{ t('operationsCenter.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </template>

              <template v-else-if="activeTab === 'agents'">
                <UButton v-if="agentSummary.draft > 0" :label="`Activate ${agentSummary.draft} draft`" color="success"
                  variant="soft" size="xs" @click="() => notify.info('Bulk activate not yet implemented')"
                  class="hidden sm:inline-flex" />
                <NuxtLink :to="LINKS.agents"
                  class="text-xs text-primary inline-flex items-center gap-1 hover:underline ml-1"
                  :title="t('operationsCenter.links.agents')">
                  {{ t('operationsCenter.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </template>
            </div>
          </div>
        </template>

        <!-- Bounded Height Scroll Container -->
        <div class="max-h-[460px] overflow-y-auto overflow-x-auto relative rounded">
          <!-- BOTS TAB -->
          <div v-if="activeTab === 'bots'" class="space-y-3">
            <!-- Bot Financial & Performance Ribbon -->
            <div
              class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 p-3 rounded-lg bg-elevated/40 border border-default/60">
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">{{ t('operationsCenter.ribbon.allocatedCapital') }}</span>
                <span class="font-mono text-sm sm:text-base font-bold text-highlighted">
                  {{ fmtMoney(botSummary.totalEquity) }}
                </span>
                <span class="text-[10px] text-muted">
                  {{ botSummary.total }} bots
                </span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">{{ t('operationsCenter.ribbon.tradedVolume') }}</span>
                <span class="font-mono text-sm sm:text-base font-bold text-primary">
                  {{ fmtMoney(botSummary.totalTradedVolume) }}
                </span>
                <span class="text-[10px] text-muted font-mono truncate"
                  :title="t('operationsCenter.botModal.tradeVolumeHint')">
                  {{ t('operationsCenter.botModal.tradeVolumeHint') }}
                </span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">{{ t('operationsCenter.ribbon.netPnl') }}</span>
                <div class="flex items-baseline gap-1">
                  <span class="font-mono text-sm sm:text-base font-bold"
                    :class="botSummary.totalPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtSignedMoney(botSummary.totalPnl) }}
                  </span>
                  <span class="text-[11px] font-mono font-semibold"
                    :class="botSummary.pnlPct >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtPct(botSummary.pnlPct) }}
                  </span>
                </div>
                <span class="text-[10px] text-muted">ROI / Capital</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">{{ t('operationsCenter.ribbon.botStatus') }}</span>
                <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <UBadge color="success" variant="subtle" size="xs"
                    :label="`${botSummary.running} ${t('operationsCenter.kpi.running')}`" />
                  <UBadge v-if="botSummary.paused > 0" color="warning" variant="subtle" size="xs"
                    :label="`${botSummary.paused} ${t('operationsCenter.kpi.paused')}`" />
                  <UBadge v-if="botSummary.failed > 0" color="error" variant="subtle" size="xs"
                    :label="`${botSummary.failed} ${t('operationsCenter.kpi.failed')}`" />
                </div>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-muted">{{ t('operationsCenter.ribbon.tradesCount') }}</span>
                <span class="font-mono text-sm sm:text-base font-semibold">
                  {{ botSummary.totalTrades }} trades
                </span>
                <span class="text-[10px] text-muted font-mono">
                  {{ botSummary.totalOrders }} ord · {{ botSummary.totalSignals }} sig
                </span>
              </div>
            </div>

            <!-- Bot Instances Table -->
            <UTable :data="botRows" :columns="botColumns" :empty="t('operationsCenter.botsEmpty')"
              class="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:bg-elevated/95 [&_thead]:backdrop-blur [&_thead]:z-10">
              <template #instanceId-cell="{ row }">
                <NuxtLink :to="botHref(row.original.instanceId)" class="font-mono text-xs text-primary hover:underline"
                  :title="`${row.original.instanceId} · ${t('operationsCenter.openItem')}`">
                  {{ shortInstance(row.original) }}
                </NuxtLink>
              </template>
              <template #bot-cell="{ row }">
                <NuxtLink :to="botHref(row.original.instanceId)"
                  class="text-xs truncate inline-block max-w-[200px] hover:text-primary hover:underline"
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
              <template #equityFormatted-cell="{ row }">
                <span class="font-mono text-xs font-semibold text-highlighted">{{ row.original.equityFormatted }}</span>
              </template>
              <template #tradedVolumeFormatted-cell="{ row }">
                <span class="font-mono text-xs text-muted">{{ row.original.tradedVolumeFormatted }}</span>
              </template>
              <template #pnlFormatted-cell="{ row }">
                <div class="flex flex-col">
                  <span class="font-mono text-xs font-semibold"
                    :class="row.original.pnl >= 0 ? 'text-success' : 'text-error'">
                    {{ row.original.pnlFormatted }}
                  </span>
                  <span class="text-[10px] font-mono"
                    :class="row.original.pnlPct >= 0 ? 'text-success/80' : 'text-error/80'">
                    {{ fmtPct(row.original.pnlPct) }}
                  </span>
                </div>
              </template>
              <template #actions-cell="{ row }">
                <div class="flex items-center justify-start">
                  <UDropdownMenu v-if="row.original.actionItems.length" :items="row.original.actionItems">
                    <UButton variant="ghost" size="xs" icon="i-lucide-ellipsis-vertical" data-testid="btn-bot-dropdown"
                      :disabled="pendingCmd[row.original.instanceId]" aria-label="Bot actions" />
                  </UDropdownMenu>
                </div>
              </template>
            </UTable>
          </div>

          <!-- POSITIONS TAB (Lệnh đang mở và đã đóng) -->
          <div v-else-if="activeTab === 'positions'" class="space-y-3">
            <!-- Filter Bar + Summary Metrics -->
            <div
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-elevated/40 border border-default/60">
              <!-- Filter Segment -->
              <div class="flex items-center gap-1.5 flex-wrap">
                <UButton :color="positionFilter === 'all' ? 'primary' : 'neutral'"
                  :variant="positionFilter === 'all' ? 'soft' : 'ghost'" size="xs" @click="positionFilter = 'all'">
                  {{ t('operationsCenter.allPositions') }} ({{ positionSummary.total }})
                </UButton>
                <UButton :color="positionFilter === 'open' ? 'success' : 'neutral'"
                  :variant="positionFilter === 'open' ? 'soft' : 'ghost'" size="xs" @click="positionFilter = 'open'">
                  <span class="w-1.5 h-1.5 rounded-full bg-success mr-1"></span>
                  {{ t('operationsCenter.openPositions') }} ({{ positionSummary.open }})
                </UButton>
                <UButton :color="positionFilter === 'closed' ? 'primary' : 'neutral'"
                  :variant="positionFilter === 'closed' ? 'soft' : 'ghost'" size="xs"
                  @click="positionFilter = 'closed'">
                  {{ t('operationsCenter.closedPositions') }} ({{ positionSummary.closed }})
                </UButton>
              </div>

              <!-- Metrics -->
              <div class="flex items-center gap-3 text-xs">
                <div>
                  <span class="text-muted mr-1">{{ t('operationsCenter.ribbon.realizedPnl') }}:</span>
                  <span class="font-mono font-semibold"
                    :class="positionSummary.realizedPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtSignedMoney(positionSummary.realizedPnl) }}
                  </span>
                </div>
                <div class="hidden xs:block">
                  <span class="text-muted mr-1">{{ t('operationsCenter.ribbon.unrealizedPnl') }}:</span>
                  <span class="font-mono font-semibold"
                    :class="positionSummary.unrealizedPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtSignedMoney(positionSummary.unrealizedPnl) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Positions Table -->
            <UTable :data="positionRows" :columns="positionColumns" :empty="t('operationsCenter.positionsEmpty')"
              class="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:bg-elevated/95 [&_thead]:backdrop-blur [&_thead]:z-10">
              <template #symbol-cell="{ row }">
                <NuxtLink :to="LINKS.positions" class="flex flex-col hover:text-primary hover:underline"
                  :title="row.original.symbol">
                  <span class="font-semibold text-xs">{{ row.original.symbol }}</span>
                  <span class="text-[10px] text-muted font-mono">{{ row.original.method }}</span>
                </NuxtLink>
              </template>
              <template #dirLabel-cell="{ row }">
                <UBadge :color="row.original.dir === 1 ? 'success' : 'error'" variant="subtle" size="xs">
                  {{ row.original.dirLabel }}
                </UBadge>
              </template>
              <template #qty-cell="{ row }">
                <span class="font-mono text-xs">{{ row.original.qty }}</span>
              </template>
              <template #entryPriceFormatted-cell="{ row }">
                <span class="font-mono text-xs">{{ row.original.entryPriceFormatted }}</span>
              </template>
              <template #exitPriceFormatted-cell="{ row }">
                <span class="font-mono text-xs">{{ row.original.exitPriceFormatted }}</span>
              </template>
              <template #tpslFormatted-cell="{ row }">
                <span class="font-mono text-[11px] text-muted">{{ row.original.tpslFormatted }}</span>
              </template>
              <template #pnlFormatted-cell="{ row }">
                <div class="flex flex-col">
                  <span class="font-mono text-xs font-semibold"
                    :class="row.original.pnl >= 0 ? 'text-success' : 'text-error'">
                    {{ row.original.pnlFormatted }}
                  </span>
                  <span class="text-[10px] font-mono"
                    :class="row.original.pnlPct >= 0 ? 'text-success/80' : 'text-error/80'">
                    {{ fmtPct(row.original.pnlPct) }}
                  </span>
                </div>
              </template>
              <template #status-cell="{ row }">
                <UBadge :color="row.original.status === 'open' ? 'success' : 'neutral'" variant="subtle" size="xs">
                  {{ row.original.status === 'open' ? t('operationsCenter.kpi.open') : t('operationsCenter.kpi.closed')
                  }}
                </UBadge>
              </template>
              <template #time-cell="{ row }">
                <span class="text-xs text-muted font-mono">{{ row.original.time }}</span>
              </template>
            </UTable>
          </div>

          <!-- ALERTS TAB -->
          <div v-else-if="activeTab === 'alerts'">
            <UTable :data="alertRows" :columns="alertColumns" :empty="t('operationsCenter.alertsEmpty')"
              class="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:bg-elevated/95 [&_thead]:backdrop-blur [&_thead]:z-10">
              <template #id-cell="{ row }">
                <NuxtLink :to="alertHref(row.original)" class="font-mono text-[10px] text-primary hover:underline"
                  :title="`${row.original.id} · ${t('operationsCenter.openItem')}`">
                  {{ row.original.id.slice(0, 8) }}
                </NuxtLink>
              </template>
              <template #symbol-cell="{ row }">
                <NuxtLink :to="alertHref(row.original)"
                  class="text-xs font-semibold hover:text-primary hover:underline">
                  {{ row.original.symbol }}
                </NuxtLink>
              </template>
              <template #status-cell="{ row }">
                <UDropdownMenu class="w-36" :items="[
                  { label: t('operationsCenter.actions.acknowledge'), icon: 'i-lucide-check', onSelect: () => notify.success('Alert acknowledged') },
                  { label: t('operationsCenter.actions.dismiss'), icon: 'i-lucide-x', color: 'error', onSelect: () => notify.warning('Alert dismissed') }
                ]">
                  <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" class="h-6 w-6 p-0"
                    aria-label="Alert actions" />
                </UDropdownMenu>
              </template>
            </UTable>
          </div>

          <!-- AGENTS TAB (AI Bot Quản trị, Hành động, Tài khoản & PnL) -->
          <div v-else-if="activeTab === 'agents'" class="space-y-3">
            <!-- Filter Bar + Account Performance Ribbon -->
            <div
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-elevated/40 border border-default/60">
              <!-- Account Filter Selector -->
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs text-muted mr-1 flex items-center gap-1">
                  <UIcon name="i-lucide-wallet" class="w-3.5 h-3.5 text-primary" />
                  {{ t('operationsCenter.filterAccount') }}:
                </span>
                <UButton :color="selectedAgentAccount === 'all' ? 'primary' : 'neutral'"
                  :variant="selectedAgentAccount === 'all' ? 'soft' : 'ghost'" size="xs"
                  @click="selectedAgentAccount = 'all'">
                  {{ t('operationsCenter.allAccounts') }} ({{ agents.length }})
                </UButton>
                <UButton v-for="accId in agentAccounts" :key="accId"
                  :color="selectedAgentAccount === accId ? 'primary' : 'neutral'"
                  :variant="selectedAgentAccount === accId ? 'soft' : 'ghost'" size="xs" class="font-mono"
                  @click="selectedAgentAccount = accId">
                  {{ accId }} ({{agents.filter(a => (a.accountId || 'default') === accId).length}})
                </UButton>
              </div>

              <!-- Selected Account Performance Metrics -->
              <div class="flex items-center gap-3 text-xs flex-wrap">
                <div>
                  <span class="text-muted mr-1">{{ t('operationsCenter.ribbon.accountEquity') }}:</span>
                  <span class="font-mono font-semibold text-highlighted">{{ fmtMoney(selectedAccountData.equity)
                    }}</span>
                </div>
                <div>
                  <span class="text-muted mr-1">{{ t('operationsCenter.ribbon.netPnl') }}:</span>
                  <span class="font-mono font-semibold"
                    :class="selectedAccountData.realizedPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ fmtSignedMoney(selectedAccountData.realizedPnl) }} ({{ fmtPct(selectedAccountData.pnlPct) }})
                  </span>
                </div>
                <div class="hidden md:block">
                  <span class="text-muted mr-1">{{ t('operationsCenter.ribbon.totalActions') }}:</span>
                  <span class="font-mono text-success font-semibold">{{ agentSummary.allowed }}</span>
                  <span class="text-muted"> / </span>
                  <span class="font-mono"
                    :class="agentSummary.blocked > 0 ? 'text-error font-semibold' : 'text-muted'">{{
                      agentSummary.blocked }}</span>
                </div>
              </div>
            </div>

            <!-- Agents Table -->
            <UTable :data="agentRows" :columns="agentColumns" :empty="t('operationsCenter.agentsEmpty')"
              class="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:bg-elevated/95 [&_thead]:backdrop-blur [&_thead]:z-10">
              <!-- Name & Model Cell -->
              <template #name-cell="{ row }">
                <button type="button" class="text-left group flex items-start gap-2 max-w-[260px]"
                  @click="openAgentDetail(row.original)">
                  <div
                    class="w-7 h-7 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-info/20 transition-colors">
                    <UIcon name="i-lucide-brain" class="w-4 h-4" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span
                        class="text-xs font-semibold text-highlighted group-hover:text-primary transition-colors truncate">
                        {{ row.original.name }}
                      </span>
                      <UBadge color="info" variant="subtle" size="xs">
                        {{ row.original.model }}
                      </UBadge>
                    </div>
                    <p class="text-[11px] text-muted truncate mt-0.5" :title="row.original.description">
                      {{ row.original.description || row.original.id }}
                    </p>
                  </div>
                </button>
              </template>

              <!-- Account Cell -->
              <template #accountId-cell="{ row }">
                <button type="button"
                  class="font-mono text-xs hover:text-primary transition-colors flex items-center gap-1"
                  :title="`Filter by ${row.original.accountId}`" @click="selectedAgentAccount = row.original.accountId">
                  <UBadge color="neutral" variant="outline" size="xs">
                    <UIcon name="i-lucide-wallet" class="w-3 h-3 mr-1 text-primary" />
                    {{ row.original.accountId }}
                  </UBadge>
                </button>
              </template>

              <!-- Autonomy Level Cell -->
              <template #autonomy-cell="{ row }">
                <UBadge :color="autonomyColor(row.original.autonomy)" variant="subtle" size="sm">
                  {{ row.original.autonomy }} · {{ row.original.autonomy === 'A0' ? 'Advice' : row.original.autonomy ===
                    'A1' ? 'Proposal' : 'Orders' }}
                </UBadge>
              </template>

              <!-- State Cell -->
              <template #state-cell="{ row }">
                <div class="flex items-center gap-1.5">
                  <UBadge :color="botStateColor(row.original.state)" variant="subtle" size="sm"
                    :label="row.original.state" />
                  <span class="w-1.5 h-1.5 rounded-full"
                    :class="row.original.health === 'ok' ? 'bg-success' : 'bg-warning'"
                    :title="`Health: ${row.original.health}`"></span>
                </div>
              </template>

              <!-- Actions Count Cell (Allowed/Blocked) -->
              <template #actions-cell="{ row }">
                <div class="flex items-center gap-1 font-mono text-xs">
                  <span class="text-success font-semibold" :title="`${row.original.allowed} allowed`">{{
                    row.original.allowed }}</span>
                  <span class="text-muted">/</span>
                  <span :class="row.original.blocked > 0 ? 'text-error font-semibold' : 'text-muted'"
                    :title="`${row.original.blocked} blocked`">
                    {{ row.original.blocked }}
                  </span>
                </div>
              </template>

              <!-- PnL Cell -->
              <template #pnlFormatted-cell="{ row }">
                <div class="flex flex-col">
                  <span class="font-mono text-xs font-semibold"
                    :class="row.original.pnl >= 0 ? 'text-success' : 'text-error'">
                    {{ row.original.pnlFormatted }}
                  </span>
                  <span class="text-[10px] font-mono"
                    :class="row.original.pnlPct >= 0 ? 'text-success/80' : 'text-error/80'">
                    {{ fmtPct(row.original.pnlPct) }}
                  </span>
                </div>
              </template>

              <!-- Last Active Cell -->
              <template #lastActive-cell="{ row }">
                <span class="text-xs text-muted font-mono">{{ row.original.lastActive }}</span>
              </template>

              <!-- Detail Action Dropdown Cell -->
              <template #actionItems-cell="{ row }">
                <div class="flex items-center justify-start">
                  <UDropdownMenu :items="[
                    { label: t('operationsCenter.botModal.viewDetail'), icon: 'i-lucide-activity', onSelect: () => openAgentDetail(row.original) },
                    { label: row.original.state === 'active' ? t('aiAgents.pause') : t('aiAgents.start'), icon: row.original.state === 'active' ? 'i-lucide-pause' : 'i-lucide-play', color: row.original.state === 'active' ? 'warning' : 'primary', onSelect: () => handleAgentMove(row.original.state === 'active' ? 'pause' : 'start') }
                  ]">
                    <UButton variant="ghost" size="xs" icon="i-lucide-ellipsis-vertical"
                      data-testid="btn-agent-dropdown" aria-label="AI Agent actions" />
                  </UDropdownMenu>
                </div>
              </template>
            </UTable>
          </div>
        </div>
      </UCard>

      <!-- System Core Diagnostics (2 Balanced Columns: Service Heartbeats & Market/Risk Diagnostics) -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <!-- Service Heartbeats -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <h3 class="font-semibold">{{ t('operationsCenter.servicesTitle') }}</h3>
                <UBadge color="success" variant="subtle" size="xs"
                  :label="`${serviceSummary.ok}/${serviceSummary.total} OK`" />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted hidden sm:inline">{{ t('operationsCenter.updated') }} {{ ago(now)
                  }}</span>
                <UButton :label="t('operationsCenter.actions.reprobeAll')" color="primary" variant="outline" size="xs"
                  @click="() => reprobeService()" class="hidden sm:inline-flex" />
                <UButton :label="t('operationsCenter.runAllServices')" color="success" variant="soft" size="xs"
                  @click="runAllServices" class="hidden sm:inline-flex" />
                <NuxtLink :to="LINKS.services"
                  class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  :title="t('operationsCenter.links.services')">
                  {{ t('operationsCenter.viewAll') }}
                  <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
                </NuxtLink>
              </div>
            </div>
          </template>

          <div class="max-h-[380px] overflow-y-auto pr-1">
            <div v-if="services.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div v-for="s in services" :key="s.name"
                class="p-2.5 rounded-lg bg-elevated/50 border border-default flex flex-col justify-between gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-xs font-medium truncate" :title="s.name">{{ s.name }}</span>
                  <UBadge :color="serviceStateColor(serviceState(s))" variant="subtle" size="xs"
                    :label="t(`operationsCenter.serviceStates.${serviceState(s)}`)" />
                </div>
                <div class="text-[11px] text-muted flex items-center justify-between">
                  <span>{{ t('operationsCenter.service.runs') }}: {{ s.count }}</span>
                  <span>{{ ago(s.lastOkAt) }}</span>
                </div>
                <p v-if="s.lastError" class="text-[10px] text-error truncate" :title="s.lastError">
                  {{ t('operationsCenter.service.err') }}: {{ s.lastError }}
                </p>
                <UButton :label="t('operationsCenter.actions.reprobe')" color="primary" variant="ghost" size="xs"
                  class="w-full text-xs h-6 py-0 mt-0.5" @click="() => reprobeService(s.name)" />
              </div>
            </div>
            <p v-else class="text-sm text-muted py-4 text-center">{{ t('operationsCenter.servicesEmpty') }}</p>
          </div>
        </UCard>

        <!-- Market & Risk Diagnostics -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-semibold">{{ t('operationsCenter.marketTitle') }}</h3>
              <NuxtLink :to="LINKS.venues" class="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                :title="t('operationsCenter.links.venues')">
                {{ t('operationsCenter.viewAll') }}
                <UIcon name="i-lucide-arrow-up-right" class="w-3 h-3" />
              </NuxtLink>
            </div>
          </template>

          <div class="max-h-[380px] overflow-y-auto pr-1 space-y-3">
            <!-- Market data venues -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div v-for="v in venues" :key="v.venue"
                class="p-2.5 rounded-lg bg-elevated/50 border border-default flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted truncate">{{ v.venue }}</p>
                  <NuxtLink :to="LINKS.venues" class="text-xs text-primary hover:underline"
                    :title="t('operationsCenter.links.venues')">
                    <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                  </NuxtLink>
                </div>
                <p class="font-mono text-xs font-semibold" :class="v.status === 'up' ? 'text-success' : 'text-error'">
                  {{ v.status === 'up' ? '●' : '○' }} {{ v.status }}
                  <span v-if="v.latencyMs" class="text-muted font-normal text-[11px]">({{ v.latencyMs }}ms)</span>
                </p>
                <p v-if="v.error" class="text-[10px] text-error line-clamp-2 break-all" :title="v.error">
                  {{ v.error }}
                </p>
                <UButton :label="t('operationsCenter.actions.reprobe')" color="primary" variant="ghost" size="xs"
                  class="w-full text-xs h-6 py-0 mt-auto" @click="reprobeService(v.venue)" />
              </div>
            </div>

            <!-- Risk gate & drift -->
            <div class="grid grid-cols-2 gap-2.5">
              <div class="p-2.5 rounded-lg bg-elevated/50 border border-default flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted">{{ t('operationsCenter.market.risk') }} ({{ risk?.day ?? '—' }})</p>
                  <NuxtLink :to="LINKS.risk" class="text-xs text-primary hover:underline"
                    :title="t('operationsCenter.links.risk')">
                    <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                  </NuxtLink>
                </div>
                <p class="font-mono text-xs font-semibold" :class="riskSummary.halted ? 'text-error' : 'text-success'">
                  {{ riskSummary.halted ? t('operationsCenter.market.halted') : t('operationsCenter.market.ok') }}
                </p>
                <p class="text-[11px] text-muted">
                  {{ t('operationsCenter.market.openPositions') }}: {{ risk?.openPositions ?? 0 }}
                  · {{ t('operationsCenter.market.dayPnl') }}:
                  <span :class="riskSummary.dayPnl >= 0 ? 'text-success' : 'text-error'">
                    {{ riskSummary.dayPnl.toFixed(2) }}
                  </span>
                </p>
                <UButton v-if="!riskSummary.halted" :label="t('operationsCenter.actions.haltAll')" color="error"
                  variant="outline" size="xs" class="w-full text-xs h-6 py-0 mt-auto"
                  @click="showConfirm('', 'haltAll')" />
              </div>

              <NuxtLink :to="LINKS.drift" :title="t('operationsCenter.links.drift')"
                class="group p-2.5 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted">{{ t('operationsCenter.market.drift') }}</p>
                  <UIcon name="i-lucide-external-link" class="w-3 h-3 text-muted group-hover:text-primary" />
                </div>
                <p class="font-mono text-xs font-semibold" :class="risk?.drift?.breach ? 'text-error' : 'text-success'">
                  {{ risk?.drift?.breach ? t('operationsCenter.market.breach') : t('operationsCenter.market.ok') }}
                </p>
                <p class="text-[11px] text-muted">
                  {{ t('operationsCenter.market.checked') }}: {{ risk?.drift?.checked ?? 0 }}
                  · {{ t('operationsCenter.market.diverged') }}: {{ risk?.drift?.diverged ?? 0 }}
                </p>
                <p v-if="risk?.drift?.lastCheckAt" class="text-[10px] text-muted mt-auto">
                  {{ ago(risk.drift.lastCheckAt) }}
                </p>
              </NuxtLink>
            </div>

            <!-- Regime + movers -->
            <div v-if="intel" class="grid grid-cols-2 gap-2.5">
              <NuxtLink :to="LINKS.regime" :title="t('operationsCenter.links.regime')"
                class="group block p-2.5 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary">
                <p class="text-xs text-muted mb-0.5">{{ t('operationsCenter.market.regime') }}</p>
                <p class="font-mono text-xs font-semibold">{{ intel.regime?.season ?? '—' }}</p>
                <p class="text-[11px] text-muted mt-1">
                  ASI90: {{ intel.regime?.asi?.d90 ?? '—' }} · FNG: {{ intel.regime?.fng?.value ?? '—' }}
                </p>
              </NuxtLink>
              <NuxtLink :to="LINKS.movers" :title="t('operationsCenter.links.movers')"
                class="group block p-2.5 rounded-lg bg-elevated/50 border border-transparent transition hover:border-primary/60 hover:bg-elevated/80 focus-visible:outline-2 outline-primary">
                <p class="text-xs text-muted mb-0.5">{{ t('operationsCenter.market.movers') }}</p>
                <p class="font-mono text-xs font-semibold">
                  {{ intel.movers?.length ?? 0 }} {{ t('operationsCenter.market.symbols') }}
                </p>
                <p v-if="intel.movers?.[0]" class="text-[11px] text-muted mt-1 font-mono truncate">
                  {{ intel.movers[0].symbol }} {{ intel.movers[0].pct24h?.toFixed(1) }}%
                </p>
              </NuxtLink>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Confirm Modal -->
    <LazyBaseConfirmModal v-model:open="confirmState.open" :title="confirmState.title"
      :description="confirmState.description" :color="'error'" :confirm-label="t('common.confirm')"
      :cancel-label="t('common.cancel')" @confirm="() => { confirmState.open = false; confirmState.onConfirm() }"
      @cancel="confirmState.open = false" />
    <!-- AI AGENT DETAIL & ACTIONS MODAL -->
    <LazyBaseResponsiveModal v-model="showAgentModal"
      :title="selectedAgentRow?.name || t('operationsCenter.agentModal.title')" class="sm:max-w-3xl">
      <div v-if="agentDetailLoading" class="p-8 flex items-center justify-center gap-3 text-muted">
        <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-primary" />
        <span>{{ t('common.loading') }}</span>
      </div>
      <div v-else-if="selectedAgentRow" class="space-y-4">
        <!-- Header Badges & Quick Stats -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-elevated/60 border border-default">
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge :color="autonomyColor(selectedAgentRow.autonomy)" variant="subtle" size="md">
              {{ selectedAgentRow.autonomy }} · {{ t('aiAgents.level') }}
            </UBadge>
            <UBadge :color="botStateColor(selectedAgentRow.state)" variant="subtle" size="md">
              {{ t(`aiAgents.stateLabels.${selectedAgentRow.state}`) }}
            </UBadge>
            <UBadge color="neutral" variant="outline" size="md" class="font-mono">
              <UIcon name="i-lucide-wallet" class="w-3.5 h-3.5 mr-1 text-primary" />
              {{ selectedAgentRow.accountId }}
            </UBadge>
            <UBadge color="info" variant="soft" size="md">
              <UIcon name="i-lucide-cpu" class="w-3.5 h-3.5 mr-1" />
              {{ selectedAgentRow.model }}
            </UBadge>
          </div>

          <!-- Quick Lifecycle Action Buttons -->
          <div class="flex items-center gap-1.5">
            <UButton v-if="selectedAgentRow.state === 'draft' || selectedAgentRow.state === 'validated'" color="primary"
              variant="soft" size="xs" icon="i-lucide-play" @click="handleAgentMove('start')">
              {{ t('aiAgents.start') }}
            </UButton>
            <UButton v-if="selectedAgentRow.state === 'active'" color="warning" variant="soft" size="xs"
              icon="i-lucide-pause" @click="handleAgentMove('pause')">
              {{ t('aiAgents.pause') }}
            </UButton>
            <UButton v-if="selectedAgentRow.state === 'paused'" color="primary" variant="soft" size="xs"
              icon="i-lucide-play" @click="handleAgentMove('resume')">
              {{ t('aiAgents.resume') }}
            </UButton>
          </div>
        </div>

        <!-- Modal Sub-Tabs -->
        <div class="flex items-center border-b border-default gap-2">
          <UButton :color="agentModalTab === 'overview' ? 'primary' : 'neutral'"
            :variant="agentModalTab === 'overview' ? 'soft' : 'ghost'" size="sm" class="rounded-b-none"
            @click="agentModalTab = 'overview'">
            <UIcon name="i-lucide-sliders" class="w-4 h-4 mr-1.5" />
            {{ t('operationsCenter.agentModal.overviewTab') }}
          </UButton>
          <UButton :color="agentModalTab === 'actions' ? 'primary' : 'neutral'"
            :variant="agentModalTab === 'actions' ? 'soft' : 'ghost'" size="sm" class="rounded-b-none"
            @click="agentModalTab = 'actions'">
            <UIcon name="i-lucide-history" class="w-4 h-4 mr-1.5" />
            {{ t('operationsCenter.agentModal.actionsTab', { count: agentActivities.length }) }}
          </UButton>
        </div>

        <!-- OVERVIEW TAB -->
        <div v-if="agentModalTab === 'overview'" class="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          <!-- Notice: Strategy capital isolation vs demo trading account -->
          <div class="p-2.5 rounded-lg bg-info/10 border border-info/30 text-[11px] text-info flex items-center gap-2">
            <UIcon name="i-lucide-shield-check" class="w-4 h-4 shrink-0" />
            <span>{{ t('operationsCenter.botModal.independentCapitalDesc') }} {{
              t('operationsCenter.botModal.demoAccountNotice') }}</span>
          </div>

          <!-- Account Switcher Box -->
          <div
            class="p-3.5 rounded-xl bg-elevated/40 border border-default/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1">
              <span class="text-xs font-semibold text-highlighted flex items-center gap-1.5">
                <UIcon name="i-lucide-wallet" class="w-4 h-4 text-primary" />
                {{ t('operationsCenter.agentModal.linkedAccount') }}
              </span>
              <p class="text-[11px] text-muted">
                {{ t('operationsCenter.filterAccount') }}: bot sẽ thực thi hoặc đọc dữ liệu từ tài khoản này.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <select v-model="editAgentAccountId"
                class="px-2.5 py-1.5 text-xs rounded-lg border border-default bg-elevated text-highlighted font-mono">
                <option v-for="accId in agentAccounts" :key="accId" :value="accId">{{ accId }}</option>
              </select>
              <UButton color="primary" variant="soft" size="xs" :loading="savingAgentAccount"
                :disabled="editAgentAccountId === selectedAgentRow.accountId" @click="saveAgentAccount">
                {{ t('operationsCenter.agentModal.saveAccount') }}
              </UButton>
            </div>
          </div>

          <!-- Financial Performance Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.agentModal.equity') }}</span>
              <span class="text-sm font-semibold font-mono text-highlighted">{{ selectedAgentRow.equityFormatted
                }}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.agentModal.realizedPnl') }}</span>
              <span class="text-sm font-semibold font-mono"
                :class="selectedAgentRow.pnl >= 0 ? 'text-success' : 'text-error'">
                {{ selectedAgentRow.pnlFormatted }}
              </span>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.agentModal.actionsAllowed') }}</span>
              <span class="text-sm font-semibold font-mono text-success">{{ selectedAgentRow.allowed }}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.agentModal.actionsBlocked') }}</span>
              <span class="text-sm font-semibold font-mono"
                :class="selectedAgentRow.blocked > 0 ? 'text-error' : 'text-muted'">
                {{ selectedAgentRow.blocked }}
              </span>
            </div>
          </div>

          <!-- Description & Details -->
          <div class="p-3.5 rounded-xl bg-elevated/30 border border-default space-y-2.5">
            <span class="text-xs font-semibold text-highlighted block">{{ t('common.description') }}</span>
            <p class="text-xs text-muted leading-relaxed">
              {{ selectedAgentRow.description || selectedAgentRow.name }}
            </p>
            <div class="pt-2 flex flex-wrap items-center gap-2 text-xs">
              <span class="text-muted">{{ t('operationsCenter.agentModal.instruments') }}:</span>
              <template v-if="selectedAgentRow.instruments.length">
                <UBadge v-for="inst in selectedAgentRow.instruments" :key="inst" color="neutral" variant="subtle"
                  size="xs" class="font-mono">
                  {{ inst }}
                </UBadge>
              </template>
              <span v-else class="text-dimmed text-[11px]">{{ t('operationsCenter.agentModal.noInstruments') }}</span>
            </div>
          </div>

          <!-- System Prompt / Directive Viewer -->
          <div class="p-3.5 rounded-xl bg-elevated/30 border border-default space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-highlighted flex items-center gap-1.5">
                <UIcon name="i-lucide-file-code" class="w-4 h-4 text-info" />
                {{ t('operationsCenter.agentModal.systemPrompt') }}
              </span>
              <span class="text-[10px] font-mono text-muted">
                {{ agentDetail?.activeVersion?.versionId ? `Version ${agentDetail.activeVersion.version}` : 'v1' }}
              </span>
            </div>
            <div
              class="max-h-40 overflow-y-auto p-2.5 rounded-lg bg-surface/80 border border-default/60 font-mono text-[11px] text-muted leading-relaxed whitespace-pre-wrap">
              {{ agentDetail?.activeVersion?.prompts?.system || selectedAgentRow.description ||
                t('operationsCenter.agentModal.noSystemPrompt') }}
            </div>
          </div>
        </div>

        <!-- ACTIONS LEDGER TAB -->
        <div v-else-if="agentModalTab === 'actions'" class="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
          <div v-if="!agentActivities.length" class="p-8 text-center text-xs text-muted">
            <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 text-muted/60" />
            <p>{{ t('operationsCenter.agentModal.emptyActions') }}</p>
          </div>
          <div v-else class="space-y-2">
            <div v-for="act in agentActivities" :key="act.actionId"
              class="p-3 rounded-xl bg-elevated/40 border border-default hover:border-primary/40 transition-colors space-y-2">
              <div class="flex items-center justify-between gap-2 flex-wrap text-xs">
                <div class="flex items-center gap-2">
                  <UBadge :color="act.status === 'allowed' ? 'success' : 'error'" variant="subtle" size="xs">
                    {{ act.status === 'allowed' ? t('operationsCenter.agentModal.statusAllowed') :
                      t('operationsCenter.agentModal.statusBlocked') }}
                  </UBadge>
                  <span class="font-mono font-semibold uppercase text-highlighted">{{ act.type }}</span>
                  <span class="text-[11px] text-muted font-mono">({{ act.code }})</span>
                </div>
                <span class="text-[11px] text-muted font-mono">{{ ago(act.at) }}</span>
              </div>

              <!-- Message / Rationale -->
              <p class="text-xs text-highlighted font-medium">
                {{ act.message }}
              </p>

              <!-- Proposal Details if available -->
              <div v-if="act.payload"
                class="p-2 rounded-lg bg-surface/70 border border-default/50 text-[11px] font-mono grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div v-if="act.payload.symbol">
                  <span class="text-muted block text-[10px]">{{ t('operationsCenter.agentModal.symbol') }}:</span>
                  <span class="font-semibold text-highlighted">{{ act.payload.symbol }}</span>
                </div>
                <div v-if="act.payload.side">
                  <span class="text-muted block text-[10px]">{{ t('operationsCenter.agentModal.side') }}:</span>
                  <span class="font-semibold"
                    :class="act.payload.side === 'BUY' ? 'text-success' : act.payload.side === 'SELL' ? 'text-error' : 'text-neutral'">
                    {{ act.payload.side }}
                  </span>
                </div>
                <div v-if="act.payload.entry">
                  <span class="text-muted block text-[10px]">{{ t('operationsCenter.agentModal.entry') }}:</span>
                  <span class="font-semibold text-highlighted">{{ fmtPrice(act.payload.entry) }}</span>
                </div>
                <div v-if="act.payload.sl || act.payload.tp">
                  <span class="text-muted block text-[10px]">SL / TP:</span>
                  <span class="font-semibold text-muted">{{ act.payload.sl || '—' }} / {{ act.payload.tp || '—'
                    }}</span>
                </div>
              </div>

              <!-- Reason quote if different from message -->
              <div v-if="act.reason && act.reason !== act.message" class="text-[11px] text-muted italic line-clamp-2">
                "{{ act.reason }}"
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between pt-3 border-t border-default text-xs">
          <NuxtLink :to="LINKS.agents" class="text-primary hover:underline inline-flex items-center gap-1">
            {{ t('operationsCenter.viewAll') }} {{ t('operationsCenter.links.agents') }}
            <UIcon name="i-lucide-arrow-up-right" class="w-3.5 h-3.5" />
          </NuxtLink>
          <UButton variant="ghost" color="neutral" size="sm" @click="showAgentModal = false">
            {{ t('common.close') }}
          </UButton>
        </div>
      </div>
    </LazyBaseResponsiveModal>

    <!-- BOT DETAIL MODAL -->
    <LazyBaseResponsiveModal v-model:open="showBotModal"
      :title="selectedBotRow ? selectedBotRow.bot : t('operationsCenter.botModal.title')"
      :description="selectedBotRow?.instanceId || ''">
      <div v-if="selectedBotRow" class="space-y-4">
        <!-- Header summary & quick actions -->
        <div
          class="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-elevated/50 border border-default flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge :color="botStateColor(selectedBotRow.state)" variant="subtle" size="sm" class="capitalize">
              {{ selectedBotRow.state }}
            </UBadge>
            <UBadge :color="healthColor(selectedBotRow.health)" variant="subtle" size="sm">
              {{ selectedBotRow.health }}
            </UBadge>
            <UBadge color="neutral" variant="outline" size="sm" class="font-mono">
              <UIcon name="i-lucide-wallet" class="w-3.5 h-3.5 mr-1" />
              {{ selectedBotRow.accountId }}
            </UBadge>
            <UBadge color="info" variant="subtle" size="sm">
              {{ selectedBotRow.method }}
            </UBadge>
          </div>

          <!-- Quick Lifecycle Actions -->
          <div class="flex items-center gap-1.5">
            <template v-if="selectedBotRow.state === 'running'">
              <UButton color="warning" variant="soft" size="xs" icon="i-lucide-pause"
                :label="t('operationsCenter.actions.pause')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'pause')" />
              <UButton color="error" variant="soft" size="xs" icon="i-lucide-stop-circle"
                :label="t('operationsCenter.actions.stop')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'stop')" />
            </template>
            <template v-else-if="selectedBotRow.state === 'paused'">
              <UButton color="success" variant="soft" size="xs" icon="i-lucide-play"
                :label="t('operationsCenter.actions.resume')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'resume')" />
              <UButton color="error" variant="soft" size="xs" icon="i-lucide-stop-circle"
                :label="t('operationsCenter.actions.stop')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'stop')" />
            </template>
            <template v-else-if="selectedBotRow.state === 'queued'">
              <UButton color="success" variant="soft" size="xs" icon="i-lucide-play"
                :label="t('operationsCenter.actions.start')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'start')" />
            </template>
            <template v-else>
              <UButton color="primary" variant="soft" size="xs" icon="i-lucide-rotate-ccw"
                :label="t('operationsCenter.actions.rerunReset')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'rerun')" />
              <UButton color="success" variant="soft" size="xs" icon="i-lucide-play-circle"
                :label="t('operationsCenter.actions.rerunContinue')" :disabled="pendingCmd[selectedBotRow.instanceId]"
                @click="showConfirm(selectedBotRow.instanceId, 'continue')" />
            </template>
          </div>
        </div>

        <!-- Tabs inside modal -->
        <UTabs v-model="botModalTab" :items="botModalTabs" :content="false" size="sm" class="w-full" />

        <!-- OVERVIEW & PERFORMANCE TAB -->
        <div v-if="botModalTab === 'overview'" class="space-y-3.5">
          <!-- Notice: Strategy capital isolation vs demo trading account -->
          <div class="p-2.5 rounded-lg bg-info/10 border border-info/30 text-[11px] text-info flex items-center gap-2">
            <UIcon name="i-lucide-shield-check" class="w-4 h-4 shrink-0" />
            <span>{{ t('operationsCenter.botModal.independentCapitalDesc') }}</span>
          </div>

          <!-- 4-card metric grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.botModal.allocatedCapital') }}</span>
              <span class="text-sm sm:text-base font-bold font-mono text-highlighted">{{ selectedBotRow.equityFormatted
                }}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.botModal.netPnl') }}</span>
              <div class="flex items-baseline gap-1">
                <span class="text-sm sm:text-base font-bold font-mono"
                  :class="selectedBotRow.pnl >= 0 ? 'text-success' : 'text-error'">
                  {{ selectedBotRow.pnlFormatted }}
                </span>
                <span class="text-[10px] font-mono" :class="selectedBotRow.pnlPct >= 0 ? 'text-success' : 'text-error'">
                  {{ fmtPct(selectedBotRow.pnlPct) }}
                </span>
              </div>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.botModal.tradedVolume') }}</span>
              <span class="text-sm sm:text-base font-bold font-mono text-primary">{{
                selectedBotRow.tradedVolumeFormatted
                }}</span>
            </div>
            <div class="p-2.5 rounded-lg bg-elevated/40 border border-default">
              <span class="text-[10px] text-muted block">{{ t('operationsCenter.botModal.totalTrades') }}</span>
              <span class="text-sm sm:text-base font-bold font-mono">{{ selectedBotRow.counts }}</span>
            </div>
          </div>

          <!-- Strategy Profile & Config -->
          <div class="p-3.5 rounded-xl bg-elevated/30 border border-default space-y-2">
            <span class="text-xs font-semibold text-highlighted flex items-center gap-1.5">
              <UIcon name="i-lucide-sliders" class="w-4 h-4 text-primary" />
              {{ t('operationsCenter.botModal.strategyProfile') }}
            </span>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.symbol') }}</span>
                <span class="font-mono font-semibold text-highlighted">{{ selectedBotRow.symbol }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.timeframe') }}</span>
                <span class="font-mono font-semibold text-highlighted">{{ selectedBotRow.timeframe !== '—' ? selectedBotRow.timeframe : (selectedBotDetail ? timeframeOf(selectedBotDetail) : '—') }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.method') }}</span>
                <span class="font-semibold text-highlighted capitalize">{{ selectedBotRow.method }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.independentCapital')
                  }}</span>
                <span class="font-mono text-highlighted font-semibold">{{ selectedBotRow.equityFormatted }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.mode') }}</span>
                <span class="font-mono text-highlighted">{{ selectedBotDetail?.mode || 'LIVE_PAPER' }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.engineVersion') }}</span>
                <span class="font-mono text-muted">{{ selectedBotDetail?.schemaVersion || 'v3.6' }}</span>
              </div>
            </div>
          </div>

          <!-- Risk & Execution Rules -->
          <div class="p-3.5 rounded-xl bg-elevated/30 border border-default space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-highlighted flex items-center gap-1.5">
                <UIcon name="i-lucide-calculator" class="w-4 h-4 text-primary" />
                {{ t('operationsCenter.botModal.orderSizing') }}
              </span>
              <UButton
                size="xs"
                variant="soft"
                color="primary"
                icon="i-lucide-save"
                :loading="savingBotConfig"
                :label="t('operationsCenter.botModal.saveConfig')"
                @click="saveBotConfig"
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label class="text-muted text-[10px] block mb-1 font-medium">{{ t('operationsCenter.botModal.sizingType') }}</label>
                <USelect
                  v-model="editBotSizingType"
                  class="w-full"
                  size="sm"
                  :items="[
                    { label: t('operationsCenter.botModal.sizingPercentage'), value: 'percentage' },
                    { label: t('operationsCenter.botModal.sizingFixedValue'), value: 'fixed_value' }
                  ]"
                />
              </div>
              <div>
                <label class="text-muted text-[10px] block mb-1 font-medium">{{ t('operationsCenter.botModal.sizingValue') }}</label>
                <UInputNumber
                  v-model="editBotSizingValue"
                  class="w-full"
                  size="sm"
                  :step="editBotSizingType === 'percentage' ? 0.5 : 50"
                  :min="editBotSizingType === 'percentage' ? 0.1 : 1"
                  :max="editBotSizingType === 'percentage' ? 100 : 1000000"
                />
              </div>
            </div>

            <div v-if="selectedBotDetail?.execution" class="pt-2 border-t border-default/50">
              <span class="text-[10px] text-muted block mb-1 font-medium">{{ t('operationsCenter.botModal.riskManagement') }}</span>
              <div class="p-2 rounded bg-surface/60 border border-default/40 font-mono text-[10px] text-muted whitespace-pre-wrap">
                {{ JSON.stringify(selectedBotDetail.execution, null, 2) }}
              </div>
            </div>
          </div>

          <!-- Runtime & Diagnostics -->
          <div class="p-3.5 rounded-xl bg-elevated/30 border border-default space-y-2">
            <span class="text-xs font-semibold text-highlighted flex items-center gap-1.5">
              <UIcon name="i-lucide-cpu" class="w-4 h-4 text-info" />
              {{ t('operationsCenter.botModal.runtimeInfo') }}
            </span>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.startedAt') }}</span>
                <span>{{ selectedBotRow.startedAt }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.lastEventAt') }}</span>
                <span>{{ ago(selectedBotDetail?.lastEventAt) }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.eventLag') }}</span>
                <span>{{ selectedBotDetail?.eventLagMs ? `${selectedBotDetail.eventLagMs}ms` : '—' }}</span>
              </div>
              <div>
                <span class="text-muted text-[10px] block">{{ t('operationsCenter.botModal.healthReason') }}</span>
                <span>{{ selectedBotDetail?.healthReason || 'OK' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ORDERS & POSITIONS TAB -->
        <div v-else-if="botModalTab === 'positions'" class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
          <div v-if="!selectedBotPositions.length" class="p-8 text-center text-xs text-muted">
            <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 text-muted/60" />
            <p>{{ t('operationsCenter.botModal.noPositionsOrOrders') }}</p>
          </div>
          <div v-else class="space-y-2">
            <div v-for="pos in selectedBotPositions" :key="pos.id"
              class="p-3 rounded-xl bg-elevated/40 border border-default hover:border-primary/40 transition-colors flex items-center justify-between gap-3 text-xs flex-wrap">
              <div class="flex items-center gap-2">
                <UBadge :color="pos.dir === 1 ? 'success' : 'error'" variant="subtle" size="xs">
                  {{ pos.dir === 1 ? 'LONG' : 'SHORT' }}
                </UBadge>
                <span class="font-mono font-semibold text-highlighted">{{ pos.symbol }}</span>
                <span class="text-[11px] text-muted font-mono">Qty: {{ pos.qty }}</span>
              </div>
              <div class="flex items-center gap-3 font-mono text-xs">
                <div>
                  <span class="text-muted text-[10px] block">{{ t('operationsCenter.cols.entryPrice') }}</span>
                  <span>{{ fmtPrice(pos.entryPrice) }}</span>
                </div>
                <div>
                  <span class="text-muted text-[10px] block">{{ t('operationsCenter.cols.pnl') }}</span>
                  <span :class="(pos.pnlAbs || 0) >= 0 ? 'text-success' : 'text-error'" class="font-semibold">
                    {{ fmtSignedMoney(pos.pnlAbs) }}
                  </span>
                </div>
                <UBadge :color="pos.status === 'open' ? 'success' : 'neutral'" variant="subtle" size="xs">
                  {{ pos.status }}
                </UBadge>
              </div>
            </div>
          </div>
        </div>

        <!-- EVENT LOGS & HEALTH TAB -->
        <div v-else-if="botModalTab === 'events'" class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
          <div class="p-3.5 rounded-xl bg-elevated/40 border border-default space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-highlighted">{{ t('operationsCenter.botModal.supervisor') }}</span>
              <span class="font-mono text-muted text-[11px]">{{ (selectedBotDetail?.lease as any)?.supervisorId ||
                'None'
                }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-highlighted">{{ t('operationsCenter.botModal.healthReason') }}</span>
              <span class="font-mono text-muted text-[11px]">{{ selectedBotDetail?.healthReason || 'None' }}</span>
            </div>
            <div v-if="selectedBotDetail?.lastError"
              class="p-2.5 rounded-lg bg-error/10 border border-error/30 text-error font-mono text-[11px]">
              {{ selectedBotDetail.lastError }}
            </div>
            <div class="flex items-center justify-between text-muted text-[11px] pt-2 border-t border-default/50">
              <span>Instance ID:</span>
              <span class="font-mono">{{ selectedBotRow.instanceId }}</span>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex items-center justify-between pt-3 border-t border-default text-xs">
          <NuxtLink :to="botHref(selectedBotRow.instanceId)"
            class="text-primary hover:underline inline-flex items-center gap-1">
            {{ t('operationsCenter.viewAll') }} {{ t('operationsCenter.links.bots') }}
            <UIcon name="i-lucide-arrow-up-right" class="w-3.5 h-3.5" />
          </NuxtLink>
          <UButton variant="ghost" color="neutral" size="sm" @click="showBotModal = false">
            {{ t('common.close') }}
          </UButton>
        </div>
      </div>
    </LazyBaseResponsiveModal>
  </BasePage>
</template>