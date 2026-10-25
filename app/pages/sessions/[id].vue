<script setup lang="ts">
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { TradingSession, SessionTimelineEvent } from '~/composables/useSessions'
import type { PaperOrderItem } from '#shared/types/orders'
import type { PaperFillItem } from '#shared/types/fills'
import type { PositionItem } from '#shared/types/positions'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Session Detail (V3.4 Slice C4 / §59.15): Server-authoritative runtime state,
//  real-time event timeline, state transitions with confirmation guards, and
//  traceable linkage to orders, fills, and positions.
// =============================================================================

const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const sessionsApi = useSessions()
const researchApi = useResearch()

const sessionId = computed(() => String(route.params.id ?? ''))
const session = ref<TradingSession | null>(null)
const orders = ref<PaperOrderItem[]>([])
const fills = ref<PaperFillItem[]>([])
const positions = ref<PositionItem[]>([])

const isLoading = ref(true)
const isRefreshing = ref(false)
const acting = ref(false)

// Phase H (§61.12) — read-only contextual assistant over this session.
const assistantOpen = ref(false)

// Active tab
const activeTab = ref<'timeline' | 'orders' | 'fills' | 'positions' | 'manifest'>('timeline')

// Timeline filter & search
const timelineSearch = ref('')
const selectedKind = ref<string>('all')

// Confirmation modal state
const confirmModalOpen = ref(false)
const pendingTargetState = ref<string | null>(null)

// Legal next transitions table (mirrors server rules in engine/session.mjs)
const NEXT: Record<string, string[]> = {
  queued: ['starting', 'failed'],
  starting: ['running', 'failed'],
  running: ['paused', 'stopping', 'failed', 'halted'],
  paused: ['running', 'stopping', 'failed', 'halted'],
  stopping: ['completed', 'failed'],
  completed: [],
  failed: [],
  halted: []
}

async function loadData() {
  if (!sessionId.value) return
  try {
    const s = await sessionsApi.detail(sessionId.value)
    if (!s) {
      session.value = null
      return
    }
    session.value = s

    // Fetch linked orders, fills, positions concurrently
    const [ordList, fillList, posList] = await Promise.all([
      sessionsApi.orders(s.sessionId, 100),
      sessionsApi.fills(s.sessionId, 100),
      sessionsApi.positions(s.sessionId, 100)
    ])
    orders.value = ordList
    fills.value = fillList
    positions.value = posList

    // A sealed session has a frozen evidence set (auto-frozen when it reached a
    // terminal state, §59.15). Show its link without requiring a manual freeze.
    if (['completed', 'failed', 'halted'].includes(s.state) && !frozenSetId.value) {
      const sets = await researchApi.evidenceSets({ sessionId: s.sessionId, limit: 1 })
      const first = sets[0]
      if (first) frozenSetId.value = first.setId || first._id
    }
  } catch (err) {
    notify.error(t('sessions.sessionDetail'), getErrorMessage(err, (key) => t(key)))
  }
}

async function initialLoad() {
  isLoading.value = true
  await loadData()
  isLoading.value = false
}

async function refresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  await loadData()
  isRefreshing.value = false
}

onMounted(initialLoad)

// Live polling respecting tab visibility (pauses when hidden to save API budget)
useVisibleInterval(() => {
  // Only auto-poll if session is active (not terminal)
  if (session.value && !['completed', 'failed', 'halted'].includes(session.value.state)) {
    loadData()
  }
}, 5000, { immediate: false })

const title = computed(() => session.value?.sessionId || sessionId.value)
const description = computed(() => session.value ? `${t('sessions.kind')}: ${session.value.kind} · ${t('sessions.account')}: ${session.value.accountId}` : t('sessions.sessionDetailDesc'))

const trail = computed(() => [
  { label: t('sessions.title'), to: '/sessions' },
  { label: title.value }
])

const stateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'queued' || s === 'starting' ? 'info'
      : s === 'paused' || s === 'stopping' ? 'warning'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'

const metrics = computed<MetricItem[]>(() => {
  const s = session.value
  if (!s) return []
  return [
    { key: 'state', label: t('sessions.status'), value: s.state, tone: s.state === 'running' ? 'success' : s.state === 'failed' || s.state === 'halted' ? 'error' : 'primary' },
    { key: 'kind', label: t('sessions.kind'), value: s.kind, tone: 'info' },
    { key: 'orders', label: t('sessions.ordersTab'), value: String(orders.value.length || s.counts?.orders || 0) },
    { key: 'fills', label: t('sessions.fillsTab'), value: String(fills.value.length || s.counts?.fills || 0) },
    { key: 'positions', label: t('sessions.positionsTab'), value: String(positions.value.length || s.counts?.positions || 0), tone: positions.value.length > 0 ? 'success' : 'default' }
  ]
})

// Event kinds extracted from current timeline
const availableKinds = computed(() => {
  if (!session.value?.timeline) return []
  const set = new Set(session.value.timeline.map((e) => e.kind))
  return Array.from(set)
})

// Filtered timeline
const filteredTimeline = computed(() => {
  if (!session.value?.timeline) return []
  let list = [...session.value.timeline].reverse()
  if (selectedKind.value && selectedKind.value !== 'all') {
    list = list.filter((e) => e.kind === selectedKind.value)
  }
  if (timelineSearch.value.trim()) {
    const q = timelineSearch.value.trim().toLowerCase()
    list = list.filter((e) => e.message.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q))
  }
  return list
})

function formatDuration(start: number | null, stop: number | null): string {
  if (!start) return '—'
  const end = stop || Date.now()
  const sec = Math.floor(Math.max(0, end - start) / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const fmtTime = (ms: number | null) =>
  typeof ms !== 'number' || !Number.isFinite(ms) ? '—' : new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'

function promptMove(to: string) {
  // Destructive transitions require confirmation
  if (['failed', 'halted', 'stopping'].includes(to)) {
    pendingTargetState.value = to
    confirmModalOpen.value = true
  } else {
    executeMove(to)
  }
}

async function confirmMove() {
  if (!pendingTargetState.value) return
  const to = pendingTargetState.value
  confirmModalOpen.value = false
  pendingTargetState.value = null
  await executeMove(to)
}

async function executeMove(to: string) {
  if (!session.value || acting.value) return
  acting.value = true
  try {
    const result = await sessionsApi.move(session.value.sessionId, to)
    session.value = result.session
    notify.success(t('sessions.title'), t('sessions.moved'))
    // Auto-freeze ran server-side the moment the session was sealed (§59.15):
    // surface the citable set. Fail-soft — a missed freeze falls back to the
    // manual Freeze button, so it is reported as a warning, not an error.
    const auto = result.autoFreeze
    if (auto?.setId) {
      frozenSetId.value = auto.setId
      notify.success(t('sessions.autoFreezeTitle'), auto.created ? t('sessions.autoFreezeCreated') : t('sessions.autoFreezeExists'))
    } else if (auto) {
      notify.warning(t('sessions.autoFreezeTitle'), t('sessions.autoFreezeFailed'))
    }
    await loadData()
  } catch (err) {
    notify.error(t('sessions.moveFailed'), getErrorMessage(err, (key) => t(key)))
  } finally {
    acting.value = false
  }
}

// -------- freeze this session's evidence (§59.15 Slice E) --------
// A frozen session becomes a re-openable evidence set: the trades, manifest and
// limitations at this instant, hashed. Freezing twice returns the same set, so
// this button is safe to press — it never forks a second version of the run.
const freezing = ref(false)
const frozenSetId = ref<string | null>(null)

const canFreeze = computed(() => !!session.value && ['completed', 'failed', 'halted'].includes(session.value.state))

async function freezeEvidence() {
  if (!session.value) return
  freezing.value = true
  try {
    const doc = await researchApi.freezeEvidence({ kind: 'paper-session', sourceId: session.value.sessionId })
    frozenSetId.value = doc.setId || doc._id
    notify.success(
      doc.alreadyFrozen ? t('sessions.freezeEvidenceExists') : t('sessions.freezeEvidence'),
      doc.sourceChanged ? t('sessions.freezeEvidenceChanged') : frozenSetId.value || undefined
    )
  } catch (err) {
    notify.error(t('sessions.freezeEvidence'), getErrorMessage(err, (key) => t(key)))
  } finally {
    freezing.value = false
  }
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-lock', label: t('sessions.freezeEvidence'), onSelect: freezeEvidence },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="session-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('sessions.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          icon="i-lucide-arrow-left"
          :label="t('sessions.title')"
          variant="ghost"
          color="neutral"
          size="sm"
          to="/sessions"
        />

        <!-- Action state transition buttons -->
        <template v-if="session">
          <UButton
            v-for="to in (NEXT[session.state] ?? [])"
            :key="to"
            size="sm"
            :color="to === 'halted' || to === 'failed' ? 'error' : 'primary'"
            variant="soft"
            :loading="acting"
            @click="promptMove(to)"
          >
            <UIcon
              :name="to === 'running' ? 'i-lucide-play' : to === 'paused' ? 'i-lucide-pause' : to === 'stopping' ? 'i-lucide-square' : to === 'halted' ? 'i-lucide-octagon-alert' : 'i-lucide-arrow-right'"
              class="w-3.5 h-3.5"
            />
            {{ to }}
          </UButton>
        </template>        <UButton
          v-if="canFreeze"
          icon="i-lucide-lock"
          :label="t('sessions.freezeEvidence')"
          variant="soft"
          color="primary"
          size="sm"
          :loading="freezing"
          :title="t('sessions.freezeEvidenceHint')"
          @click="freezeEvidence"
        />
        <UButton
          v-if="frozenSetId"
          icon="i-lucide-fingerprint"
          :label="t('sessions.viewEvidenceSet')"
          variant="soft"
          color="neutral"
          size="sm"
          :to="`/data-research/research/evidence/${encodeURIComponent(frozenSetId)}`"
          :ui="{ label: 'hidden md:block' }"
        />

        <UButton
          v-if="session"
          icon="i-lucide-sparkles"
          :label="t('assistant.title')"
          variant="soft"
          color="primary"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="assistantOpen = true"
        />

        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isRefreshing" @click="refresh" />
      </div>
    </template>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
    </div>

    <div v-else-if="!session" class="flex flex-col items-center justify-center py-20">
      <AdminEmptyState
        :title="t('sessions.notFound')"
        :description="t('sessions.notFoundHint')"
        icon="i-lucide-search-x"
      />
      <UButton
        to="/sessions"
        icon="i-lucide-arrow-left"
        :label="t('sessions.title')"
        color="primary"
        variant="soft"
        class="mt-4"
      />
    </div>

    <div v-else class="flex flex-col w-full h-full min-h-0 gap-4 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="metrics" />

      <!-- Top Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div class="text-[10px] text-muted uppercase tracking-wider">{{ t('sessions.strategyVersion') }}</div>
          <div class="text-xs font-mono text-highlighted font-semibold mt-1 truncate">
            {{ session.strategyVersionId || '—' }}
          </div>
          <div class="text-[11px] text-dimmed mt-0.5">{{ session.botProfileId || 'manual-session' }}</div>
        </UCard>

        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div class="text-[10px] text-muted uppercase tracking-wider">{{ t('sessions.duration') }}</div>
          <div class="text-xs font-mono text-highlighted font-semibold mt-1">
            {{ formatDuration(session.startedAt, session.stoppedAt) }}
          </div>
          <div class="text-[11px] text-dimmed mt-0.5">
            {{ session.startedAt ? formatTimeAgo(new Date(session.startedAt)) : '—' }}
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div class="text-[10px] text-muted uppercase tracking-wider">{{ t('sessions.created') }}</div>
          <div class="text-xs font-mono text-highlighted font-semibold mt-1">
            {{ fmtTime(session.startedAt || session.lastEventAt) }}
          </div>
          <div class="text-[11px] text-dimmed mt-0.5">{{ session.createdBy || 'dashboard' }}</div>
        </UCard>

        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div class="text-[10px] text-muted uppercase tracking-wider">{{ t('sessions.lastEvent') }}</div>
          <div class="text-xs font-mono text-highlighted font-semibold mt-1">
            {{ fmtTime(session.lastEventAt) }}
          </div>
          <div class="text-[11px] text-dimmed mt-0.5">
            {{ session.timelineDropped > 0 ? t('sessions.dropped', { n: session.timelineDropped }) : `${session.timeline.length} events` }}
          </div>
        </UCard>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex items-center gap-2 border-b border-default pb-2 overflow-x-auto">
        <UButton
          size="sm"
          :color="activeTab === 'timeline' ? 'primary' : 'neutral'"
          :variant="activeTab === 'timeline' ? 'soft' : 'ghost'"
          icon="i-lucide-activity"
          @click="activeTab = 'timeline'"
        >
          {{ t('sessions.timelineTab') }} ({{ session.timeline.length }})
        </UButton>
        <UButton
          size="sm"
          :color="activeTab === 'orders' ? 'primary' : 'neutral'"
          :variant="activeTab === 'orders' ? 'soft' : 'ghost'"
          icon="i-lucide-list-ordered"
          @click="activeTab = 'orders'"
        >
          {{ t('sessions.ordersTab') }} ({{ orders.length }})
        </UButton>
        <UButton
          size="sm"
          :color="activeTab === 'fills' ? 'primary' : 'neutral'"
          :variant="activeTab === 'fills' ? 'soft' : 'ghost'"
          icon="i-lucide-check-check"
          @click="activeTab = 'fills'"
        >
          {{ t('sessions.fillsTab') }} ({{ fills.length }})
        </UButton>
        <UButton
          size="sm"
          :color="activeTab === 'positions' ? 'primary' : 'neutral'"
          :variant="activeTab === 'positions' ? 'soft' : 'ghost'"
          icon="i-lucide-briefcase"
          @click="activeTab = 'positions'"
        >
          {{ t('sessions.positionsTab') }} ({{ positions.length }})
        </UButton>
        <UButton
          size="sm"
          :color="activeTab === 'manifest' ? 'primary' : 'neutral'"
          :variant="activeTab === 'manifest' ? 'soft' : 'ghost'"
          icon="i-lucide-file-code"
          @click="activeTab = 'manifest'"
        >
          {{ t('sessions.manifestTab') }}
        </UButton>
      </div>

      <!-- Tab Content: Timeline -->
      <div v-if="activeTab === 'timeline'" class="flex flex-col gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-2 mb-3">
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <UInput
                v-model="timelineSearch"
                icon="i-lucide-search"
                size="xs"
                :placeholder="t('sessions.eventSearchPlaceholder')"
                class="w-full sm:w-64 font-mono text-xs"
              />
              <select
                v-model="selectedKind"
                class="text-xs bg-default border border-default rounded px-2 py-1 text-highlighted"
              >
                <option value="all">{{ t('sessions.allKinds') }}</option>
                <option v-for="k in availableKinds" :key="k" :value="k">{{ k }}</option>
              </select>
            </div>
            <span v-if="session.timelineDropped > 0" class="text-[11px] text-warning font-mono">
              ⚠️ {{ t('sessions.dropped', { n: session.timelineDropped }) }}
            </span>
          </div>

          <div v-if="filteredTimeline.length" class="flex flex-col max-h-[500px] overflow-y-auto divide-y divide-default/40">
            <div
              v-for="(e, i) in filteredTimeline"
              :key="`${e.t}-${i}`"
              class="flex items-baseline gap-3 py-2 px-1 text-xs hover:bg-elevated/40 rounded transition-colors"
            >
              <time class="font-mono text-[11px] text-dimmed shrink-0 w-32">{{ fmtTime(e.t) }}</time>
              <UBadge
                :label="e.kind"
                :color="e.kind === 'created' || e.kind === 'started' ? 'primary' : e.kind === 'cycle' ? 'neutral' : e.kind === 'order' || e.kind === 'fill' ? 'success' : e.kind === 'failed' || e.kind === 'halted' ? 'error' : 'info'"
                variant="subtle"
                size="xs"
                class="shrink-0"
              />
              <span class="text-highlighted font-mono break-all flex-1">{{ e.message }}</span>
            </div>
          </div>
          <AdminEmptyState v-else :title="t('sessions.noEvents')" icon="i-lucide-activity" />
        </UCard>
      </div>

      <!-- Tab Content: Orders -->
      <div v-else-if="activeTab === 'orders'" class="flex flex-col gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div v-if="orders.length" class="flex flex-col divide-y divide-default/40 overflow-x-auto">
            <div class="grid grid-cols-6 gap-2 py-1.5 px-2 text-[10px] text-muted font-mono uppercase font-semibold">
              <span>Client Order ID</span>
              <span>Symbol</span>
              <span>Side / Type</span>
              <span>Qty / Price</span>
              <span>Status</span>
              <span>Time</span>
            </div>
            <div
              v-for="ord in orders"
              :key="ord.id"
              class="grid grid-cols-6 gap-2 py-2 px-2 text-xs font-mono items-center hover:bg-elevated/40 rounded"
            >
              <span class="text-highlighted truncate" :title="ord.clientOrderId">{{ ord.clientOrderId }}</span>
              <span class="font-semibold">{{ ord.symbol }}</span>
              <div class="flex items-center gap-1">
                <UBadge :label="ord.side" :color="ord.side === 'BUY' ? 'success' : 'error'" variant="subtle" size="xs" />
                <span class="text-[11px] text-muted">{{ ord.type }}</span>
              </div>
              <span class="text-dimmed">{{ ord.qty }} @ {{ ord.price || 'MKT' }}</span>
              <div>
                <UBadge :label="ord.status" color="neutral" variant="subtle" size="xs" />
              </div>
              <span class="text-[11px] text-dimmed truncate">{{ ord.submittedAt || ord.createdAt }}</span>
            </div>
          </div>
          <AdminEmptyState v-else :title="t('sessions.noOrders')" icon="i-lucide-list-ordered" />
        </UCard>
      </div>

      <!-- Tab Content: Fills -->
      <div v-else-if="activeTab === 'fills'" class="flex flex-col gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div v-if="fills.length" class="flex flex-col divide-y divide-default/40 overflow-x-auto">
            <div class="grid grid-cols-6 gap-2 py-1.5 px-2 text-[10px] text-muted font-mono uppercase font-semibold">
              <span>Fill ID</span>
              <span>Symbol</span>
              <span>Side / Price</span>
              <span>Qty / Fee</span>
              <span>Slippage / Latency</span>
              <span>Event Time</span>
            </div>
            <div
              v-for="fill in fills"
              :key="fill.id"
              class="grid grid-cols-6 gap-2 py-2 px-2 text-xs font-mono items-center hover:bg-elevated/40 rounded"
            >
              <span class="text-highlighted truncate" :title="fill.fillId">{{ fill.fillId }}</span>
              <span class="font-semibold">{{ fill.symbol }}</span>
              <div class="flex items-center gap-1">
                <UBadge :label="fill.side" :color="fill.side === 'BUY' ? 'success' : 'error'" variant="subtle" size="xs" />
                <span class="text-highlighted">{{ fill.fillPrice }}</span>
              </div>
              <span class="text-dimmed">{{ fill.fillQty }} (fee: {{ fill.feeAmount ?? 0 }})</span>
              <span class="text-dimmed">{{ fill.slippageBps ? `${fill.slippageBps} bps` : '0' }} · {{ fill.latencyMs }}ms</span>
              <span class="text-[11px] text-dimmed truncate">{{ fill.eventTime || fill.createdAt }}</span>
            </div>
          </div>
          <AdminEmptyState v-else :title="t('sessions.noFills')" icon="i-lucide-check-check" />
        </UCard>
      </div>

      <!-- Tab Content: Positions -->
      <div v-else-if="activeTab === 'positions'" class="flex flex-col gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <div v-if="positions.length" class="flex flex-col divide-y divide-default/40 overflow-x-auto">
            <div class="grid grid-cols-6 gap-2 py-1.5 px-2 text-[10px] text-muted font-mono uppercase font-semibold">
              <span>Position ID</span>
              <span>Symbol / Dir</span>
              <span>Qty / Entry</span>
              <span>Exit / Status</span>
              <span>PnL</span>
              <span>Entry Time</span>
            </div>
            <div
              v-for="pos in positions"
              :key="pos.id"
              class="grid grid-cols-6 gap-2 py-2 px-2 text-xs font-mono items-center hover:bg-elevated/40 rounded"
            >
              <span class="text-highlighted truncate" :title="pos.id">{{ pos.id }}</span>
              <div class="flex items-center gap-1.5">
                <span class="font-semibold">{{ pos.symbol }}</span>
                <UBadge :label="pos.dir === 1 ? 'LONG' : 'SHORT'" :color="pos.dir === 1 ? 'success' : 'error'" variant="subtle" size="xs" />
              </div>
              <span class="text-dimmed">{{ pos.qty }} @ {{ pos.entryPrice }}</span>
              <div>
                <UBadge :label="pos.status" :color="pos.status === 'open' ? 'success' : 'neutral'" variant="subtle" size="xs" />
              </div>
              <span
                class="font-semibold"
                :class="pos.pnlAbs === null ? 'text-dimmed' : pos.pnlAbs >= 0 ? 'text-success' : 'text-error'"
              >
                {{ pos.pnlAbs !== null ? `${pos.pnlAbs > 0 ? '+' : ''}${pos.pnlAbs.toFixed(2)}` : '—' }}
              </span>
              <span class="text-[11px] text-dimmed truncate">{{ pos.entryTime }}</span>
            </div>
          </div>
          <AdminEmptyState v-else :title="t('sessions.noPositions')" icon="i-lucide-briefcase" />
        </UCard>
      </div>

      <!-- Tab Content: Manifest & Config -->
      <div v-else-if="activeTab === 'manifest'" class="flex flex-col gap-3">
        <UCard :ui="{ body: 'p-3 sm:p-3' }">
          <template #header>
            <h4 class="font-semibold text-sm">{{ t('sessions.manifestTab') }}</h4>
          </template>
          <div class="flex flex-col gap-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              <div class="p-2.5 rounded bg-elevated/30 border border-default/50">
                <span class="text-[10px] text-muted block mb-1">Schema Version</span>
                <span class="text-highlighted">{{ session.schemaVersion }}</span>
              </div>
              <div class="p-2.5 rounded bg-elevated/30 border border-default/50">
                <span class="text-[10px] text-muted block mb-1">Restarted From</span>
                <span class="text-highlighted">{{ session.restartedFrom || 'none' }}</span>
              </div>
              <div class="p-2.5 rounded bg-elevated/30 border border-default/50">
                <span class="text-[10px] text-muted block mb-1">Instruments</span>
                <span class="text-highlighted">{{ session.instruments?.join(', ') || 'all' }}</span>
              </div>
              <div class="p-2.5 rounded bg-elevated/30 border border-default/50">
                <span class="text-[10px] text-muted block mb-1">Timeframes</span>
                <span class="text-highlighted">{{ session.timeframes?.join(', ') || 'all' }}</span>
              </div>
            </div>

            <div v-if="session.manifest" class="flex flex-col gap-1">
              <span class="text-[10px] text-muted uppercase tracking-wider font-mono">Full Manifest Object</span>
              <pre class="p-3 rounded bg-elevated/40 border border-default text-[11px] font-mono text-highlighted overflow-x-auto max-h-80">{{ JSON.stringify(session.manifest, null, 2) }}</pre>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Confirmation Modal for Destructive Transitions -->
    <LazyBaseConfirmModal
      v-model="confirmModalOpen"
      :title="t('sessions.confirmMoveTitle')"
      :description="t('sessions.confirmMoveDesc', { id: session?.sessionId || '', state: pendingTargetState || '' })"
      :confirm-label="t('sessions.confirmMoveBtn')"
      color="error"
      @confirm="confirmMove"
    />

    <!-- Phase H (§61.12) — read-only contextual assistant over this session -->
    <BaseModuleAssistantPanel v-model:open="assistantOpen" :session-id="session?.sessionId || sessionId" />
  </BasePage>
</template>
