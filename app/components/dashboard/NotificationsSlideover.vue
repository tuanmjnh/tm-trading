<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'
import type { GridColumn } from '~/components/gridList/Index.vue'

const { t } = useI18n()
const { isNotificationsSlideoverOpen } = useDashboard()
const auth = useAuth()
const {
  notify,
  unreadCount,
  isLoading,
  hasMore,
  fetchNotify,
  loadMoreNotify,
  markAsRead,
  markAllAsRead,
  deleteNotify
} = useNotify()
const { buildRowActions } = useAdminRowActions()
const { viewMode } = useAdminGridView('notifications-view-mode')

const isBusy = ref(false)
const isDeleteOpen = ref(false)
const deletingId = ref('')

const canManage = computed(() => auth.user.value?.permissions?.includes('*')
  || auth.user.value?.permissions?.includes('notifications.manage'))

onMounted(() => {
  if (auth.user.value) fetchNotify()
})

const columns = computed<GridColumn[]>(() => [
  { key: 'sender', label: t('common.name'), class: 'w-40' },
  { key: 'body', label: t('notifications.fieldBody') },
  { key: 'date', label: t('logs.time'), class: 'w-28' }
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

const onOpenNotification = async (item: any) => {
  if (item.unread) await markAsRead(item.id)
  isNotificationsSlideoverOpen.value = false
}

const onMarkAll = async () => {
  if (isBusy.value) return
  isBusy.value = true
  try {
    await markAllAsRead()
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <USlideover v-model:open="isNotificationsSlideoverOpen"
    :ui="{ body: 'flex-1 min-h-0 overflow-hidden flex flex-col p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between gap-3 w-full pr-1">
        <div class="flex items-center gap-2 min-w-0">
          <div class="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <UIcon name="i-lucide-bell" class="size-4 flex" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-highlighted truncate">
              {{ t('notifications.title') }}
            </h2>
            <p v-if="unreadCount > 0" class="text-[11px] text-muted">
              {{ unreadCount }} {{ t('common.unread') }}
            </p>
            <p v-else class="text-[11px] text-muted">
              {{ t('notifications.system') }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-0.5 shrink-0">
          <UTooltip v-if="unreadCount > 0" :text="t('notifications.markAllRead')">
            <UButton icon="i-lucide-check-check" variant="ghost" color="primary" size="xs" :loading="isBusy"
              :aria-label="t('notifications.markAllRead')" @click="onMarkAll" />
          </UTooltip>
          <UTooltip :text="t('common.refresh')">
            <UButton icon="i-lucide-refresh-cw" variant="ghost" color="neutral" size="xs"
              :aria-label="t('common.refresh')" @click="fetchNotify()" />
          </UTooltip>
          <USeparator orientation="vertical" class="mx-1 h-5" />
          <UTooltip :text="t('common.close')">
            <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="xs" :aria-label="t('common.close')"
              @click="isNotificationsSlideoverOpen = false" />
          </UTooltip>
        </div>
      </div>
    </template>

    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <div v-if="!auth.user.value" class="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <div class="p-3 rounded-full bg-primary/10 text-primary">
            <UIcon name="i-lucide-lock" class="size-6" />
          </div>
          <div class="space-y-1">
            <p class="text-sm font-medium text-highlighted">{{ t('notifications.signInTitle') }}</p>
            <p class="text-xs text-muted">{{ t('notifications.signInDesc') }}</p>
          </div>
        </div>

        <div v-else class="flex-1 min-h-0 h-full">
          <LazyGridList :items="notify" :columns="columns" :loading="isLoading" :can-load-more="hasMore"
            :action-options="rowActions" v-model:view-mode="viewMode" item-key="id" hide-header flat
            storage-key="notifications-view-mode" actions-button-visibility="always" @load-more="loadMoreNotify()"
            @refresh="fetchNotify()" @click="onOpenNotification">
            <template #sender="{ item }">
              <div class="flex items-center gap-2 min-w-0">
                <UChip color="error" :show="item.unread" inset>
                  <UAvatar :src="typeof item.sender?.avatar === 'string' ? item.sender.avatar : undefined"
                    :alt="item.sender?.name || t('notifications.system')" size="xs" />
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

            <template #mobile-content="{ item }">
              <div class="flex items-start gap-3">
                <UChip color="error" :show="item.unread" inset>
                  <UAvatar :src="typeof item.sender?.avatar === 'string' ? item.sender.avatar : undefined"
                    :alt="item.sender?.name || t('notifications.system')" size="md" />
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
                  <p class="text-[11px] text-dimmed mt-0.5 leading-relaxed line-clamp-2">{{ item.body }}</p>
                </div>
                <AdminRowActions :items="rowActions(item)" />
              </div>
            </template>

            <template #empty>
              <AdminEmptyState :title="t('common.no_notifications')" icon="i-lucide-bell-off" />
            </template>
          </LazyGridList>
        </div>
      </div>
    </template>
  </USlideover>

  <BaseConfirmModal v-model:open="isDeleteOpen" :title="t('confirm.delete_title')"
    :description="t('confirm.delete_desc')" :confirm-label="t('common.delete')" :cancel-label="t('common.cancel')"
    color="error" icon="i-lucide-trash-2" @confirm="handleDelete" />
</template>
