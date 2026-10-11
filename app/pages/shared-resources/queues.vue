<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'

const { t } = useI18n()
const notify = useNotify()
const { appId: hubAppId } = useHub()
const { title, description } = useAdminPageChrome({
  titleKey: 'queues.title',
  descKey: 'queues.description'
})
const mobileBar = useMobileBar()
const { buildRowActions } = useAdminRowActions()

type QueueKey = 'mail' | 'import'

interface QueueStatBucket {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

interface QueueStatsView {
  high: QueueStatBucket
  normal: QueueStatBucket
  low: QueueStatBucket
  scheduled: QueueStatBucket
  dead: QueueStatBucket
  total: QueueStatBucket
}

interface QueueJob {
  id: string
  queue: string
  state: string
  attempts: number
  maxAttempts: number
  timestamp: number | null
  processedOn: number | null
  finishedOn: number | null
  failedReason: string | null
  summary: string
}

interface QueueData {
  enabled: boolean
  stats: QueueStatsView | null
  jobs: QueueJob[]
}

const appId = computed(() => {
  const store = useAppsStore()
  return store.activeAppId || store.apps[0]?.id || hubAppId
})

const activeTab = ref<QueueKey>('mail')
const loading = ref(false)
const actionLoading = ref('')
const data = ref<Record<QueueKey, QueueData | null>>({ mail: null, import: null })

const isCancelOpen = ref(false)
const isCleanOpen = ref(false)
const cancellingJob = ref<QueueJob | null>(null)

const currentData = computed(() => data.value[activeTab.value])
const enabled = computed(() => !!currentData.value?.enabled)
const stats = computed(() => currentData.value?.stats || null)
const jobs = computed(() => currentData.value?.jobs || [])

const tabs: { key: QueueKey, label: string, icon: string }[] = [
  { key: 'mail', label: 'queues.tabMail', icon: 'i-lucide-mail' },
  { key: 'import', label: 'queues.tabImport', icon: 'i-lucide-file-input' }
]

const statCards = computed(() => [
  { key: 'waiting', label: t('queues.statWaiting'), value: stats.value?.total.waiting ?? 0, color: 'warning' as const, icon: 'i-lucide-clock' },
  { key: 'active', label: t('queues.statActive'), value: stats.value?.total.active ?? 0, color: 'info' as const, icon: 'i-lucide-loader-circle' },
  { key: 'completed', label: t('queues.statCompleted'), value: stats.value?.total.completed ?? 0, color: 'success' as const, icon: 'i-lucide-check-circle' },
  { key: 'failed', label: t('queues.statFailed'), value: stats.value?.total.failed ?? 0, color: 'error' as const, icon: 'i-lucide-x-circle' },
  { key: 'delayed', label: t('queues.statDelayed'), value: stats.value?.total.delayed ?? 0, color: 'primary' as const, icon: 'i-lucide-calendar-clock' }
])

const priorityRows = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { key: 'high', label: t('queues.prioHigh'), bucket: s.high },
    { key: 'normal', label: t('queues.prioNormal'), bucket: s.normal },
    { key: 'low', label: t('queues.prioLow'), bucket: s.low },
    { key: 'scheduled', label: t('queues.prioScheduled'), bucket: s.scheduled },
    { key: 'dead', label: t('queues.prioDead'), bucket: s.dead }
  ]
})

const columns = computed<GridColumn[]>(() => [
  { key: 'queue', label: t('queues.fieldQueue'), class: 'w-28' },
  { key: 'state', label: t('queues.fieldState'), class: 'w-24' },
  { key: 'summary', label: t('queues.fieldSummary') },
  { key: 'attempts', label: t('queues.fieldAttempts'), class: 'w-24' },
  { key: 'time', label: t('queues.fieldTime'), class: 'w-32' }
])

const stateColor = (state: string): 'neutral' | 'warning' | 'info' | 'success' | 'error' | 'primary' => {
  const map: Record<string, 'neutral' | 'warning' | 'info' | 'success' | 'error' | 'primary'> = {
    waiting: 'warning',
    active: 'info',
    completed: 'success',
    failed: 'error',
    delayed: 'primary',
    paused: 'neutral',
    unknown: 'neutral'
  }
  return map[state] || 'neutral'
}

const canCancel = (job: QueueJob) => !['active'].includes(job.state)

const rowActions = (item: QueueJob) => buildRowActions(
  canCancel(item)
    ? [
        {
          type: 'custom' as const,
          label: t('queues.cancelJob'),
          icon: 'i-lucide-x-circle',
          onSelect: () => {
            cancellingJob.value = item
            isCancelOpen.value = true
          }
        }
      ]
    : []
)

async function load() {
  if (!appId.value) return
  loading.value = true
  try {
    const [mail, importQueueData] = await Promise.all([
      adminFetch<{ success: boolean, data: QueueData }>(`/api/v1/apps/${encodeURIComponent(appId.value)}/mail/queue`),
      adminFetch<{ success: boolean, data: QueueData }>(`/api/v1/apps/${encodeURIComponent(appId.value)}/import/queue`)
    ])
    data.value = { mail: mail.data, import: importQueueData.data }
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}

async function runAction(action: 'pause' | 'resume' | 'clean') {
  if (!appId.value || actionLoading.value) return
  actionLoading.value = action
  try {
    await adminFetch(`/api/v1/apps/${encodeURIComponent(appId.value)}/${activeTab.value}/queue`, {
      method: 'POST',
      body: { action }
    })
    if (action === 'pause') notify.success(t('queues.pauseSuccess'))
    else if (action === 'resume') notify.success(t('queues.resumeSuccess'))
    else notify.success(t('queues.cleanSuccess'))
    await load()
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    actionLoading.value = ''
  }
}

async function confirmCancel() {
  const job = cancellingJob.value
  if (!job || !appId.value) return
  isCancelOpen.value = false
  try {
    await adminFetch(`/api/v1/apps/${encodeURIComponent(appId.value)}/${activeTab.value}/queue`, {
      method: 'POST',
      body: { action: 'cancel', jobId: job.id }
    })
    notify.success(t('queues.cancelSuccess'))
    await load()
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    cancellingJob.value = null
  }
}

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'pause',
    icon: 'i-lucide-pause',
    label: t('queues.pause'),
    overflow: true,
    disabled: !enabled.value || !!actionLoading.value,
    onSelect: () => runAction('pause')
  },
  {
    key: 'resume',
    icon: 'i-lucide-play',
    label: t('queues.resume'),
    overflow: true,
    disabled: !enabled.value || !!actionLoading.value,
    onSelect: () => runAction('resume')
  },
  {
    key: 'clean',
    icon: 'i-lucide-eraser',
    label: t('queues.clean'),
    color: 'warning',
    overflow: true,
    disabled: !enabled.value || !!actionLoading.value,
    onSelect: () => { isCleanOpen.value = true }
  }
])

async function confirmClean() {
  isCleanOpen.value = false
  await runAction('clean')
}

mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => load()
  }
]))

onMounted(load)
watch(appId, (next) => { if (next) load() })

useHead({ title })
</script>

<template>
  <BasePage id="queues" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          :label="enabled ? t('queues.enabled') : t('queues.disabled')"
          :color="enabled ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
        />
        <BaseHeaderActions :actions="headerActions" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="loading" @click="load()" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-1 rounded-lg bg-default ring ring-default p-1">
            <UButton
              v-for="tab in tabs"
              :key="tab.key"
              :icon="tab.icon"
              :label="t(tab.label)"
              size="xs"
              color="neutral"
              :variant="activeTab === tab.key ? 'soft' : 'ghost'"
              @click="activeTab = tab.key"
            />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-4">
      <UAlert
        v-if="!enabled && !loading"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="t('queues.disabledTitle')"
        :description="t('queues.disabledDesc')"
      />

      <template v-if="enabled">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div
            v-for="card in statCards"
            :key="card.key"
            class="rounded-lg bg-default ring ring-default p-3 flex flex-col gap-1"
          >
            <div class="flex items-center gap-1.5 text-muted">
              <UIcon :name="card.icon" class="size-3.5" />
              <span class="text-[11px] font-medium uppercase tracking-wide">{{ card.label }}</span>
            </div>
            <span class="text-xl font-semibold text-highlighted">{{ card.value }}</span>
          </div>
        </div>

        <div class="rounded-lg bg-default ring ring-default overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-left">
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.priority') }}</th>
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.statWaiting') }}</th>
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.statActive') }}</th>
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.statCompleted') }}</th>
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.statFailed') }}</th>
                <th class="px-4 py-2 font-medium text-muted">{{ t('queues.statDelayed') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in priorityRows" :key="row.key" class="border-b border-default last:border-0">
                <td class="px-4 py-2 font-medium text-highlighted">{{ row.label }}</td>
                <td class="px-4 py-2 text-muted">{{ row.bucket.waiting }}</td>
                <td class="px-4 py-2 text-muted">{{ row.bucket.active }}</td>
                <td class="px-4 py-2 text-muted">{{ row.bucket.completed }}</td>
                <td class="px-4 py-2 text-muted">{{ row.bucket.failed }}</td>
                <td class="px-4 py-2 text-muted">{{ row.bucket.delayed }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <LazyGridList
          :items="jobs"
          :columns="columns"
          :loading="loading"
          :can-load-more="false"
          :action-options="rowActions"
          item-key="id"
          storage-key="queues-view-mode"
          flat
          @refresh="load()"
        >
          <template #queue="{ item }">
            <UBadge :label="item.queue" color="neutral" variant="subtle" size="xs" />
          </template>

          <template #state="{ item }">
            <AdminStatusBadge
              :label="t(`queues.state.${item.state}`)"
              :color="stateColor(item.state)"
            />
          </template>

          <template #summary="{ item }">
            <div class="min-w-0">
              <p class="text-xs text-highlighted truncate">{{ item.summary || '—' }}</p>
              <p v-if="item.failedReason" class="text-[10px] text-error truncate">{{ item.failedReason }}</p>
            </div>
          </template>

          <template #attempts="{ item }">
            <span class="text-xs text-muted">{{ item.attempts }}/{{ item.maxAttempts }}</span>
          </template>

          <template #time="{ item }">
            <time v-if="item.timestamp" :datetime="new Date(item.timestamp).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.timestamp)) }}
            </time>
            <span v-else class="text-[11px] text-dimmed">—</span>
          </template>

          <template #empty>
            <AdminEmptyState :title="t('queues.noJobs')" icon="i-lucide-list-x" />
          </template>
        </LazyGridList>
      </template>
    </div>

    <BaseConfirmModal
      v-model:open="isCancelOpen"
      :title="t('queues.cancelTitle')"
      :description="t('queues.cancelDesc', [cancellingJob?.summary || cancellingJob?.id || ''])"
      :confirm-label="t('queues.cancelJob')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-x-circle"
      @confirm="confirmCancel"
    />

    <BaseConfirmModal
      v-model:open="isCleanOpen"
      :title="t('queues.cleanTitle')"
      :description="t('queues.cleanDesc')"
      :confirm-label="t('queues.clean')"
      :cancel-label="t('common.cancel')"
      color="warning"
      icon="i-lucide-eraser"
      @confirm="confirmClean"
    />
  </BasePage>
</template>
