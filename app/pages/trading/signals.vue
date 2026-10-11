<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { SignalItem } from '~~/types/signals'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'signals.title',
  descKey: 'signals.desc'
})
const { viewMode } = useAdminGridView('signals-view-mode')
const { buildRowActions } = useAdminRowActions()
const signalsApi = useSignals()

// List collection `alerts` (D4) qua Nitro route noi dia.
const signalsList = useCursorPagination<SignalItem>({
  limit: 50,
  fetch: async (cursor, limit) => {
    const res = await signalsApi.list({ cursor: typeof cursor === 'string' ? cursor : null, limit })
    mongoDown.value = res.meta?.mongo === 'down'
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: signals, loading: isLoading, hasMore } = signalsList

const mongoDown = ref(false)

const handleListError = (err: unknown) => {
  notify.error(t('signals.title'), getErrorMessage(err, key => t(key)))
}

async function refreshSignals() {
  try {
    await signalsList.refresh()
  } catch (err) {
    handleListError(err)
  }
}

async function loadMoreSignals() {
  try {
    await signalsList.loadMore()
  } catch (err) {
    handleListError(err)
  }
}

onMounted(refreshSignals)

const columns = computed<GridColumn[]>(() => [
  { key: 'ts', label: t('signals.time'), class: 'w-36' },
  { key: 'symbol', label: t('signals.symbol'), class: 'w-44' },
  { key: 'tf', label: t('signals.tf'), class: 'w-16' },
  { key: 'action', label: t('signals.action'), class: 'w-28' },
  { key: 'side', label: t('signals.side'), class: 'w-20' },
  { key: 'price', label: t('signals.price'), class: 'w-24' },
  { key: 'sl', label: t('signals.sl'), class: 'w-24' },
  { key: 'tps', label: t('signals.tps'), class: 'w-44' },
  { key: 'conf', label: t('signals.conf'), class: 'w-20' },
  { key: 'status', label: t('signals.status'), class: 'w-24' }
])

const rowActions = () => buildRowActions([])

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'

const actionColor = (a: string | null) =>
  a === 'ENTRY' ? 'success' : a === 'STOP_LOSS' ? 'error' : a === 'TAKE_PROFIT' ? 'info' : 'neutral'

const sideColor = (s: string | null) => (s === 'BUY' ? 'success' : s === 'SELL' ? 'error' : 'neutral')

const statusColor = (s: string) =>
  s === 'forwarded' ? 'success' : s === 'rejected' ? 'error' : 'warning'

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: refreshSignals
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: signals.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="signals" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown"
          :label="t('signals.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshSignals"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter
        :count="signals.length"
        :has-more="hasMore"
        :loading="isLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList
        :items="signals"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="hasMore"
        :action-options="rowActions"
        v-model:view-mode="viewMode"
        item-key="id"
        storage-key="signals-view-mode"
        @load-more="loadMoreSignals"
        @refresh="refreshSignals"
      >
        <template #ts="{ item }">
          <time :datetime="item.ts" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.ts)) }}
          </time>
        </template>

        <template #symbol="{ item }">
          <div class="flex flex-col min-w-0 gap-0.5">
            <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
            <span class="text-[10px] text-dimmed font-mono truncate">{{ item.source }}</span>
          </div>
        </template>

        <template #tf="{ item }">
          <span class="text-xs text-muted">{{ item.tf ?? '—' }}</span>
        </template>

        <template #action="{ item }">
          <div class="flex items-center gap-1.5">
            <UBadge :label="item.action ?? '—'" :color="actionColor(item.action)" variant="subtle" size="xs" />
            <span v-if="item.level !== null" class="text-[10px] text-dimmed">L{{ item.level }}</span>
          </div>
        </template>

        <template #side="{ item }">
          <UBadge v-if="item.side" :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
          <span v-else class="text-xs text-muted">—</span>
        </template>

        <template #price="{ item }">
          <span class="text-xs text-highlighted font-mono">{{ fmtPrice(item.price) }}</span>
        </template>

        <template #sl="{ item }">
          <span class="text-xs text-error font-mono">{{ fmtPrice(item.sl) }}</span>
        </template>

        <template #tps="{ item }">
          <span class="text-xs text-success font-mono truncate">
            {{ item.tps.length ? item.tps.join(' · ') : '—' }}
          </span>
        </template>

        <template #conf="{ item }">
          <span class="text-xs text-muted">{{ item.conf !== null ? item.conf.toFixed(2) : '—' }}</span>
        </template>

        <template #status="{ item }">
          <UBadge :label="t(`signals.status_${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted truncate">{{ item.symbol ?? '—' }}</span>
                <UBadge :label="item.action ?? '—'" :color="actionColor(item.action)" variant="subtle" size="xs" />
                <UBadge v-if="item.side" :label="item.side" :color="sideColor(item.side)" variant="subtle" size="xs" />
              </div>
              <div class="text-[11px] text-dimmed font-mono mt-0.5 truncate">
                {{ fmtPrice(item.price) }}
                <span v-if="item.sl !== null" class="text-error"> · SL {{ fmtPrice(item.sl) }}</span>
                <span v-if="item.tps.length" class="text-success"> · TP {{ item.tps.join(' · ') }}</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <UBadge :label="t(`signals.status_${item.status}`)" :color="statusColor(item.status)" variant="subtle" size="xs" />
              <time :datetime="item.ts" class="block text-[10px] text-muted mt-1">
                {{ formatTimeAgo(new Date(item.ts)) }}
              </time>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('signals.empty')"
            :description="t('signals.emptyHint')"
            icon="i-lucide-radio-tower"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
