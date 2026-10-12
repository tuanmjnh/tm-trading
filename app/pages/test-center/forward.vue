<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { PaperAccountDetail, PaperAccountSummary } from '~~/types/paper'
import type { PositionItem } from '~~/types/positions'

// Forward test monitor (roadmap §58.9 Slice 3). A forward test IS a sustained
// live-paper session, so this reads the existing §30.5 paper-account API (the
// single source of truth, D1) — never a parallel store. Fail-soft: a down store
// shows an empty state, not an error page.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'testCenter.forward.title',
  descKey: 'testCenter.forward.desc'
})

const fwd = useForwardTests()
const { viewMode } = useAdminGridView('forward-view-mode')

const accounts = ref<PaperAccountSummary[]>([])
const selected = ref<string | null>(null)
const detail = ref<PaperAccountDetail | null>(null)
const positions = ref<PositionItem[]>([])
const isLoading = ref(false)
const mongo = ref<'up' | 'down'>('down')
const autoRefresh = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  isLoading.value = true
  try {
    const list = await fwd.listAccounts()
    accounts.value = list.items
    mongo.value = list.mongo
    if (!selected.value || !list.items.some(a => a.accountId === selected.value)) {
      selected.value = list.items[0]?.accountId ?? null
    }
    if (selected.value) {
      const [d, p] = await Promise.all([
        fwd.accountDetail(selected.value),
        fwd.positions(selected.value, { limit: 100 })
      ])
      detail.value = d
      positions.value = p.items
    } else {
      detail.value = null
      positions.value = []
    }
  } finally {
    isLoading.value = false
  }
}

function selectAccount(id: string) {
  if (id === selected.value) return
  selected.value = id
  void load()
}

onMounted(() => { void load() })

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (on) timer = setInterval(() => { void load() }, 15000)
})

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('testCenter.forward.symbol'), class: 'w-40' },
  { key: 'dir', label: t('testCenter.forward.dir'), class: 'w-20' },
  { key: 'qty', label: t('testCenter.forward.qty'), class: 'w-24' },
  { key: 'entry', label: t('testCenter.forward.entry'), class: 'w-28' },
  { key: 'mark', label: t('testCenter.forward.mark'), class: 'w-28' },
  { key: 'pnl', label: t('testCenter.forward.pnl'), class: 'w-28' }
])

const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const money = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—'
const netColor = (v: number | null | undefined) =>
  typeof v === 'number' && v > 0 ? 'text-success' : typeof v === 'number' && v < 0 ? 'text-error' : 'text-muted'

const pnlOf = (p: PositionItem) => p.live?.unrealized ?? p.pnlAbs ?? null
const markOf = (p: PositionItem) => p.live?.mark ?? null
const dirLabel = (p: PositionItem) => (p.dir === 1 ? t('testCenter.forward.long') : t('testCenter.forward.short'))
const dirColor = (p: PositionItem) => (p.dir === 1 ? 'text-success' : 'text-error')

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
mobileBar.registerInfo(computed(() => ({
  count: positions.value.length,
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="forward-tests" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-timer"
          :label="t('testCenter.forward.autoRefresh')"
          :color="autoRefresh ? 'primary' : 'neutral'"
          :variant="autoRefresh ? 'soft' : 'ghost'"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="autoRefresh = !autoRefresh"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="positions.length" :has-more="false" :loading="isLoading" />
    </template>

    <div v-if="!accounts.length" class="flex flex-col w-full h-full min-h-0">
      <AdminEmptyState
        :title="t('testCenter.forward.empty')"
        :description="t('testCenter.forward.emptyHint')"
        icon="i-lucide-fast-forward"
      />
    </div>

    <div v-else class="flex flex-col w-full h-full min-h-0 gap-3 overflow-y-auto pb-24 lg:pb-6">
      <!-- Account selector -->
      <div v-if="accounts.length > 1" class="flex items-center gap-1.5 flex-wrap shrink-0">
        <UButton
          v-for="a in accounts"
          :key="a.accountId"
          :label="a.accountId"
          size="xs"
          :color="selected === a.accountId ? 'primary' : 'neutral'"
          :variant="selected === a.accountId ? 'soft' : 'outline'"
          @click="selectAccount(a.accountId)"
        />
      </div>

      <!-- Account portrait -->
      <UCard v-if="detail" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ detail.accountId }}</h3>
              <UBadge :label="detail.mode" color="neutral" variant="subtle" size="xs" />
              <UBadge v-if="mongo === 'down'" :label="t('testCenter.forward.storeDown')" color="warning" variant="subtle" size="xs" />
            </div>
            <span v-if="detail.updatedAt" class="text-[10px] text-dimmed">
              {{ t('testCenter.forward.updated') }} {{ formatTimeAgo(new Date(detail.updatedAt)) }}
            </span>
          </div>
        </template>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.equity') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ money(detail.equity) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.balance') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ money(detail.balance) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.realized') }}</span>
            <span class="text-sm font-semibold" :class="netColor(detail.realizedPnl)">{{ money(detail.realizedPnl) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.daily') }}</span>
            <span class="text-sm font-semibold" :class="netColor(detail.dailyPnl)">{{ money(detail.dailyPnl) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.unrealized') }}</span>
            <span class="text-sm font-semibold" :class="netColor(detail.unrealized)">{{ money(detail.unrealized) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.marginUsed') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ money(detail.marginUsed) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.freeMargin') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ money(detail.freeMargin) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.drawdown') }}</span>
            <span class="text-sm font-semibold text-highlighted">
              {{ money(detail.maxDrawdown) }} <span class="text-[10px] text-dimmed">({{ fmtPct(detail.maxDrawdownPct) }})</span>
            </span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.openPositions') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ detail.openPositions }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.utilization') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ fmtPct(detail.utilizationPct, 1) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.currency') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ detail.currency }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.forward.initialBalance') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ money(detail.initialBalance) }}</span>
          </div>
        </div>
      </UCard>

      <!-- Positions -->
      <div class="flex-1 min-h-0">
        <LazyGridList
          :items="positions"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="viewMode"
          item-key="id"
          storage-key="forward-view-mode"
          @refresh="load"
        >
          <template #symbol="{ item }">
            <span class="font-semibold text-xs text-highlighted">{{ item.symbol }}</span>
          </template>

          <template #dir="{ item }">
            <span class="text-xs font-medium" :class="dirColor(item)">{{ dirLabel(item) }}</span>
          </template>

          <template #qty="{ item }">
            <span class="text-xs text-muted font-mono">{{ fmtNum(item.qty, 4) }}</span>
          </template>

          <template #entry="{ item }">
            <span class="text-xs text-muted font-mono">{{ fmtNum(item.entryPrice, 2) }}</span>
          </template>

          <template #mark="{ item }">
            <span class="text-xs text-muted font-mono">{{ fmtNum(markOf(item), 2) }}</span>
          </template>

          <template #pnl="{ item }">
            <span class="text-xs font-semibold" :class="netColor(pnlOf(item))">{{ money(pnlOf(item)) }}</span>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                  <span class="font-medium shrink-0" :class="dirColor(item)">{{ dirLabel(item) }}</span>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-dimmed mt-0.5">
                  <span>{{ fmtNum(item.qty, 4) }} @ {{ fmtNum(item.entryPrice, 2) }}</span>
                </div>
              </div>
              <div class="text-right shrink-0 text-xs font-semibold" :class="netColor(pnlOf(item))">
                {{ money(pnlOf(item)) }}
              </div>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('testCenter.forward.positionsEmpty')"
              :description="t('testCenter.forward.positionsEmptyHint')"
              icon="i-lucide-layers"
            />
          </template>
        </LazyGridList>
      </div>
    </div>
  </BasePage>
</template>
