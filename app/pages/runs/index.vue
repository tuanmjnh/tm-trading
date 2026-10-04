<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { RunSeries } from '~~/types/runs'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'runs.title',
  descKey: 'runs.desc'
})
const { viewMode } = useAdminGridView('runs-view-mode')
const { buildRowActions } = useAdminRowActions()
const runsApi = useRuns()

// List doc reports/*.ndjson qua Nitro route noi dia (khong len tm-hub).
const runsList = useCursorPagination<RunSeries>({
  limit: 20,
  fetch: async (cursor, limit) => {
    const res = await runsApi.list({ cursor: typeof cursor === 'string' ? cursor : null, limit })
    return { items: res.items, nextCursor: res.nextCursor, hasMore: !!res.nextCursor }
  }
})
const { items: series, loading: isLoading, hasMore } = runsList

const handleListError = (err: unknown) => {
  notify.error(t('runs.title'), getErrorMessage(err, key => t(key)))
}

onMounted(async () => {
  try {
    await runsList.refresh()
  } catch (err) {
    handleListError(err)
  }
})

async function refreshRuns() {
  try {
    await runsList.refresh()
  } catch (err) {
    handleListError(err)
  }
}

async function loadMoreRuns() {
  try {
    await runsList.loadMore()
  } catch (err) {
    handleListError(err)
  }
}

function openDetail(item: RunSeries) {
  navigateTo(`/runs/${encodeURIComponent(item.id)}`)
}

// Bang tong hop Symbol x TF (Phase 7) - tinh TU list da load, khong goi API moi.
// Cach doc o (D1 khong tron the he): neu o co nhieu series (nhieu paramsHash)
// thi hien net cua lan chay MOI NHAT kem hieu `xN` - khong cong chung net
// cac the he vao nhau (xem engine: summarizeRuns tu choi tron the he).
const matrix = computed(() => {
  const list = series.value
  if (!list.length) return null
  const tfs = [...new Set(list.map(s => s.tf))].sort((a, b) => Number(a) - Number(b))
  const symbols = [...new Set(list.map(s => s.symbol))].sort()
  if (symbols.length < 2 && tfs.length < 2) return null
  const cells = new Map<string, RunSeries[]>()
  for (const s of list) {
    const key = `${s.symbol}|${s.tf}`
    const group = cells.get(key)
    if (group) group.push(s)
    else cells.set(key, [s])
  }
  for (const group of cells.values()) {
    group.sort((a, b) => (a.lastRunAt < b.lastRunAt ? 1 : a.lastRunAt > b.lastRunAt ? -1 : 0))
  }
  return { tfs, symbols, cells }
})

const matrixCell = (symbol: string, tf: string): { latest: RunSeries, count: number } | null => {
  const group = matrix.value?.cells.get(`${symbol}|${tf}`)
  const latest = group?.[0]
  if (!group || !latest) return null
  return { latest, count: group.length }
}

const columns = computed<GridColumn[]>(() => [
  { key: 'symbol', label: t('runs.symbol'), class: 'w-44' },
  { key: 'tf', label: t('runs.tf'), class: 'w-16' },
  { key: 'runs', label: t('runs.runs'), class: 'w-16' },
  { key: 'trades', label: t('runs.trades'), class: 'w-20' },
  { key: 'winRate', label: t('runs.winRate'), class: 'w-24' },
  { key: 'pf', label: t('runs.profitFactor'), class: 'w-20' },
  { key: 'net', label: t('runs.net'), class: 'w-24' },
  { key: 'lastRunAt', label: t('runs.lastRun'), class: 'w-36' }
])

const rowActions = (item: RunSeries) => buildRowActions([
  { type: 'view', onSelect: () => openDetail(item) }
])

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
const fmtPf = (v: number | null) => (v === null ? '∞' : v.toFixed(2))
const netColor = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: refreshRuns
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: series.value.length,
  hasMore: hasMore.value,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="runs" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-scale"
          :label="t('runs.compare.nav')"
          variant="soft"
          color="primary"
          size="sm"
          to="/runs/compare"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refreshRuns"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter
        :count="series.length"
        :has-more="hasMore"
        :loading="isLoading"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-4">
      <!-- Bang tong hop Symbol x TF -->
      <UCard v-if="matrix" class="shrink-0" :ui="{ body: 'p-3 sm:p-4' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-grid-3x3" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.matrix') }}</h3>
            </div>
            <UBadge
              v-if="hasMore"
              :label="t('runs.matrixPartial')"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th class="text-left text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5">{{ t('runs.symbol') }}</th>
                <th
                  v-for="tf in matrix.tfs"
                  :key="tf"
                  class="text-right text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5"
                >{{ tf }}m</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="symbol in matrix.symbols" :key="symbol" class="border-t border-default/50">
                <td class="px-2 py-1.5 font-semibold text-highlighted whitespace-nowrap">{{ symbol }}</td>
                <td
                  v-for="tf in matrix.tfs"
                  :key="tf"
                  class="px-2 py-1.5 text-right"
                >
                  <button
                    v-if="matrixCell(symbol, tf)"
                    type="button"
                    class="group inline-flex flex-col items-end gap-0.5 px-1.5 py-0.5 rounded hover:bg-elevated/60 transition-colors cursor-pointer"
                    @click="openDetail(matrixCell(symbol, tf)!.latest)"
                  >
                    <span class="font-semibold font-mono" :class="netColor(matrixCell(symbol, tf)!.latest.summary.netPct)">
                      {{ fmtPct(matrixCell(symbol, tf)!.latest.summary.netPct) }}
                      <span
                        v-if="matrixCell(symbol, tf)!.count > 1"
                        class="text-dimmed font-normal"
                        :title="`${matrixCell(symbol, tf)!.count} series`"
                      >×{{ matrixCell(symbol, tf)!.count }}</span>
                    </span>
                    <span class="text-[10px] text-dimmed">{{ matrixCell(symbol, tf)!.latest.summary.trades }} {{ t('runs.trades').toLowerCase() }}</span>
                  </button>
                  <span v-else class="text-dimmed px-1.5">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[10px] text-dimmed mt-2">{{ t('runs.matrixHint') }}</p>
      </UCard>

      <LazyGridList
        :items="series"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="hasMore"
        :action-options="rowActions"
        v-model:view-mode="viewMode"
        item-key="id"
        storage-key="runs-view-mode"
        @load-more="loadMoreRuns"
        @refresh="refreshRuns"
        @click="openDetail"
      >
        <template #symbol="{ item }">
          <div class="flex flex-col min-w-0 gap-0.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.symbol }}</span>
              <UBadge
                v-if="item.warnings.length"
                :label="t(`runs.warn.${item.warnings[0]}`)"
                color="warning"
                variant="subtle"
                size="xs"
              />
            </div>
            <span class="text-[10px] text-dimmed font-mono truncate">
              {{ item.method }}{{ item.preset ? ` · ${item.preset}` : '' }}
            </span>
          </div>
        </template>

        <template #tf="{ item }">
          <span class="text-xs text-muted">{{ item.tf }}m</span>
        </template>

        <template #runs="{ item }">
          <span class="text-xs text-highlighted">{{ item.summary.runs }}</span>
        </template>

        <template #trades="{ item }">
          <span class="text-xs text-highlighted">
            {{ item.summary.trades }}
            <span v-if="item.summary.open" class="text-dimmed">+{{ item.summary.open }}</span>
          </span>
        </template>

        <template #winRate="{ item }">
          <span class="text-xs text-muted">{{ fmtPct(item.summary.winRate * 100, 1) }}</span>
        </template>

        <template #pf="{ item }">
          <span class="text-xs text-muted">{{ fmtPf(item.summary.profitFactor) }}</span>
        </template>

        <template #net="{ item }">
          <span class="text-xs font-semibold" :class="netColor(item.summary.netPct)">
            {{ fmtPct(item.summary.netPct) }}
          </span>
        </template>

        <template #lastRunAt="{ item }">
          <time :datetime="item.lastRunAt" class="text-[11px] text-muted">
            {{ formatTimeAgo(new Date(item.lastRunAt)) }}
          </time>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted truncate">{{ item.symbol }}</span>
                <span class="text-muted shrink-0">{{ item.tf }}m</span>
                <UBadge
                  v-if="item.warnings.length"
                  :label="t(`runs.warn.${item.warnings[0]}`)"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
              </div>
              <div class="flex items-center gap-2 text-[11px] text-dimmed mt-0.5">
                <span>{{ t('runs.trades') }} {{ item.summary.trades }}</span>
                <span>· WR {{ fmtPct(item.summary.winRate * 100, 1) }}</span>
                <span>· PF {{ fmtPf(item.summary.profitFactor) }}</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs font-semibold" :class="netColor(item.summary.netPct)">
                {{ fmtPct(item.summary.netPct) }}
              </div>
              <time :datetime="item.lastRunAt" class="text-[10px] text-muted">
                {{ formatTimeAgo(new Date(item.lastRunAt)) }}
              </time>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('runs.empty')"
            :description="t('runs.emptyHint')"
            icon="i-lucide-flask-conical"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
