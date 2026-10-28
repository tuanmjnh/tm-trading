<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { FilterChip } from '~/components/shared/FilterChips.vue'
import type { BotInstance, BotProfile } from '#shared/types/bots'
import type { LiveBotSignal } from '~/composables/useBotsLive'
import { getErrorMessage } from '~/shared/utils/errors'
import { formatTimeAgo } from '@vueuse/core'

// Unified bot management: PROFILES (reusable config) + INSTANCES (runs) on one
// surface. The dashboard reads; the embedded supervisor owns lifecycle writes.
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.bots.profilesTitle',
  descKey: 'strategyLab.bots.profilesDesc'
})
const { viewMode } = useAdminGridView('bot-profiles-view-mode')
const { viewMode: instanceViewMode } = useAdminGridView('bot-instances-view-mode')
const botsApi = useBots()

const profiles = ref<BotProfile[]>([])
const instances = ref<BotInstance[]>([])
const isLoading = ref(false)
const statusFilter = ref('')
const instanceStateFilter = ref('')
const actingId = ref<string | null>(null)
const deleteTarget = ref<BotInstance | null>(null)
const deleting = ref(false)
// Profile ops
const renameTarget = ref<BotProfile | null>(null)
const renameValue = ref('')
const renaming = ref(false)
const deleteProfileTarget = ref<BotProfile | null>(null)
const deletingProfile = ref(false)

async function refresh() {
  isLoading.value = true
  try {
    const [p, i] = await Promise.all([
      botsApi.profiles({ limit: 200 }),
      botsApi.instances({ limit: 200 })
    ])
    profiles.value = p
    instances.value = i
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  refresh()
  live.start()
})

function openDetail(item: BotProfile) {
  navigateTo(`/strategy-lab/bots/${encodeURIComponent(item._id)}`)
}

const statusColor = (s: string) =>
  s === 'enabled' ? 'success' : s === 'disabled' ? 'neutral' : s === 'archived' ? 'error' : 'warning'
const statusLabel = (s: string) => t(`strategyLab.bots.statusLabels.${s}`)

const counts = computed(() => {
  const c = { total: profiles.value.length, enabled: 0, disabled: 0, archived: 0, draft: 0 }
  for (const p of profiles.value) {
    if (p.status === 'enabled') c.enabled++
    else if (p.status === 'disabled') c.disabled++
    else if (p.status === 'archived') c.archived++
    else if (p.status === 'draft') c.draft++
  }
  return c
})

const filtered = computed(() =>
  statusFilter.value ? profiles.value.filter(p => p.status === statusFilter.value) : profiles.value
)

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('strategyLab.bots.metrics.total'), value: String(counts.value.total), tone: 'primary' },
  { key: 'enabled', label: t('strategyLab.bots.statusLabels.enabled'), value: String(counts.value.enabled), tone: 'success' },
  { key: 'disabled', label: t('strategyLab.bots.statusLabels.disabled'), value: String(counts.value.disabled) },
  { key: 'archived', label: t('strategyLab.bots.statusLabels.archived'), value: String(counts.value.archived), tone: 'error' }
])

const statusChips = computed<FilterChip[]>(() => [
  { value: '', label: t('common.all'), count: counts.value.total },
  { value: 'enabled', label: t('strategyLab.bots.statusLabels.enabled'), count: counts.value.enabled },
  { value: 'disabled', label: t('strategyLab.bots.statusLabels.disabled'), count: counts.value.disabled },
  { value: 'archived', label: t('strategyLab.bots.statusLabels.archived'), count: counts.value.archived },
  { value: 'draft', label: t('strategyLab.bots.statusLabels.draft'), count: counts.value.draft }
])

const trail = computed(() => [
  { label: t('nav.strategy_lab') },
  { label: t('nav.bot_profiles') }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('strategyLab.bots.name'), class: 'w-56' },
  { key: 'mode', label: t('strategyLab.bots.mode'), class: 'w-32' },
  { key: 'strategyVersionId', label: t('strategyLab.bots.strategyVersion'), class: 'w-40' },
  { key: 'instruments', label: t('strategyLab.strategies.instruments'), class: 'w-40' },
  { key: 'status', label: t('strategyLab.bots.status'), class: 'w-24' },
  { key: 'updatedAt', label: t('strategyLab.strategies.updated'), class: 'w-28' },
  { key: 'actions', label: '', class: 'w-16' }
])

const mobileBar = useMobileBar()
const launchOpen = ref(false)
// Tabs: instances (primary) | profiles
const activeTab = ref('instances')
const tabItems = computed(() => [
  { label: `${t('strategyLab.bots.tabInstances')} (${instances.value.length})`, value: 'instances', icon: 'i-lucide-cpu' },
  { label: t('strategyLab.bots.tabProfiles'), value: 'profiles', icon: 'i-lucide-folder' }
])
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-play', label: t('strategyLab.bots.launchTitle'), color: 'primary', primary: true, onSelect: () => { prefill.value = null; launchOpen.value = true } },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

function onLaunched() {
  refresh()
}

// Launch modal prefill — cloned from an existing profile ("duplicate bot").
const prefill = ref<Record<string, unknown> | null>(null)

function launchFrom(profile: BotProfile, copySuffix = false) {
  const extra = profile as unknown as { paramOverrides?: Record<string, number | boolean | string>, execution?: Record<string, number | boolean> }
  prefill.value = {
    profileId: profile.profileId,
    name: copySuffix ? `${profile.name} (copy)` : (profile.name || undefined),
    symbol: profile.instruments?.[0],
    timeframe: profile.timeframes?.[0],
    initialCapital: profile.initialCapital || 10000,
    paramOverrides: extra.paramOverrides || undefined,
    execution: extra.execution ?? undefined
  }
  launchOpen.value = true
}

async function duplicateInstance(item: BotInstance) {
  if (!item.botProfileId) return
  const profile = await botsApi.profile(item.botProfileId)
  if (!profile) {
    notify.error(t('strategyLab.bots.commandFailed'), t('error.bot_profile_missing'))
    return
  }
  launchFrom(profile, true)
}

function profileActions(item: BotProfile): DropdownMenuItem[] {
  return [
    { label: t('strategyLab.bots.launchFrom'), icon: 'i-lucide-play', color: 'primary', onSelect: () => launchFrom(item) },
    { label: t('strategyLab.bots.duplicate'), icon: 'i-lucide-copy', onSelect: () => launchFrom(item, true) },
    { type: 'separator' },
    { label: t('strategyLab.bots.rename'), icon: 'i-lucide-pencil', onSelect: () => { renameTarget.value = item; renameValue.value = item.name || item.profileId } },
    {
      label: item.enabled ? t('strategyLab.bots.disable') : t('strategyLab.bots.enable'),
      icon: item.enabled ? 'i-lucide-pause' : 'i-lucide-power',
      color: item.enabled ? 'warning' : 'primary',
      onSelect: () => toggleProfile(item)
    },
    { type: 'separator' },
    { label: t('common.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { deleteProfileTarget.value = item } }
  ]
}

async function toggleProfile(item: BotProfile) {
  const ok = await botsApi.updateProfile(item.profileId, { enabled: !item.enabled })
  if (ok) notify.success(item.enabled ? t('strategyLab.bots.profileDisabled') : t('strategyLab.bots.profileEnabled'))
  else notify.error(t('strategyLab.bots.commandFailed'), t('error.serverError'))
  await refresh()
}

async function submitRename() {
  const target = renameTarget.value
  if (!target) return
  renaming.value = true
  const ok = await botsApi.updateProfile(target.profileId, { name: renameValue.value.trim() })
  renaming.value = false
  if (ok) {
    notify.success(t('strategyLab.bots.renamed'), t('strategyLab.bots.renamedOk', { name: renameValue.value.trim() }))
    renameTarget.value = null
    await refresh()
  } else {
    notify.error(t('strategyLab.bots.commandFailed'), t('error.serverError'))
  }
}

async function deleteProfile() {
  const target = deleteProfileTarget.value
  if (!target) return
  deletingProfile.value = true
  const ok = await botsApi.deleteProfile(target.profileId)
  deletingProfile.value = false
  if (ok) {
    notify.success(t('strategyLab.bots.profileDeleted'), t('strategyLab.bots.profileDeletedOk', { name: target.name || target.profileId }))
    deleteProfileTarget.value = null
    await refresh()
  } else {
    notify.error(t('strategyLab.bots.commandFailed'), t('error.bot_profile_active'))
  }
}

async function archiveInstance(item: BotInstance) {
  const ok = await botsApi.archiveInstance(item._id, true)
  if (ok) notify.success(t('strategyLab.bots.instanceArchived'), t('strategyLab.bots.instanceArchivedHint', { id: item.instanceId }))
  else notify.error(t('strategyLab.bots.commandFailed'), t('error.serverError'))
  await refresh()
}

async function exportInstance(item: BotInstance) {
  try {
    const blob = await $fetch<Blob>(`/api/v1/bots/instances/${encodeURIComponent(item._id)}/export`, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.instanceId}-export.json`
    a.click()
    URL.revokeObjectURL(url)
    notify.success(t('strategyLab.bots.exported'), t('strategyLab.bots.exportedHint', { id: item.instanceId }))
  } catch (err) {
    notify.error(t('strategyLab.bots.commandFailed'), getErrorMessage(err, key => t(key)))
  }
}

// ---------------------------------------------------------------------------
//  Instances (runs) — same-surface management: lifecycle commands + delete /
//  re-run for finished bots. Live state via a 5s poll while anything is active.
// ---------------------------------------------------------------------------
const instanceCounts = computed(() => {
  const c: Record<string, number> = {}
  for (const it of instances.value) c[it.state] = (c[it.state] ?? 0) + 1
  return c
})

const instanceMetrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('strategyLab.bots.instanceMetrics.total'), value: String(instances.value.length), tone: 'primary' },
  { key: 'running', label: t('strategyLab.bots.stateLabels.running'), value: String(instanceCounts.value.running ?? 0), tone: 'success' },
  { key: 'paused', label: t('strategyLab.bots.stateLabels.paused'), value: String(instanceCounts.value.paused ?? 0) },
  {
    key: 'finished',
    label: t('strategyLab.bots.stateLabels.completed'),
    value: String((instanceCounts.value.completed ?? 0) + (instanceCounts.value.failed ?? 0) + (instanceCounts.value.halted ?? 0)),
    tone: 'error'
  }
])

const instanceFiltered = computed(() =>
  instanceStateFilter.value
    ? instances.value.filter(i => i.state === instanceStateFilter.value)
    : instances.value)

const instanceChips = computed<FilterChip[]>(() => [
  { value: '', label: t('common.all'), count: instances.value.length },
  { value: 'running', label: t('strategyLab.bots.stateLabels.running'), count: instanceCounts.value.running ?? 0 },
  { value: 'paused', label: t('strategyLab.bots.stateLabels.paused'), count: instanceCounts.value.paused ?? 0 },
  { value: 'queued', label: t('strategyLab.bots.stateLabels.queued'), count: instanceCounts.value.queued ?? 0 },
  { value: 'completed', label: t('strategyLab.bots.stateLabels.completed'), count: instanceCounts.value.completed ?? 0 },
  { value: 'failed', label: t('strategyLab.bots.stateLabels.failed'), count: instanceCounts.value.failed ?? 0 }
])

const instanceStateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'paused' ? 'warning'
      : s === 'completed' ? 'info'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'
const instanceStateLabel = (s: string) => t(`strategyLab.bots.stateLabels.${s}`)

const instanceColumns = computed<GridColumn[]>(() => [
  { key: 'instanceId', label: t('strategyLab.bots.instance'), class: 'w-44' },
  { key: 'botProfileId', label: t('strategyLab.bots.profile'), class: 'w-40' },
  { key: 'state', label: t('strategyLab.bots.state'), class: 'w-24' },
  { key: 'startedAt', label: t('strategyLab.bots.started'), class: 'w-28' },
  { key: 'counts', label: t('strategyLab.bots.trades'), class: 'w-36' },
  { key: 'actions', label: '', class: 'w-16' }
])

function actionsFor(state: string): Array<{ label: string, icon: string, color: 'primary' | 'warning' | 'error', type: string }> {
  switch (state) {
    case 'queued':
    case 'starting':
      return [
        { label: t('common.start'), icon: 'i-lucide-play', color: 'primary', type: 'start' },
        { label: t('common.stop'), icon: 'i-lucide-square', color: 'error', type: 'stop' }
      ]
    case 'running':
      return [
        { label: t('common.pause'), icon: 'i-lucide-pause', color: 'warning', type: 'pause' },
        { label: t('common.stop'), icon: 'i-lucide-square', color: 'error', type: 'stop' }
      ]
    case 'paused':
      return [
        { label: t('common.resume'), icon: 'i-lucide-play', color: 'primary', type: 'resume' },
        { label: t('common.stop'), icon: 'i-lucide-square', color: 'error', type: 'stop' }
      ]
    default:
      return []
  }
}

function dropdownItems(item: BotInstance): DropdownMenuItem[] {
  const acts: DropdownMenuItem[] = [
    { label: t('strategyLab.bots.duplicate'), icon: 'i-lucide-copy', color: 'primary', onSelect: () => duplicateInstance(item) },
    { label: t('strategyLab.bots.exportRun'), icon: 'i-lucide-file-json', onSelect: () => exportInstance(item) }
  ]
  for (const a of actionsFor(item.state)) {
    acts.push({ label: a.label, icon: a.icon, color: a.color, disabled: actingId.value === item._id, onSelect: () => sendCommand(item, a.type) })
  }
  if (['completed', 'failed', 'halted'].includes(item.state)) {
    acts.push(
      { label: t('strategyLab.bots.rerun'), icon: 'i-lucide-rotate-ccw', onSelect: () => rerunInstance(item) },
      { type: 'separator' },
      { label: t('strategyLab.bots.archive'), icon: 'i-lucide-archive', onSelect: () => archiveInstance(item) },
      { label: t('common.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { deleteTarget.value = item } }
    )
  }
  return acts
}

async function sendCommand(item: BotInstance, type: string) {
  actingId.value = item._id
  try {
    const res = await $fetch<{ success: boolean, code?: string, data?: { status?: string, expectedState?: string } }>(
      `/api/v1/bots/instances/${encodeURIComponent(item._id)}/commands`,
      { method: 'POST', body: { type } }
    )
    if (res.success) {
      notify.success(
        t('strategyLab.bots.commandQueued', { action: t(`strategyLab.bots.stateLabels.${res.data?.expectedState ?? type}`) }),
        t('strategyLab.bots.commandQueuedHint')
      )
    } else {
      notify.error(t('strategyLab.bots.commandFailed'), res.code ?? t('error.serverError'))
    }
  } catch (err) {
    notify.error(t('strategyLab.bots.commandFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    actingId.value = null
    setTimeout(() => { void refresh() }, 2000)
  }
}

async function rerunInstance(item: BotInstance) {
  actingId.value = item._id
  try {
    const res = await $fetch<{ success: boolean, data?: { instanceId: string }, code?: string }>(
      `/api/v1/bots/instances/${encodeURIComponent(item._id)}/rerun`,
      { method: 'POST' }
    )
    if (res.success) {
      notify.success(t('strategyLab.bots.rerunQueued'), t('strategyLab.bots.commandQueuedHint'))
      if (res.data?.instanceId) openInstanceDetail(res.data.instanceId)
    } else {
      notify.error(t('strategyLab.bots.commandFailed'), res.code ?? t('error.serverError'))
    }
  } catch (err) {
    notify.error(t('strategyLab.bots.commandFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    actingId.value = null
    setTimeout(() => { void refresh() }, 2000)
  }
}

async function deleteInstance() {
  const item = deleteTarget.value
  if (!item) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/bots/instances/${encodeURIComponent(item._id)}`, { method: 'DELETE' as never })
    notify.success(t('strategyLab.bots.instanceDeleted'), t('strategyLab.bots.instanceDeletedHint', { id: item.instanceId }))
    deleteTarget.value = null
    await refresh()
  } catch (err) {
    notify.error(t('strategyLab.bots.commandFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    deleting.value = false
  }
}

function openInstanceDetail(id: string) {
  navigateTo(`/strategy-lab/bots/instances/${encodeURIComponent(id)}`)
}

// Realtime: SSE stream replaces client polling — the server pushes instance
// snapshots + the latest method signals only when something changed.
const live = useBotsLive()
const liveInstances = ref<BotInstance[] | null>(null)
const liveSignals = computed<LiveBotSignal[]>(() => live.signals.value.slice(0, 6))

watch(live.instances, (rows) => {
  if (rows?.length) liveInstances.value = rows
}, { immediate: true })

const hasActiveInstance = computed(() =>
  (liveInstances.value ?? instances.value).some(i => ['queued', 'starting', 'running', 'paused', 'stopping'].includes(i.state)))

useHead({ title })
</script>

<template>
  <BasePage id="bot_profiles" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('strategyLab.pips.botProfiles')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-play"
          :label="t('strategyLab.bots.launchTitle')"
          variant="soft"
          color="primary"
          size="sm"
          @click="launchOpen = true"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refresh"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6 overflow-y-auto">
      <UTabs
        v-model="activeTab"
        :content="false"
        :items="tabItems"
        size="sm"
      />

      <template v-if="activeTab === 'instances'">
        <SharedMetricRibbon :items="instanceMetrics" />
        <SharedFilterChips v-model="instanceStateFilter" :items="instanceChips" />

        <!-- Live signal ticker — method-attributed signals pushed by the SSE stream -->
        <div v-if="liveSignals.length" class="rounded border border-default bg-elevated/40 p-2">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="inline-block size-1.5 rounded-full" :class="live.connected ? 'bg-success animate-pulse' : 'bg-error'" />
            <span class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">{{ t('strategyLab.bots.liveSignals') }}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="sig in liveSignals"
              :key="sig.signalKey"
              class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono"
              :class="sig.type === 'ST LONG' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
              :title="`${sig.method} · ${sig.tf} · ${new Date(sig.ts).toLocaleString()}`"
            >
              <UIcon :name="sig.type === 'ST LONG' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'" class="size-3" />
              {{ sig.symbol }} {{ sig.type === 'ST LONG' ? '↑' : '↓' }}
            </span>
          </div>
        </div>

        <LazyGridList
          :items="liveInstances ?? instanceFiltered"
          :columns="instanceColumns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="instanceViewMode"
          item-key="_id"
          storage-key="bot-instances-view-mode"
          @refresh="refresh"
          @click="item => openInstanceDetail(item._id)"
        >
          <template #instanceId="{ item }">
            <span class="flex items-center gap-1.5 min-w-0">
              <CommonSymbolIcon :symbol="item.instruments?.[0] ?? item.source?.symbol ?? ''" />
              <span class="text-[11px] font-mono text-highlighted truncate">{{ item.instanceId }}</span>
            </span>
          </template>

          <template #botProfileId="{ item }">
            <span class="text-[11px] font-mono text-muted truncate">{{ item.botProfileId || '—' }}</span>
          </template>

          <template #state="{ item }">
            <UBadge :label="instanceStateLabel(item.state)" :color="instanceStateColor(item.state)" variant="subtle" size="xs" />
          </template>

          <template #startedAt="{ item }">
            <time v-if="item.startedAt" :datetime="new Date(item.startedAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.startedAt)) }}
            </time>
            <span v-else class="text-[11px] text-dimmed">—</span>
          </template>

          <template #counts="{ item }">
            <span class="text-[11px] text-muted">
              {{ item.counts?.signals ?? 0 }} / {{ item.counts?.orders ?? 0 }} / {{ item.counts?.trades ?? 0 }}
            </span>
          </template>

          <template #actions="{ item }">
            <UDropdownMenu :items="dropdownItems(item)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="xs"
                :aria-label="t('common.actions')" :title="t('common.actions')" />
            </UDropdownMenu>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <CommonSymbolIcon :symbol="item.instruments?.[0] ?? item.source?.symbol ?? ''" />
                  <span class="font-semibold text-highlighted font-mono truncate">{{ item.instanceId }}</span>
                  <UBadge :label="instanceStateLabel(item.state)" :color="instanceStateColor(item.state)" variant="subtle" size="xs" class="shrink-0" />
                </div>
                <div class="text-[11px] text-dimmed mt-0.5 truncate">
                  {{ item.botProfileId || '—' }} · {{ item.mode }}
                </div>
              </div>
              <UDropdownMenu :items="dropdownItems(item)" :content="{ align: 'end' }">
                <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="xs"
                  :aria-label="t('common.actions')" />
              </UDropdownMenu>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState :title="t('strategyLab.bots.instancesEmpty')" />
          </template>
        </LazyGridList>
      </template>

      <template v-else>
        <SharedMetricRibbon :items="metrics" />
        <SharedFilterChips v-model="statusFilter" :items="statusChips" />

        <LazyGridList
          :items="filtered"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="viewMode"
          item-key="_id"
          storage-key="bot-profiles-view-mode"
          @refresh="refresh"
          @click="openDetail"
        >
          <template #name="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.name || item.profileId }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.profileId }}</span>
            </div>
          </template>

          <template #mode="{ item }">
            <UBadge :label="item.mode" color="neutral" variant="subtle" size="xs" />
          </template>

          <template #strategyVersionId="{ item }">
            <span class="text-[11px] font-mono text-muted truncate">{{ item.strategyVersionId || '—' }}</span>
          </template>

          <template #instruments="{ item }">
            <span class="text-[11px] text-muted truncate">{{ item.instruments.length ? item.instruments.join(', ') : '—' }}</span>
          </template>

          <template #status="{ item }">
            <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" />
          </template>

          <template #updatedAt="{ item }">
            <time :datetime="new Date(item.updatedAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.updatedAt)) }}
            </time>
          </template>

          <template #actions="{ item }">
            <UDropdownMenu :items="profileActions(item)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="xs"
                :aria-label="t('common.actions')" :title="t('common.actions')" />
            </UDropdownMenu>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.name || item.profileId }}</span>
                  <UBadge :label="statusLabel(item.status)" :color="statusColor(item.status)" variant="subtle" size="xs" class="shrink-0" />
                </div>
                <div class="text-[11px] text-dimmed mt-0.5">{{ item.mode }} · {{ item.strategyVersionId || '—' }}</div>
              </div>
              <UDropdownMenu :items="profileActions(item)" :content="{ align: 'end' }">
                <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="xs"
                  :aria-label="t('common.actions')" />
              </UDropdownMenu>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('strategyLab.bots.profilesEmpty')"
              :description="t('strategyLab.bots.profilesEmptyHint')"
              icon="i-lucide-bot"
            />
          </template>
        </LazyGridList>
      </template>
    </div>

    <BotsLaunchBotModal v-model:open="launchOpen" :prefill="prefill" @launched="onLaunched" />

    <LazyBaseConfirmModal
      :open="!!deleteTarget"
      :title="t('strategyLab.bots.deleteInstanceTitle')"
      :description="t('strategyLab.bots.deleteInstanceDesc', { id: deleteTarget?.instanceId || '' })"
      :confirm-label="t('common.delete')"
      :loading="deleting"
      @update:open="value => !value && (deleteTarget = null)"
      @confirm="deleteInstance"
    />

    <!-- Rename profile -->
    <LazyBaseResponsiveModal
      :open="!!renameTarget"
      :title="t('strategyLab.bots.renameTitle')"
      icon="i-lucide-pencil"
      @update:open="value => !value && (renameTarget = null)"
    >
      <UFormField :label="t('strategyLab.bots.name')">
        <UInput v-model="renameValue" class="w-full" :placeholder="t('strategyLab.bots.name')" />
      </UFormField>
      <template #footer>
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="renameTarget = null" />
        <UButton
          :label="t('common.save')"
          color="primary"
          variant="soft"
          :loading="renaming"
          :disabled="!renameValue.trim()"
          @click="submitRename"
        />
      </template>
    </LazyBaseResponsiveModal>

    <!-- Delete profile confirm -->
    <LazyBaseConfirmModal
      :open="!!deleteProfileTarget"
      :title="t('strategyLab.bots.deleteProfileTitle')"
      :description="t('strategyLab.bots.deleteProfileDesc', { name: deleteProfileTarget?.name || deleteProfileTarget?.profileId || '' })"
      :confirm-label="t('common.delete')"
      :loading="deletingProfile"
      @update:open="value => !value && (deleteProfileTarget = null)"
      @confirm="deleteProfile"
    />
  </BasePage>
</template>
