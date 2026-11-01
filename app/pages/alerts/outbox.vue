<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Notification Outbox & Dead Letters (roadmap §7.3 /alerts/outbox).
//
//  Inspects current delivery queue counters and dead letters (terminal failures).
//  Operators can replay dead letters back into the queue for immediate retry.
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'outbox.title',
  descKey: 'outbox.desc'
})
const { viewMode } = useAdminGridView('outbox-view-mode')

const stats = ref<Record<string, number>>({ queued: 0, sent: 0, accepted: 0, failed: 0, dead: 0 })
const deadLetters = ref<any[]>([])
const isLoading = ref(false)
const mongo = ref<'up' | 'down'>('up')

async function refresh() {
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: { stats: Record<string, number>, dead: any[] }, meta: { mongo: 'up' | 'down' } }>('/api/v1/notifications/outbox')
    stats.value = res.data.stats || {}
    deadLetters.value = res.data.dead || []
    mongo.value = res.meta?.mongo || 'up'
  } catch (err) {
    mongo.value = 'down'
    notify.error(getErrorMessage(err, (k) => t(k)))
  } finally {
    isLoading.value = false
  }
}

async function replayItem(id: string) {
  try {
    await $fetch('/api/v1/notifications/outbox/replay', {
      method: 'POST',
      body: { id }
    })
    notify.success(t('outbox.replayed'))
    await refresh()
  } catch (err) {
    notify.error(getErrorMessage(err, (k) => t(k)))
  }
}

onMounted(async () => {
  await refresh()
})

const metrics = computed(() => [
  { key: 'queued', label: t('outbox.metrics.queued'), value: String(stats.value.queued || 0), icon: 'i-lucide-clock' },
  { key: 'sent', label: t('outbox.metrics.sent'), value: String(stats.value.sent || 0), icon: 'i-lucide-send', tone: 'success' as const },
  { key: 'accepted', label: t('outbox.metrics.accepted'), value: String(stats.value.accepted || 0), icon: 'i-lucide-check-check', tone: 'success' as const },
  { key: 'dead', label: t('outbox.metrics.dead'), value: String(stats.value.dead || deadLetters.value.length), icon: 'i-lucide-skull', tone: (stats.value.dead || deadLetters.value.length) ? 'error' as const : 'default' as const }
])

const trail = computed(() => [
  { label: t('nav.alerts_notifications') },
  { label: title.value }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'notifyId', label: t('outbox.columns.notifyId'), class: 'w-48' },
  { key: 'channel', label: t('outbox.columns.channel'), class: 'w-28' },
  { key: 'attempts', label: t('outbox.columns.attempts'), class: 'w-24' },
  { key: 'error', label: t('outbox.columns.error') },
  { key: 'updatedAt', label: t('outbox.columns.updatedAt'), class: 'w-36' },
  { key: 'actions', label: '', class: 'w-24' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))
mobileBar.registerInfo(computed(() => ({
  count: deadLetters.value.length,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="outbox" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('outbox.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('alertRules.mongoDown')" color="warning" variant="subtle" size="xs" />
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

    <template #toolbar>
      <AlertsTabs active="outbox" />
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 px-4 sm:px-6 py-2">
            <UBadge :label="t('outbox.deadCount', { n: deadLetters.length })" :color="deadLetters.length ? 'error' : 'neutral'" variant="subtle" size="sm" />
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="deadLetters.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="metrics" cols="grid-cols-1 sm:grid-cols-4" />

      <LazyGridList
        :items="deadLetters"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="_id"
        storage-key="outbox-view-mode"
        @refresh="refresh"
      >
        <template #notifyId="{ item }">
          <span class="font-mono text-xs text-highlighted truncate">{{ item.notifyId }}</span>
        </template>

        <template #channel="{ item }">
          <UBadge :label="item.channel" color="neutral" variant="outline" size="xs" />
        </template>

        <template #attempts="{ item }">
          <span class="text-xs font-medium">{{ item.attempts }}/{{ item.maxAttempts || 6 }}</span>
        </template>

        <template #error="{ item }">
          <p class="text-[11px] text-error truncate" :title="item.lastError">{{ item.lastError || '—' }}</p>
        </template>

        <template #updatedAt="{ item }">
          <time :datetime="item.updatedAt" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.updatedAt)) }}
          </time>
        </template>

        <template #actions="{ item }">
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-rotate-cw"
              variant="soft"
              color="primary"
              size="xs"
              :label="t('outbox.replay')"
              @click="replayItem(item._id)"
            />
          </div>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-semibold text-highlighted truncate">{{ item.notifyId }}</span>
                <UBadge :label="item.channel" color="neutral" variant="outline" size="xs" />
              </div>
              <p class="text-[11px] text-error mt-1 truncate">{{ item.lastError || '—' }}</p>
              <div class="flex items-center justify-between text-[10px] text-dimmed mt-1">
                <span>Attempts: {{ item.attempts }}</span>
                <time :datetime="item.updatedAt">{{ formatTimeAgo(new Date(item.updatedAt)) }}</time>
              </div>
            </div>
            <UButton
              icon="i-lucide-rotate-cw"
              variant="soft"
              color="primary"
              size="xs"
              @click="replayItem(item._id)"
            />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('outbox.empty')"
            :description="t('outbox.emptyHint')"
            icon="i-lucide-check-circle-2"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
