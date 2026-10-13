<script setup lang="ts">
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'
import { formatTimeAgo } from '@vueuse/core'
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'

const { t } = useI18n()
const auth = useAuth()
const {
  notify,
  unreadCount,
  isLoading,
  fetchNotify,
  markAsRead,
  markAllAsRead,
  deleteNotify
} = useNotify()
const { viewMode } = useAdminGridView('notifications-view-mode')
const { title, description } = useAdminPageChrome({
  titleKey: 'notifications.title',
  descKey: 'notifications.description'
})
const { buildRowActions } = useAdminRowActions()
const { exporting: exportingNotifications, exportModule: exportNotifications } = useModuleExport()
const { appId: hubAppId } = useHub()
const notificationsAppId = computed(() => hubAppId)

const isRoot = computed(() => auth.user.value?.permissions?.includes('*')
  || auth.user.value?.permissions?.includes('notifications.send')
  || auth.user.value?.role === 'root')

const canManage = computed(() => auth.user.value?.permissions?.includes('*')
  || auth.user.value?.permissions?.includes('notifications.manage'))

const isSendOpen = ref(false)
const isDeleteOpen = ref(false)
const deletingId = ref('')

const metrics = computed(() => {
  const total = notify.value.length
  const unread = unreadCount.value
  return [
    { key: 'total', label: t('notifications.metrics.total'), value: String(total), icon: 'i-lucide-inbox' },
    { key: 'unread', label: t('notifications.metrics.unread'), value: String(unread), icon: 'i-lucide-mail', tone: unread ? 'warning' as const : 'default' as const },
    { key: 'read', label: t('notifications.metrics.read'), value: String(Math.max(0, total - unread)), icon: 'i-lucide-mail-open' }
  ]
})

const trail = computed(() => [
  { label: t('nav.alerts_notifications') },
  { label: title.value }
])


onMounted(async () => {
  await fetchNotify()
})

async function handleMarkAll() {
  await markAllAsRead()
}

function confirmDelete(id: string) {
  deletingId.value = id
  isDeleteOpen.value = true
}

async function handleDelete() {
  if (!deletingId.value) return
  await deleteNotify([deletingId.value])
  isDeleteOpen.value = false
  deletingId.value = ''
}

async function onNotificationClick(item: any) {
  if (item.unread) await markAsRead(item.id)
}

const columns = computed<GridColumn[]>(() => [
  { key: 'sender', label: t('common.name'), class: 'w-48' },
  { key: 'body', label: t('notifications.fieldBody') },
  { key: 'date', label: t('logs.time'), class: 'w-36' },
  { key: 'unread', label: t('common.unread'), class: 'w-24' }
])

const rowActions = (item: any) => {
  const configs: RowActionConfig[] = []
  if (item.unread) {
    configs.push({ type: 'custom', label: t('common.read'), icon: 'i-lucide-check', onSelect: () => markAsRead(item.id) })
  }
  if (canManage.value) {
    configs.push({ type: 'delete', onSelect: () => confirmDelete(item.id) })
  }
  return buildRowActions(configs)
}

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'markAll',
    icon: 'i-lucide-check-check',
    label: t('notifications.markAllRead'),
    visible: unreadCount.value > 0,
    onSelect: handleMarkAll
  },
  {
    key: 'send',
    icon: 'i-lucide-send',
    label: t('notifications.sendTitle'),
    color: 'primary',
    primary: true,
    visible: isRoot.value,
    onSelect: () => { isSendOpen.value = true }
  },
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exportingNotifications.value,
    children: buildExportChildren(t, fmt => exportNotifications(notificationsAppId.value, 'notifications', fmt))
  }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => fetchNotify()
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: notify.value.length,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="notifications" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('notifications.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading"
          @click="fetchNotify()" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <UBadge :label="`${unreadCount} ${t('common.unread')}`" color="warning" variant="subtle" size="sm" />
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="notify.length" :has-more="false" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" cols="grid-cols-1 sm:grid-cols-3" />
      <UAlert v-if="!auth.user.value" color="info" variant="subtle" icon="i-lucide-info"
        :title="t('notifications.signInTitle')" :description="t('notifications.signInDesc')" />

      <LazyGridList v-else :items="notify" :columns="columns" :loading="isLoading" :can-load-more="false"
        :action-options="rowActions" v-model:view-mode="viewMode" item-key="id" storage-key="notifications-view-mode"
        @refresh="fetchNotify()" @click="onNotificationClick">
        <template #sender="{ item }">
          <div class="flex items-center gap-2 min-w-0">
            <UChip color="error" :show="item.unread" inset>
              <UAvatar :src="typeof item.sender?.avatar === 'string' ? item.sender.avatar : undefined"
                :alt="item.sender?.name || 'System'" size="xs" />
            </UChip>
            <span class="font-medium text-xs truncate" :class="item.unread ? 'text-highlighted' : 'text-muted'">
              {{ item.sender?.name || t('notifications.system') }}
            </span>
          </div>
        </template>

        <template #body="{ item }">
          <p class="text-[11px] truncate" :class="item.unread ? 'text-default' : 'text-dimmed'">{{ item.body }}</p>
        </template>

        <template #date="{ item }">
          <time :datetime="item.date" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.date)) }}
          </time>
        </template>

        <template #unread="{ item }">
          <AdminStatusBadge :label="item.unread ? t('common.unread') : t('common.read')"
            :color="item.unread ? 'warning' : 'neutral'" />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <UChip color="error" :show="item.unread" inset>
              <UAvatar :src="typeof item.sender?.avatar === 'string' ? item.sender.avatar : undefined"
                :alt="item.sender?.name || 'System'" size="md" />
            </UChip>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-highlighted truncate">
                  {{ item.sender?.name || t('notifications.system') }}
                </span>
                <time :datetime="item.date" class="text-[11px] text-muted shrink-0">
                  {{ formatTimeAgo(new Date(item.date)) }}
                </time>
              </div>
              <p class="text-[11px] text-dimmed mt-0.5 leading-relaxed">{{ item.body }}</p>
            </div>
            <AdminRowActions :items="rowActions(item)" />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState :title="t('common.no_notifications')" icon="i-lucide-bell-off" />
        </template>
      </LazyGridList>
    </div>

    <NotificationsSendSlideover v-if="isRoot" v-model:open="isSendOpen" />

    <BaseConfirmModal v-model:open="isDeleteOpen" :title="t('confirm.delete_title')"
      :description="t('confirm.delete_desc')" :confirm-label="t('common.delete')" :cancel-label="t('common.cancel')"
      color="error" icon="i-lucide-trash-2" @confirm="handleDelete" />
  </BasePage>
</template>
