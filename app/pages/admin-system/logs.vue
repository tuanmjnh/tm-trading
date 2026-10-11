<script setup lang="ts">
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import type { GridColumn } from '~/components/gridList/Index.vue'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

interface AuditLogItem {
  _id?: string
  appId: string
  docId: string
  modelName: string
  action: string
  by?: {
    _id?: string
    name?: string
    email?: string
    username?: string
  }
  source?: string
  ip?: string
  userAgent?: string
  at: number
  changes?: Record<string, { old: any, new: any }>
}

interface LogsResponse {
  success: boolean
  data: AuditLogItem[]
  nextCursor: number | null
}

const { t } = useI18n()
const appsStore = useAppsStore()
const { hubFetch, appId } = useHub()
const notify = useNotify()
const { viewMode } = useAdminGridView('logs-view-mode')
const { title, description } = useAdminPageChrome({
  titleKey: 'logs.title',
  descKey: 'logs.desc'
})
const { buildRowActions } = useAdminRowActions()
const { exporting: exportingLogs, exportModule: exportLogs } = useModuleExport()

const ALL = 'all'

const selectedAppId = ref<string>(appId || '')
const actionFilter = ref<string>(ALL)
const selectedLog = ref<AuditLogItem | null>(null)
const isDetailOpen = ref(false)

const logsList = useAdminList<AuditLogItem>({
  limit: 50,
  fetchPage: async ({ appId, cursor, limit }) => {
    if (!appId || appId === ALL) return { items: [], nextCursor: null }
    const res = await hubFetch<LogsResponse>(
      `/api/v1/apps/${encodeURIComponent(appId)}/logs`,
      { query: { limit, cursor: cursor ? Number(cursor) : undefined } }
    )
    const items = res.success && Array.isArray(res.data) ? res.data : []
    return { items, nextCursor: res.nextCursor != null ? String(res.nextCursor) : null }
  }
})

const { items: logs, loading: isLoading, hasMore } = logsList

const isAllApps = computed(() => !selectedAppId.value || selectedAppId.value === ALL)

const appOptions = computed(() => [
  { label: t('logs.allApps'), value: ALL },
  ...appsStore.apps.map(a => ({ label: a.name, value: a.id }))
])

const actionOptions = computed(() => {
  const actions = [...new Set(logs.value.map(l => l.action))].sort()
  return [
    { label: t('logs.allActions'), value: ALL },
    ...actions.map(a => ({ label: a, value: a }))
  ]
})

const filteredLogs = computed(() => {
  if (!actionFilter.value || actionFilter.value === ALL) return logs.value
  return logs.value.filter(l => l.action === actionFilter.value)
})

const actionColor = (action: string): 'primary' | 'success' | 'error' | 'warning' | 'neutral' => {
  if (action.includes('delete') || action.includes('failed')) return 'error'
  if (action.includes('create') || action.includes('register')) return 'success'
  if (action.includes('pin')) return 'warning'
  if (action.includes('login') || action.includes('refresh')) return 'primary'
  return 'neutral'
}

const handleListError = (err: unknown) => {
  notify.error(t('logs.title'), getErrorMessage(err, key => t(key)))
}

async function refreshLogs() {
  try {
    await logsList.refresh()
  } catch (err) {
    handleListError(err)
  }
}

async function loadMoreLogs() {
  try {
    await logsList.loadMore()
  } catch (err) {
    handleListError(err)
  }
}

function openDetail(item: AuditLogItem) {
  selectedLog.value = item
  isDetailOpen.value = true
}

watch(selectedAppId, async (v) => {
  actionFilter.value = ALL
  try {
    await logsList.setApp(v)
  } catch (err) {
    handleListError(err)
  }
})

onMounted(async () => {
  await appsStore.fetchApps()
  const hubAppId = (useRuntimeConfig().public.hubAppId as string) || 'tm-hub'
  selectedAppId.value = hubAppId
})

const columns = computed<GridColumn[]>(() => [
  { key: 'action', label: t('logs.action'), class: 'w-32' },
  { key: 'modelName', label: t('logs.model'), class: 'w-36' },
  { key: 'docId', label: t('logs.docId') },
  { key: 'actor', label: t('logs.actor'), class: 'w-40' },
  { key: 'source', label: t('logs.source'), class: 'w-32' },
  { key: 'at', label: t('logs.time'), class: 'w-36' }
])

const rowActions = (item: AuditLogItem) => buildRowActions([
  { type: 'view', onSelect: () => openDetail(item) }
])

const mobileBar = useMobileBar()
const logsAppId = computed(() => {
  if (selectedAppId.value && selectedAppId.value !== ALL) return selectedAppId.value
  return appsStore.activeAppId || appsStore.apps[0]?.id || ''
})
const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exportingLogs.value,
    children: buildExportChildren(t, fmt => exportLogs(logsAppId.value, 'logs', fmt))
  }
])
mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: refreshLogs
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: filteredLogs.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="logs" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshLogs"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <!-- App fixed to satellite appId -->
            <AdminFilterPopover>
              <USelectMenu
                v-if="logs.length > 0"
                v-model="actionFilter"
                :items="actionOptions"
                value-key="value"
                :placeholder="t('logs.allActions')"
                size="sm"
                class="w-full md:w-52"
              />
              <p v-else class="text-xs text-muted">{{ t('logs.desc') }}</p>
            </AdminFilterPopover>
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter
        :count="filteredLogs.length"
        :has-more="hasMore"
        :loading="isLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <div v-if="isAllApps" class="py-8">
        <AdminEmptyState :title="t('logs.selectAppHint')" icon="i-lucide-scroll-text" />
      </div>

      <LazyGridList
        v-else
        :items="filteredLogs"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="hasMore"
        :action-options="rowActions"
        v-model:view-mode="viewMode"
        item-key="_id"
        storage-key="logs-view-mode"
        @load-more="loadMoreLogs"
        @refresh="refreshLogs"
        @click="openDetail"
      >
        <template #action="{ item }">
          <UBadge
            :label="item.action"
            :color="actionColor(item.action)"
            variant="subtle"
            size="sm"
            class="font-mono"
          />
        </template>

        <template #modelName="{ item }">
          <span class="font-medium text-xs text-highlighted truncate">{{ item.modelName }}</span>
        </template>

        <template #docId="{ item }">
          <code class="text-[11px] text-muted font-mono truncate">{{ item.docId }}</code>
        </template>

        <template #actor="{ item }">
          <span class="text-[11px] truncate">{{ item.by?.name || item.by?.email || 'system' }}</span>
        </template>

        <template #source="{ item }">
          <span class="text-[11px] text-muted truncate">{{ item.source || '—' }}</span>
        </template>

        <template #at="{ item }">
          <time :datetime="new Date(item.at).toISOString()" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.at)) }}
          </time>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <UBadge
              :label="item.action"
              :color="actionColor(item.action)"
              variant="subtle"
              size="sm"
              class="shrink-0 font-mono"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted truncate">{{ item.modelName }}</span>
                <span class="text-muted truncate font-mono">{{ item.docId }}</span>
              </div>
              <div class="flex items-center gap-2 text-[11px] text-dimmed mt-0.5">
                <span>{{ item.by?.name || item.by?.email || 'system' }}</span>
                <span v-if="item.source">· {{ item.source }}</span>
                <span v-if="item.ip">· {{ item.ip }}</span>
              </div>
            </div>
            <time :datetime="new Date(item.at).toISOString()" class="text-[11px] text-muted shrink-0">
              {{ formatTimeAgo(new Date(item.at)) }}
            </time>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState :title="t('logs.empty')" icon="i-lucide-scroll-text" />
        </template>
      </LazyGridList>
    </div>

    <!-- Log detail slideover -->
    <BaseResponsiveSlideover
      v-if="selectedLog"
      v-model:open="isDetailOpen"
      :title="t('logs.detail')"
      :description="`${selectedLog.modelName} · ${selectedLog.docId}`"
      icon="i-lucide-scroll-text"
      :ui="{ content: 'w-screen max-w-2xl' }"
    >
      <template #body>
        <LogsLogItem :item="selectedLog" />
      </template>
    </BaseResponsiveSlideover>
  </BasePage>
</template>
