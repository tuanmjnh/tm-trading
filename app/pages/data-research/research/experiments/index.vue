<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { Experiment, ExperimentState } from '~~/types/research'
import { getErrorMessage } from '~/shared/utils/errors'

// Experiments (roadmap §58.9 Slice 5, §28). The human review queue for AI
// candidates: every row is a persisted `experiments` doc. Creating one from a
// proposal writes a `proposed` draft only — it never touches the live strategy
// (D7). Accept/reject happens on the detail page, behind the §28.3 gate.
const { t } = useI18n()
const notify = useNotify()
const router = useRouter()
const api = useResearch()

const { title, description } = useAdminPageChrome({
  titleKey: 'research.experimentsTitle',
  descKey: 'research.experimentsDesc'
})
const { viewMode } = useAdminGridView('research-experiments-view-mode')

const rows = ref<Experiment[]>([])
const isLoading = ref(false)
const statusFilter = ref('')

const STATUSES: { value: string; label: ExperimentState | 'all' }[] = [
  { value: '', label: 'all' },
  { value: 'proposed', label: 'proposed' },
  { value: 'approved', label: 'approved' },
  { value: 'running', label: 'running' },
  { value: 'backtested', label: 'backtested' },
  { value: 'holdout', label: 'holdout' },
  { value: 'paper_validation', label: 'paper_validation' },
  { value: 'accepted', label: 'accepted' },
  { value: 'rejected', label: 'rejected' }
]

async function refresh() {
  isLoading.value = true
  try {
    // Fetch the full queue once; status is filtered client-side so the chip
    // counts reflect every experiment, not a server-narrowed subset.
    rows.value = await api.experiments({ status: '', limit: 200 })
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const filtered = computed(() =>
  statusFilter.value ? rows.value.filter(r => r.status === statusFilter.value) : rows.value)

const statusChips = computed(() => STATUSES.map(s => ({
  value: s.value,
  label: t(`research.status.${s.label}`),
  count: s.value ? rows.value.filter(r => r.status === s.value).length : rows.value.length
})))

const ACTIVE_STATES = ['proposed', 'approved', 'running', 'backtested', 'holdout', 'paper_validation']

const metrics = computed(() => {
  const accepted = rows.value.filter(r => r.status === 'accepted').length
  const rejected = rows.value.filter(r => r.status === 'rejected').length
  const active = rows.value.filter(r => ACTIVE_STATES.includes(r.status || '')).length
  return [
    { key: 'total', label: t('research.rollup.total'), value: String(rows.value.length), icon: 'i-lucide-test-tube' },
    { key: 'active', label: t('research.rollup.active'), value: String(active), icon: 'i-lucide-loader', tone: 'primary' as const },
    { key: 'accepted', label: t('research.rollup.accepted'), value: String(accepted), icon: 'i-lucide-check-circle', tone: 'success' as const },
    { key: 'rejected', label: t('research.rollup.rejected'), value: String(rejected), icon: 'i-lucide-x-circle', tone: rejected ? 'error' as const : 'default' as const }
  ]
})

const trail = computed(() => [
  { label: t('nav.data_research') },
  { label: title.value }
])

// -------- create from a proposal (human approval, D7) --------
const showCreate = ref(false)
const proposalJson = ref('')
const createError = ref('')
const creating = ref(false)

function openCreate() {
  proposalJson.value = ''
  createError.value = ''
  showCreate.value = true
}

async function submitCreate() {
  createError.value = ''
  let parsed: unknown
  try {
    parsed = JSON.parse(proposalJson.value || '{}')
  } catch (err) {
    createError.value = getErrorMessage(err, key => t(key))
    return
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    createError.value = t('research.create.notObject')
    return
  }
  creating.value = true
  try {
    const exp = await api.createExperiment(parsed as never)
    notify.success(t('research.create.success'))
    showCreate.value = false
    await refresh()
    if (exp?._id) router.push(`/data-research/research/experiments/${encodeURIComponent(exp._id)}`)
  } catch (err) {
    createError.value = getErrorMessage(err, key => t(key))
  } finally {
    creating.value = false
  }
}

function openDetail(item: Experiment) {
  router.push(`/data-research/research/experiments/${encodeURIComponent(item._id)}`)
}

const fmtDate = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleString() : '—')
function statusColor(s: string): 'primary' | 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (s === 'accepted') return 'success'
  if (s === 'rejected') return 'error'
  if (s === 'paper_validation') return 'warning'
  if (s === 'running') return 'primary'
  if (s === 'approved') return 'info'
  return 'neutral'
}

const columns = computed<GridColumn[]>(() => [
  { key: 'experimentId', label: t('research.columns.experiment'), class: 'min-w-56' },
  { key: 'status', label: t('research.columns.status'), class: 'w-36' },
  { key: 'hypothesis', label: t('research.columns.hypothesis'), class: 'min-w-64' },
  { key: 'changes', label: t('research.columns.changes'), class: 'w-20' },
  { key: 'createdAt', label: t('research.columns.created'), class: 'w-40' },
  { key: 'open', label: '', class: 'w-12' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-plus', label: t('research.create.action'), onSelect: openCreate },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="research-experiments" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('research.pips.experiments')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-sparkles"
          :label="t('research.viewResearch')"
          variant="soft"
          color="neutral"
          size="sm"
          to="/data-research/research"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-plus"
          :label="t('research.create.action')"
          variant="soft"
          color="primary"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="openCreate"
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

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <FilterChips v-model="statusFilter" :items="statusChips" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />
      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="_id"
        storage-key="research-experiments-view-mode"
        @refresh="refresh"
      >
        <template #experimentId="{ item }">
          <span class="text-[11px] font-mono text-highlighted truncate">{{ item.experimentId || item._id }}</span>
        </template>

        <template #status="{ item }">
          <UBadge :label="t(`research.status.${item.status}`)" :color="statusColor(item.status || '')" variant="subtle" size="xs" />
        </template>

        <template #hypothesis="{ item }">
          <span class="text-xs text-highlighted line-clamp-2">{{ item.hypothesis || '—' }}</span>
        </template>

        <template #changes="{ item }">
          <span class="text-[11px] font-mono text-muted">{{ item.changes?.length ?? 0 }}</span>
        </template>

        <template #createdAt="{ item }">
          <span class="text-[11px] text-muted">{{ fmtDate(item.createdAt) }}</span>
        </template>

        <template #open="{ item }">
          <UButton
            icon="i-lucide-arrow-right"
            variant="ghost"
            color="neutral"
            size="xs"
            :aria-label="t('research.open')"
            @click="openDetail(item)"
          />
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <UBadge :label="t(`research.status.${item.status}`)" :color="statusColor(item.status || '')" variant="subtle" size="xs" class="shrink-0" />
                <span class="font-mono text-[10px] text-dimmed truncate">{{ item.experimentId || item._id }}</span>
              </div>
              <div class="text-[11px] text-highlighted mt-0.5 line-clamp-2">{{ item.hypothesis || '—' }}</div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('research.experimentsEmpty')"
            :description="t('research.experimentsEmptyHint')"
            icon="i-lucide-test-tube"
          />
        </template>
      </LazyGridList>
    </div>

    <UModal v-model:open="showCreate" :title="t('research.create.title')">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">{{ t('research.create.desc') }}</p>
          <UTextarea
            v-model="proposalJson"
            :placeholder="t('research.create.placeholder')"
            :rows="10"
            class="w-full font-mono text-[11px]"
            :aria-label="t('research.create.title')"
          />
          <UAlert v-if="createError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="createError" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton :label="t('global.cancel')" color="neutral" variant="ghost" :disabled="creating" @click="showCreate = false" />
          <UButton :label="t('research.create.confirm')" color="primary" variant="soft" :loading="creating" @click="submitCreate" />
        </div>
      </template>
    </UModal>
  </BasePage>
</template>
