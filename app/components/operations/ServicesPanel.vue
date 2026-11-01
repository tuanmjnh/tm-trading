<script setup lang="ts">
import type { OperationsServiceRow, OperationsView } from '#shared/types/operations'
import { formatTimeAgo } from '@vueuse/core'
import { useStorage } from '@vueuse/core'
import { SERVICE_ACTIONS_UI, isActionDisabled, type ServiceActionColor, type ServiceActionId } from '~/utils/serviceActions'
import { runServiceOperation } from '~/utils/serviceOperation'

// =============================================================================
//  ServicesPanel (V4.2 §17.9) — the service table.
//
//  Reads `GET /api/v1/operations/services` (registry + supervisor snapshot +
//  pending commands) and renders one row per unit of work. The table is a READ
//  model: every control action goes through a menu and enqueues a real operation,
//  so a stray click on a row only opens the detail drawer.
//
//  Presentation follows the repository standard for LazyGridList:
//    - list AND grid view, persisted per user (`useAdminGridView`);
//    - a grouped, coloured context menu (long-press on mobile, ⋯ on desktop);
//    - a dedicated mobile card, plus swipe shortcuts;
//    - drag to reorder, persisted per user, disabled while filtering;
//    - a bounded height with its own scroll area.
// =============================================================================

interface ServiceRow extends OperationsServiceRow {
  name: string
  stateLabel: string
  healthLabel: string
  desiredLabel: string
  categoryLabel: string
  heartbeat: string
  lastSuccess: string
  output: string | number
  interval: string
}

const { t, te } = useI18n()
const notify = useNotify()
const api = useOperations()
const { viewMode } = useAdminGridView('operations-services-view-mode')

/**
 * The registry label is English and canonical (the CLI uses it). The screen
 * translates by service id, and falls back to the registry label only for a
 * record the registry does not know (a tracked process outside the list).
 */
function serviceName(service: OperationsServiceRow): string {
  const key = `operations.services.labels.${service.serviceId}`
  return te(key) ? t(key) : service.label
}

const view = ref<OperationsView | null>(null)
const loading = ref(true)
const failed = ref(false)
const search = ref('')
const stateFilter = ref<string>('all')
const drawerOpen = ref(false)
const selectedId = ref<string | null>(null)
const running = ref(0)

/** Per-user row order, applied after the registry order. */
const order = useStorage<string[]>('operations-services-order', [])

const selected = computed(() =>
  view.value?.services.find(service => service.serviceId === selectedId.value) ?? null,
)

async function refresh() {
  try {
    view.value = await api.view()
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

// Live stream drives the view; polling is only a fallback while it is down.
const stream = useOperationsEvents({
  onSnapshot: (next) => {
    view.value = next
    failed.value = false
    loading.value = false
  },
})

let poller: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void refresh()
  poller = setInterval(() => {
    if (stream.connected.value) return
    if (typeof document !== 'undefined' && document.hidden) return
    void refresh()
  }, 15_000)
})
onUnmounted(() => {
  if (poller) clearInterval(poller)
})

defineExpose({ refresh })

const services = computed(() => view.value?.services ?? [])

watch(services, () => {
  if (selectedId.value && !services.value.some(service => service.serviceId === selectedId.value)) {
    drawerOpen.value = false
    selectedId.value = null
  }
})

const stateOptions = computed(() => {
  const seen = new Set(services.value.map(service => service.observed))
  return [...seen].sort().map(state => ({ label: t(`operations.services.state.${state}`), value: state }))
})

/** Reordering only makes sense on the unfiltered, complete list. */
const canDrag = computed(() => search.value.trim().length === 0 && stateFilter.value === 'all')

const rows = computed<ServiceRow[]>(() => {
  const needle = search.value.trim().toLowerCase()
  const rank = new Map(order.value.map((id, index) => [id, index]))

  return services.value
    .map((service, index) => ({ service, index }))
    .filter(({ service }) => (stateFilter.value === 'all' ? true : service.observed === stateFilter.value))
    .filter(({ service }) =>
      !needle
      || service.serviceId.toLowerCase().includes(needle)
      || service.label.toLowerCase().includes(needle)
      || serviceName(service).toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const rankA = rank.get(a.service.serviceId)
      const rankB = rank.get(b.service.serviceId)
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB
      if (rankA !== undefined) return -1
      if (rankB !== undefined) return 1
      return a.index - b.index
    })
    .map(({ service }) => ({
      ...service,
      name: serviceName(service),
      stateLabel: t(`operations.services.state.${service.observed}`),
      healthLabel: t(`operations.services.health.${service.health}`),
      desiredLabel: t(`operations.services.desired.${service.desired}`),
      categoryLabel: t(`operations.services.category.${service.category}`),
      heartbeat: service.heartbeatAgeMs === null ? '—' : formatTimeAgo(new Date(Date.now() - service.heartbeatAgeMs)),
      lastSuccess: service.lastSuccessAt ? formatTimeAgo(new Date(service.lastSuccessAt)) : '—',
      output: service.workload.lastOutputCount ?? '—',
      interval: service.intervalSec ? `${service.intervalSec}s` : '—',
    }))
})

const columns = computed(() => [
  { key: 'name', label: t('operations.services.columns.service'), slot: 'name', class: 'min-w-[180px] flex-[2]' },
  { key: 'state', label: t('operations.services.columns.state'), slot: 'state', class: 'w-32' },
  { key: 'health', label: t('operations.services.columns.health'), slot: 'health', class: 'w-28 hidden xl:flex' },
  { key: 'slo', label: t('operations.services.columns.slo'), slot: 'slo', class: 'w-28 hidden xl:flex' },
  { key: 'desired', label: t('operations.services.columns.desired'), slot: 'desired', class: 'w-24 hidden xl:flex' },
  { key: 'heartbeat', label: t('operations.services.columns.heartbeat'), slot: 'heartbeat', class: 'w-24' },
  { key: 'lastSuccess', label: t('operations.services.columns.lastSuccess'), slot: 'lastSuccess', class: 'w-24 hidden xl:flex' },
  { key: 'output', label: t('operations.services.columns.output'), class: 'w-20 hidden xl:flex' },
  { key: 'actions', label: '', class: 'w-10' },
])

function stateColor(state: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (state === 'READY') return 'success'
  if (state === 'DEGRADED') return 'warning'
  if (state === 'FAILED') return 'error'
  if (state === 'STARTING' || state === 'STOPPING') return 'info'
  return 'neutral'
}

function openDetail(service: OperationsServiceRow) {
  selectedId.value = service.serviceId
  drawerOpen.value = true
}

function onReorder(items: ServiceRow[]) {
  order.value = items.map(item => item.serviceId)
}

// -----------------------------------------------------------------------------
//  Actions
// -----------------------------------------------------------------------------

async function runAction(item: ServiceRow, action: ServiceActionId) {
  const label = `${item.name} · ${t(`operations.services.actions.${action}`)}`
  running.value += 1
  try {
    const result = await runServiceOperation({
      serviceId: item.serviceId,
      action,
      request: (serviceId, act) => api.command(serviceId, act),
      fetchOperation: operationId => api.operation(operationId),
      onAccepted: () => notify.info(t('operations.services.result.accepted'), label),
    })
    if (result.state === 'SUCCEEDED') notify.success(t('operations.services.result.succeeded'), label)
    else if (result.state === 'UNCONFIRMED') notify.warning(t('operations.services.result.unconfirmed'), label)
    else if (result.state !== 'CANCELLED') notify.error(t('operations.services.result.failed'), result.error || label)
    void refresh()
  } catch (error) {
    const detail = (error as { data?: { message?: string, statusMessage?: string } })?.data
    notify.error(t('operations.services.result.rejected'), detail?.message || detail?.statusMessage || label)
  } finally {
    running.value -= 1
  }
}

type MenuItem = {
  label?: string
  type?: 'label'
  icon?: string
  color?: ServiceActionColor
  disabled?: boolean
  onSelect?: () => void
}

/** Grouped, coloured context menu — long-press on mobile, `⋯` on desktop. */
function getActionOptions(item: ServiceRow): MenuItem[][] {
  const meta = SERVICE_ACTIONS_UI.filter(entry => (item.supports ?? []).includes(entry.action))
  const control = meta.filter(entry => entry.group === 'control')
  const inspect = meta.filter(entry => entry.group === 'inspect')

  const groups: MenuItem[][] = []

  if (control.length) {
    groups.push([
      { type: 'label', label: t('operations.services.menu.control') },
      ...control.map(entry => ({
        label: t(`operations.services.actions.${entry.action}`),
        icon: entry.icon,
        color: entry.color,
        disabled: isActionDisabled(item, entry.action),
        onSelect: () => { void runAction(item, entry.action) },
      })),
    ])
  }

  groups.push([
    { type: 'label', label: t('operations.services.menu.inspect') },
    ...inspect.map(entry => ({
      label: t(`operations.services.actions.${entry.action}`),
      icon: entry.icon,
      color: entry.color,
      disabled: isActionDisabled(item, entry.action),
      onSelect: () => { void runAction(item, entry.action) },
    })),
    {
      label: t('operations.services.openDetail'),
      icon: 'i-lucide-panel-right-open',
      disabled: false,
      onSelect: () => openDetail(item),
    },
  ])

  return groups
}

/** Mobile swipe shortcuts: the fastest useful action for the current state. */
function swipeActions(item: ServiceRow) {
  const actions: Array<{ color: string, icon: string, click: (item: ServiceRow) => void }> = []
  if (!isActionDisabled(item, 'run-once')) {
    actions.push({ color: 'primary', icon: 'i-lucide-zap', click: row => { void runAction(row, 'run-once') } })
  }
  if (!isActionDisabled(item, 'stop')) {
    actions.push({ color: 'error', icon: 'i-lucide-square', click: row => { void runAction(row, 'stop') } })
  } else if (!isActionDisabled(item, 'start')) {
    actions.push({ color: 'success', icon: 'i-lucide-play', click: row => { void runAction(row, 'start') } })
  }
  return actions
}
</script>

<template>
  <div class="space-y-3">
    <!-- Summary -->
    <div class="flex flex-wrap items-center gap-2">
      <UBadge color="neutral" variant="subtle" size="sm"
        :label="`${t('operations.services.summary.total')} ${view?.summary.total ?? 0}`" />
      <UBadge color="success" variant="subtle" size="sm"
        :label="`${t('operations.services.summary.ready')} ${view?.summary.ready ?? 0}`" />
      <UBadge color="warning" variant="subtle" size="sm"
        :label="`${t('operations.services.summary.degraded')} ${view?.summary.degraded ?? 0}`" />
      <UBadge color="error" variant="subtle" size="sm"
        :label="`${t('operations.services.summary.failed')} ${view?.summary.failed ?? 0}`" />
      <UBadge color="info" variant="subtle" size="sm"
        :label="`${t('operations.services.summary.unknown')} ${view?.summary.unknown ?? 0}`" />
      <UBadge v-if="(view?.summary.drifting ?? 0) > 0" color="error" variant="outline" size="sm"
        :label="`${t('operations.services.summary.drifting')} ${view?.summary.drifting ?? 0}`" />
      <UBadge v-if="(view?.summary.planned ?? 0) > 0" color="neutral" variant="outline" size="sm"
        :label="`${t('operations.services.summary.planned')} ${view?.summary.planned ?? 0}`" />
      <UBadge v-if="(view?.summary.sloBreached ?? 0) > 0" color="error" variant="outline" size="sm"
        :label="`${t('operations.services.summary.sloBreached')} ${view?.summary.sloBreached ?? 0}`" />
      <UBadge v-if="(view?.summary.sloAtRisk ?? 0) > 0" color="warning" variant="outline" size="sm"
        :label="`${t('operations.services.summary.sloAtRisk')} ${view?.summary.sloAtRisk ?? 0}`" />
      <UBadge v-if="(view?.summary.deadLetterCount ?? 0) > 0" color="warning" variant="outline" size="sm"
        :label="`${t('operations.services.summary.deadLetter')} ${view?.summary.deadLetterCount ?? 0}`" />
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <UInput v-model="search" icon="i-lucide-search" size="sm" class="w-full sm:max-w-xs"
        :placeholder="t('operations.services.searchPlaceholder')" />
      <USelect v-model="stateFilter" size="sm" class="w-full sm:w-44"
        :items="[{ label: t('operations.services.filters.allStates'), value: 'all' }, ...stateOptions]" />
      <div class="flex items-center gap-2 sm:ml-auto">
        <UBadge :color="stream.connected.value ? 'success' : 'neutral'" variant="subtle" size="xs"
          :icon="stream.connected.value ? 'i-lucide-radio' : 'i-lucide-radio-tower'"
          :label="stream.connected.value ? t('operations.services.stream.live') : t('operations.services.stream.offline')" />
        <UIcon v-if="running > 0" name="i-lucide-loader-circle" class="size-4 animate-spin text-primary"
          :title="t('operations.services.running')" />
        <AdminViewModeToggle v-model="viewMode" />
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" :loading="loading"
          :label="t('operations.services.refresh')" @click="refresh" />
      </div>
    </div>

    <UAlert v-if="failed" color="error" variant="subtle" icon="i-lucide-alert-circle"
      :title="t('operations.services.loadFailed')" :description="t('operations.services.loadFailedHint')" />

    <LazyGridList
      :items="rows"
      :columns="columns"
      :loading="loading"
      item-key="serviceId"
      storage-key="operations-services-view-mode"
      v-model:view-mode="viewMode"
      :draggable="canDrag"
      :action-options="getActionOptions"
      :swipe-right-actions="swipeActions"
      grid-cols="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      :ui-scroll-area="{ root: 'max-h-[min(62vh,700px)]' }"
      @click="openDetail"
      @update:items="onReorder"
    >
      <template #name="{ item }">
        <div class="min-w-0">
          <p class="truncate text-xs font-medium text-highlighted">{{ item.name }}</p>
          <p class="truncate text-[11px] text-muted">{{ item.serviceId }}</p>
        </div>
      </template>

      <template #state="{ item }">
        <div class="flex items-center gap-1.5">
          <UBadge :color="stateColor(item.observed)" variant="subtle" size="xs" :label="item.stateLabel" />
          <UIcon v-if="item.drift" name="i-lucide-triangle-alert" class="size-3.5 text-error"
            :title="t('operations.services.flags.drift')" />
        </div>
      </template>

      <template #health="{ item }">
        <span class="text-xs text-toned">{{ item.healthLabel }}</span>
      </template>

      <template #slo="{ item }">
        <OperationsServiceSloBadge :status="item.slo.status" />
      </template>

      <template #desired="{ item }">
        <span class="text-xs text-toned">{{ item.desiredLabel }}</span>
      </template>

      <template #heartbeat="{ item }">
        <span class="text-xs text-toned">{{ item.registered ? item.heartbeat : t('operations.services.neverStarted') }}</span>
      </template>

      <template #lastSuccess="{ item }">
        <span class="text-xs text-toned">{{ item.lastSuccess }}</span>
      </template>

      <!-- Desktop actions: a single ⋯ that owns every action (AGENTS: secondary
           actions collapse, never compete with the primary action). -->
      <template #actions="{ item }">
        <UDropdownMenu :items="getActionOptions(item)" :popper="{ placement: 'bottom-end' }">
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs"
            :aria-label="t('operations.services.openMenu')" />
        </UDropdownMenu>
      </template>

      <!-- Mobile / grid card -->
      <template #mobile-content="{ item }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ item.name }}</p>
            <p class="truncate text-xs text-muted">{{ item.serviceId }} · {{ item.categoryLabel }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
              <UBadge :color="stateColor(item.observed)" variant="subtle" size="xs" :label="item.stateLabel" />
              <OperationsServiceSloBadge :status="item.slo.status" />
              <UBadge v-if="item.drift" color="error" variant="outline" size="xs"
                :label="t('operations.services.flags.drift')" />
              <span class="text-[11px] text-muted">{{ t('operations.services.columns.heartbeat') }}:
                {{ item.registered ? item.heartbeat : t('operations.services.neverStarted') }}</span>
              <span class="text-[11px] text-muted">{{ t('operations.services.columns.output') }}: {{ item.output }}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <UBadge v-if="item.planned" color="warning" variant="subtle" size="xs"
                :label="t('operations.services.flags.planned')" />
              <UBadge v-if="!item.supervised" color="info" variant="subtle" size="xs"
                :label="t('operations.services.flags.external')" />
            </div>
          </div>
          <UDropdownMenu :items="getActionOptions(item)" :popper="{ placement: 'bottom-end' }">
            <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs"
              :aria-label="t('operations.services.openMenu')" @click.stop />
          </UDropdownMenu>
        </div>
      </template>
    </LazyGridList>

    <LazyOperationsServiceDetailDrawer v-model:open="drawerOpen" :service="selected"
      :operations="view?.operations ?? []" :audit="view?.audit ?? []" @changed="refresh" />
  </div>
</template>
