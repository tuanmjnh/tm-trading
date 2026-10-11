<script setup lang="ts">
import type { RunSeries, RunSeriesDetail } from '~~/types/runs'
import { buildOverlay, metricRows, paramsDiff, paramsValue } from '~~/shared/utils/compare'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const router = useRouter()
const runsApi = useRuns()
const { title, description } = useAdminPageChrome({
  titleKey: 'runs.compare.title',
  descKey: 'runs.compare.desc'
})

// Max series dat canh nhau — gio han de bang van doc duoc tren man hinh nho.
const MAX_COMPARE = 6

// 6 mau STATISTIC (day du class literal de Tailwind scan thay — khong dung
// template string, xem bao cao loi class thieu trong index.vue).
const LINE_CLASSES = ['stroke-primary', 'stroke-success', 'stroke-error', 'stroke-warning', 'stroke-info', 'stroke-secondary']
const BORDER_CLASSES = ['border-primary', 'border-success', 'border-error', 'border-warning', 'border-info', 'border-secondary']
const DOT_CLASSES = ['bg-primary', 'bg-success', 'bg-error', 'bg-warning', 'bg-info', 'bg-secondary']

const allSeries = ref<RunSeries[]>([])
const isLoadingList = ref(true)
const selectedIds = ref<string[]>([])
const loaded = ref<RunSeriesDetail[]>([])
const isLoadingDetails = ref(false)

const selectedSeries = computed(() =>
  selectedIds.value.map(id => allSeries.value.find(s => s.id === id)).filter(Boolean) as RunSeries[]
)
const selectedDetails = computed(() =>
  selectedIds.value.map(id => loaded.value.find(d => d.id === id)).filter(Boolean) as RunSeriesDetail[]
)

const rows = computed(() => metricRows(selectedDetails.value))
const pDiff = computed(() => paramsDiff(selectedDetails.value.map(d => d.params)))
const overlay = computed(() =>
  buildOverlay(selectedDetails.value.map(d => ({ id: d.id, equity: d.equity })))
)
/** So THE HE tham so khac nhau trong lua chon (D1: >1 = khong tron). */
const generationCount = computed(() => new Set(selectedDetails.value.map(d => d.paramsHash)).size)

/** Chi so mau theo vi tri chon — giu ON DINH giua bang, params va legend. */
function colorIndex(id: string): number {
  return selectedIds.value.indexOf(id)
}

function idsFromRoute(): string[] {
  const raw = route.query.ids
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return []
  return String(value).split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_COMPARE)
}

async function ensureDetail(id: string): Promise<void> {
  if (loaded.value.some(d => d.id === id)) return
  try {
    const detail = await runsApi.detail(id)
    loaded.value = [...loaded.value.filter(d => d.id !== id), detail]
  } catch (err) {
    // Huy chon series khong tai duoc — khong de cot trong loi muc.
    selectedIds.value = selectedIds.value.filter(x => x !== id)
    notify.error(t('runs.compare.title'), getErrorMessage(err, key => t(key)))
  }
}

async function loadDetails() {
  isLoadingDetails.value = true
  try {
    await Promise.all(selectedIds.value.map(ensureDetail))
  } finally {
    isLoadingDetails.value = false
  }
}

async function loadList() {
  isLoadingList.value = true
  try {
    const res = await runsApi.list({ limit: 100 })
    allSeries.value = res.items
    // Chi giu id con ton tai (hash doi -> bo; khong amend du lieu cu, D1).
    const known = new Set(res.items.map(s => s.id))
    selectedIds.value = idsFromRoute().filter(id => known.has(id))
    await loadDetails()
  } catch (err) {
    notify.error(t('runs.compare.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoadingList.value = false
  }
}

onMounted(loadList)

// Dong bo URL de chia se duoc (?ids=a,b) — replace de khong ton history moi chon.
watch(selectedIds, (ids) => {
  void router.replace({
    query: { ...route.query, ids: ids.length ? ids.join(',') : undefined }
  })
})

function toggle(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(x => x !== id)
    return
  }
  if (selectedIds.value.length >= MAX_COMPARE) {
    notify.warning(t('runs.compare.title'), t('runs.compare.maxReached'))
    return
  }
  selectedIds.value = [...selectedIds.value, id]
  void loadDetails()
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

function detailOf(id: string): RunSeriesDetail | undefined {
  return loaded.value.find(d => d.id === id)
}

// ---------------- Format ----------------

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const netColor = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted') : 'text-muted'

function fmtMetric(key: string, v: number | null): string {
  if (v === null) return '∞'
  switch (key) {
    case 'trades': return String(v)
    case 'winRate': return `${(v * 100).toFixed(1)}%`
    case 'net': case 'maxDD': return `${v.toFixed(2)}%`
    case 'profitFactor': return v.toFixed(2)
    case 'medianR': return `${v.toFixed(2)}R`
    case 'expectancy': return `${v.toFixed(3)}R`
    default: return String(v)
  }
}

function metricColor(key: string, v: number | null): string {
  if (key === 'net' || key === 'expectancy') return netColor(v)
  return 'text-highlighted'
}

const fmtAxisTime = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
const shortHash = (h: string) => h.slice(0, 8)

useHead({ title })
</script>

<template>
  <BasePage id="runs-compare" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          :label="`${selectedIds.length}/${MAX_COMPARE} ${t('runs.compare.selected')}`"
          color="primary"
          variant="subtle"
          size="sm"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoadingList || isLoadingDetails"
          @click="loadList"
        />
      </div>
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-4">
      <!-- Chon series -->
      <UCard class="shrink-0" :ui="{ body: 'p-3 sm:p-4' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-list-checks" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('runs.compare.pick') }}</h3>
            </div>
            <span class="text-[11px] text-dimmed">{{ t('runs.compare.pickHint') }}</span>
          </div>
        </template>

        <div v-if="isLoadingList" class="flex items-center gap-2 text-xs text-muted py-2">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
          {{ t('runs.compare.loadingList') }}
        </div>
        <div v-else class="flex flex-wrap gap-2">
          <button
            v-for="s in allSeries"
            :key="s.id"
            type="button"
            class="flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-lg border-2 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            :class="isSelected(s.id)
              ? BORDER_CLASSES[colorIndex(s.id)]
              : 'border-default hover:bg-elevated/60'"
            :disabled="!isSelected(s.id) && selectedIds.length >= MAX_COMPARE"
            @click="toggle(s.id)"
          >
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full shrink-0" :class="isSelected(s.id) ? DOT_CLASSES[colorIndex(s.id)] : 'bg-default-300 dark:bg-default-600'" />
              <span class="text-xs font-semibold text-highlighted">{{ s.symbol }}</span>
              <span class="text-[10px] text-muted">{{ s.tf }}m</span>
            </span>
            <span class="flex items-center gap-1.5 text-[10px] text-dimmed font-mono">
              <span>{{ shortHash(s.paramsHash) }}</span>
              <span class="font-semibold" :class="netColor(s.summary.netPct)">{{ fmtPct(s.summary.netPct) }}</span>
            </span>
          </button>
          <span v-if="!allSeries.length" class="text-xs text-muted">{{ t('runs.empty') }}</span>
        </div>
      </UCard>

      <!-- Canh bao D1: 2+ the he -->
      <UAlert
        v-if="generationCount > 1"
        color="info"
        variant="subtle"
        icon="i-lucide-layers-3"
        :title="t('runs.compare.genWarnTitle')"
        :description="t('runs.compare.genWarn', { n: generationCount })"
      />
      <UAlert
        v-else-if="selectedIds.length === 1"
        color="primary"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('runs.compare.needTwo')"
        :description="t('runs.compare.pickHint')"
      />

      <!-- Chua chon gi -->
      <UCard v-if="!selectedIds.length && !isLoadingList">
        <AdminEmptyState
          :title="t('runs.compare.pick')"
          :description="t('runs.compare.pickHint')"
          icon="i-lucide-scale"
        />
      </UCard>

      <template v-else>
        <!-- Bang so sanh chi so -->
        <UCard v-if="selectedDetails.length" class="shrink-0" :ui="{ body: 'p-3 sm:p-4' }">
          <template #header>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-table-2" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('runs.compare.stats') }}</h3>
              </div>
              <span class="text-[10px] text-dimmed">{{ t('runs.compare.bestNote') }}</span>
            </div>
          </template>

          <div class="overflow-x-auto">
            <table class="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th class="text-left text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5"></th>
                  <th
                    v-for="d in selectedDetails"
                    :key="d.id"
                    class="text-right text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5 min-w-28"
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" :class="DOT_CLASSES[colorIndex(d.id)]" />
                      <span class="text-highlighted normal-case font-semibold">{{ d.symbol }}</span>
                      <span>{{ d.tf }}m</span>
                    </span>
                    <div class="text-[9px] text-dimmed font-mono normal-case">{{ shortHash(d.paramsHash) }}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.key" class="border-t border-default/50">
                  <td class="px-2 py-1.5 text-muted whitespace-nowrap">{{ t(`runs.compare.metrics.${row.key}`) }}</td>
                  <td
                    v-for="(v, i) in row.values"
                    :key="i"
                    class="px-2 py-1.5 text-right font-mono"
                  >
                    <span
                      class="inline-block px-1 rounded"
                      :class="[
                        metricColor(row.key, v),
                        row.best === i ? 'bg-primary/10 font-bold' : 'font-medium'
                      ]"
                    >{{ fmtMetric(row.key, v) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <!-- Khac biet tham so (cau hoi cua 'so sanh preset') -->
        <UCard v-if="selectedDetails.length" class="shrink-0" :ui="{ body: 'p-3 sm:p-4' }">
          <template #header>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-sliders-horizontal" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('runs.compare.paramsTitle') }}</h3>
                <UBadge
                  v-if="pDiff.diffKeys.length"
                  :label="`${pDiff.diffKeys.length} ${t('runs.compare.paramsDiffBadge')}`"
                  color="warning"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <span v-if="!pDiff.diffKeys.length && pDiff.keys.length" class="text-[10px] text-dimmed">
                {{ t('runs.compare.paramsSame', { n: pDiff.sameCount }) }}
              </span>
            </div>
          </template>

          <div v-if="!pDiff.keys.length" class="text-xs text-muted">
            {{ t('runs.compare.paramsNone') }}
          </div>
          <template v-else-if="pDiff.diffKeys.length">
            <div class="overflow-x-auto">
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th class="text-left text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5">param</th>
                    <th
                      v-for="d in selectedDetails"
                      :key="d.id"
                      class="text-right text-[11px] font-medium text-muted uppercase tracking-wider px-2 py-1.5 min-w-28"
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full" :class="DOT_CLASSES[colorIndex(d.id)]" />
                        <span class="text-highlighted normal-case font-semibold">{{ d.symbol }}</span>
                        <span>{{ d.tf }}m</span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="key in pDiff.diffKeys" :key="key" class="border-t border-default/50 bg-warning/5">
                    <td class="px-2 py-1.5 font-mono text-muted whitespace-nowrap">{{ key }}</td>
                    <td
                      v-for="d in selectedDetails"
                      :key="d.id"
                      class="px-2 py-1.5 text-right font-mono text-highlighted break-all max-w-40"
                      :title="paramsValue(d.params[key])"
                    >{{ paramsValue(d.params[key]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="text-[10px] text-dimmed mt-2">
              {{ t('runs.compare.paramsSame', { n: pDiff.sameCount }) }}
            </p>
          </template>
          <UAlert
            v-else
            color="success"
            variant="subtle"
            icon="i-lucide-equal"
            :title="t('runs.compare.paramsAllSame')"
            :description="t('runs.compare.paramsSame', { n: pDiff.sameCount })"
          />
        </UCard>

        <!-- Equity overlay -->
        <UCard v-if="overlay" class="shrink-0" :ui="{ body: 'p-3 sm:p-4' }">
          <template #header>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-chart-no-axes-combined" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('runs.compare.equity') }}</h3>
              </div>
              <span class="text-[11px] text-dimmed font-mono">
                {{ fmtAxisTime(overlay.minT) }} → {{ fmtAxisTime(overlay.maxT) }} UTC
              </span>
            </div>
          </template>

          <div class="space-y-3">
            <div class="relative h-64 w-full">
              <svg
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                class="w-full h-full"
                role="img"
                :aria-label="t('runs.compare.equity')"
              >
                <line
                  x1="0" :y1="overlay.zeroY" x2="1000" :y2="overlay.zeroY"
                  class="stroke-muted/60"
                  stroke-dasharray="6 6"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  v-for="line in overlay.lines"
                  :key="line.id"
                  :d="line.d"
                  fill="none"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                  :class="LINE_CLASSES[colorIndex(line.id)]"
                />
              </svg>
              <div
                class="absolute right-1 -translate-y-1/2 text-[10px] font-mono text-dimmed bg-elevated/70 px-1 rounded"
                :style="{ top: `${overlay.zeroY}%` }"
              >0%</div>
            </div>
            <div class="flex justify-between text-[10px] text-dimmed font-mono">
              <span>{{ fmtAxisTime(overlay.minT) }}</span>
              <span>{{ fmtAxisTime(overlay.maxT) }}</span>
            </div>

            <!-- Legend: mau theo vi tri chon, net lay tu summary (diem cuoi === netPct, D1) -->
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              <span
                v-for="line in overlay.lines"
                :key="line.id"
                class="inline-flex items-center gap-1.5 text-[11px]"
              >
                <span class="w-2.5 h-0.5 rounded-full" :class="DOT_CLASSES[colorIndex(line.id)]" />
                <span class="text-highlighted font-medium">
                  {{ detailOf(line.id)?.symbol }} {{ detailOf(line.id)?.tf }}m
                </span>
                <span class="font-mono" :class="netColor(detailOf(line.id)?.summary.netPct)">
                  {{ fmtPct(detailOf(line.id)?.summary.netPct) }}
                </span>
              </span>
            </div>
          </div>
        </UCard>
      </template>
    </div>
  </BasePage>
</template>
