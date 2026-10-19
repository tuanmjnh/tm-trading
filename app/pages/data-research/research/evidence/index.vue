<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { EvidenceKind, EvidenceSet } from '~~/types/research'
import { getErrorMessage } from '~/shared/utils/errors'

// Research Evidence Sets (roadmap §59.15 Slice E).
//
// Every claim in the research workspace must be re-openable. This page lists the
// frozen sets: a bundle of the facts (trades, manifest, dataset identity,
// limitations) a conclusion was drawn from, hashed so an edit after the freeze
// is detectable. Freezing is write-once and deterministic — the set id is
// derived from its source, so a repeat freeze returns the set that already
// exists instead of forking a second version of the same run.
//
// Nothing here is a trade action: a set is evidence, and evidence never places
// an order (D7).
const { t } = useI18n()
const notify = useNotify()
const router = useRouter()
const api = useResearch()

const { title, description } = useAdminPageChrome({
  titleKey: 'research.sets.title',
  descKey: 'research.sets.desc'
})
const { viewMode } = useAdminGridView('research-evidence-view-mode')

const KINDS: EvidenceKind[] = ['paper-session', 'replay-session', 'backtest-run', 'dataset']

const rows = ref<EvidenceSet[]>([])
const isLoading = ref(false)
const kindFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    // Fetch once, filter by kind client-side so the chip counts describe the
    // whole store rather than a server-narrowed slice.
    rows.value = await api.evidenceSets({ limit: 200 })
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const filtered = computed(() =>
  kindFilter.value ? rows.value.filter(r => r.kind === kindFilter.value) : rows.value)

const kindChips = computed(() => [
  { value: '', label: t('research.sets.kinds.all'), count: rows.value.length },
  ...KINDS.map(k => ({
    value: k,
    label: t(`research.sets.kinds.${k}`),
    count: rows.value.filter(r => r.kind === k).length
  }))
])

// A set below the trade floor cannot support a conclusion. It is still listed —
// hiding it would hide the reason a hypothesis was refused (D12).
const insufficientCount = computed(() => rows.value.filter(r => !r.metrics?.sufficient).length)
const unsealedCount = computed(() => rows.value.filter(r => r.sealed === false).length)

const metrics = computed(() => [
  { key: 'total', label: t('research.sets.rollup.total'), value: String(rows.value.length), icon: 'i-lucide-lock' },
  {
    key: 'insufficient',
    label: t('research.sets.rollup.insufficient'),
    value: String(insufficientCount.value),
    icon: 'i-lucide-triangle-alert',
    tone: insufficientCount.value ? 'warning' as const : 'default' as const
  },
  {
    key: 'moving',
    label: t('research.sets.rollup.moving'),
    value: String(unsealedCount.value),
    icon: 'i-lucide-activity',
    tone: unsealedCount.value ? 'warning' as const : 'default' as const
  },
  {
    key: 'cited',
    label: t('research.sets.rollup.cited'),
    value: String(rows.value.filter(r => (r.usedByExperimentIds ?? []).length > 0).length),
    icon: 'i-lucide-flask-conical',
    tone: 'primary' as const
  }
])

const trail = computed(() => [
  { label: t('nav.data_research') },
  { label: t('research.sets.title') }
])

// -------- freeze one source --------
const showFreeze = ref(false)
const freezeKind = ref<EvidenceKind>('paper-session')
const freezeSource = ref('')
const freezeNotes = ref('')
const freezeError = ref('')
const freezing = ref(false)

function openFreeze(sourceId = '') {
  freezeSource.value = sourceId
  freezeNotes.value = ''
  freezeError.value = ''
  showFreeze.value = true
}

async function submitFreeze() {
  freezeError.value = ''
  if (!freezeSource.value.trim()) {
    freezeError.value = t('research.sets.freeze.sourceRequired')
    return
  }
  freezing.value = true
  try {
    const doc = await api.freezeEvidence({
      kind: freezeKind.value,
      sourceId: freezeSource.value.trim(),
      notes: freezeNotes.value.split('\n').map(s => s.trim()).filter(Boolean)
    })
    notify.success(
      doc.alreadyFrozen ? t('research.sets.freeze.alreadyFrozen') : t('research.sets.freeze.success')
    )
    if (doc.sourceChanged) notify.warning(t('research.sets.freeze.sourceChanged'))
    showFreeze.value = false
    await refresh()
    if (doc.setId) router.push(`/data-research/research/evidence/${encodeURIComponent(doc.setId)}`)
  } catch (err) {
    freezeError.value = getErrorMessage(err, key => t(key))
  } finally {
    freezing.value = false
  }
}

const openDetail = (item: EvidenceSet) =>
  router.push(`/data-research/research/evidence/${encodeURIComponent(item.setId || item._id)}`)

const fmtDate = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleString() : '—')
const shortHash = (h: string | undefined) => (h ? `${String(h).slice(0, 14)}…` : '—')

const columns = computed<GridColumn[]>(() => [
  { key: 'setId', label: t('research.sets.columns.source'), class: 'min-w-64' },
  { key: 'kind', label: t('research.sets.columns.kind'), class: 'w-40' },
  { key: 'strategyVersionId', label: t('research.sets.columns.version'), class: 'w-40' },
  { key: 'trades', label: t('research.sets.columns.trades'), class: 'w-24' },
  { key: 'hash', label: t('research.sets.columns.hash'), class: 'w-40' },
  { key: 'frozenAt', label: t('research.sets.columns.frozen'), class: 'w-44' },
  { key: 'open', label: '', class: 'w-12' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-lock', label: t('research.sets.freeze.action'), onSelect: () => openFreeze() },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="research-evidence" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('research.pips.evidence')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-test-tube"
          :label="t('research.viewExperiments')"
          variant="soft"
          color="neutral"
          size="sm"
          to="/data-research/research/experiments"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-lock"
          :label="t('research.sets.freeze.action')"
          variant="soft"
          color="primary"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="openFreeze()"
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
        <FilterChips v-model="kindFilter" :items="kindChips" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-fingerprint"
        :title="t('research.sets.guardrail')"
      />

      <MetricRibbon :items="metrics" />

      <LazyGridList
        v-model:view-mode="viewMode"
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        item-key="setId"
        storage-key="research-evidence-view-mode"
        @refresh="refresh"
      >
        <template #setId="{ item }">
          <div class="min-w-0">
            <div class="text-[11px] font-mono text-highlighted truncate">{{ item.setId || item._id }}</div>
            <div class="text-[10px] text-dimmed truncate">{{ item.sourceId }}</div>
          </div>
        </template>

        <template #kind="{ item }">
          <UBadge :label="t(`research.sets.kinds.${item.kind}`)" color="info" variant="subtle" size="xs" />
        </template>

        <template #strategyVersionId="{ item }">
          <span class="text-[11px] font-mono text-muted truncate">{{ item.strategyVersionId || '—' }}</span>
        </template>

        <template #trades="{ item }">
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] font-mono text-highlighted">{{ item.metrics?.trades ?? 0 }}</span>
            <UBadge
              v-if="item.metrics && !item.metrics.sufficient"
              :label="t('research.insufficientSample')"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
        </template>

        <template #hash="{ item }">
          <span class="text-[10px] font-mono text-dimmed" :title="item.hash">{{ shortHash(item.hash) }}</span>
        </template>

        <template #frozenAt="{ item }">
          <div class="text-[11px] text-muted">{{ fmtDate(item.pointInTime?.frozenAt) }}</div>
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
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs">
              <UBadge :label="t(`research.sets.kinds.${item.kind}`)" color="info" variant="subtle" size="xs" class="shrink-0" />
              <span class="font-mono text-[10px] text-dimmed truncate">{{ item.setId || item._id }}</span>
            </div>
            <div class="text-[11px] text-muted mt-0.5">
              {{ t('research.sets.columns.trades') }}: {{ item.metrics?.trades ?? 0 }} ·
              {{ fmtDate(item.pointInTime?.frozenAt) }}
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('research.sets.empty')"
            :description="t('research.sets.emptyHint')"
            icon="i-lucide-lock"
          />
        </template>
      </LazyGridList>
    </div>

    <UModal v-model:open="showFreeze" :title="t('research.sets.freeze.title')">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">{{ t('research.sets.freeze.desc') }}</p>

          <div class="flex items-center gap-1 flex-wrap">
            <UButton
              v-for="k in KINDS"
              :key="k"
              :label="t(`research.sets.kinds.${k}`)"
              size="xs"
              :color="freezeKind === k ? 'primary' : 'neutral'"
              :variant="freezeKind === k ? 'soft' : 'ghost'"
              @click="freezeKind = k"
            />
          </div>

          <UInput
            v-model="freezeSource"
            :placeholder="t('research.sets.freeze.sourceIdPlaceholder')"
            icon="i-lucide-search"
            size="sm"
            class="w-full font-mono"
            :aria-label="t('research.sets.freeze.sourceId')"
          />

          <UTextarea
            v-model="freezeNotes"
            :placeholder="t('research.sets.freeze.notesPlaceholder')"
            :rows="3"
            class="w-full text-xs"
            :aria-label="t('research.sets.freeze.notes')"
          />

          <UAlert v-if="freezeError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="freezeError" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton :label="t('global.cancel')" color="neutral" variant="ghost" :disabled="freezing" @click="showFreeze = false" />
          <UButton
            icon="i-lucide-lock"
            :label="t('research.sets.freeze.confirm')"
            color="primary"
            variant="soft"
            :loading="freezing"
            @click="submitFreeze"
          />
        </div>
      </template>
    </UModal>
  </BasePage>
</template>
