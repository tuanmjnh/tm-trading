<script setup lang="ts">
import type { Proposal, StrategyResearch } from '~~/types/research'
import type { EvidenceSet } from '~~/types/research'
import type { StrategyProfile } from '~~/types/strategy'
import { getErrorMessage } from '~/shared/utils/errors'

// AI Research workspace (roadmap §58.9 Slice 5, §27 / §57.9-N).
//
// The "Analyze" surface: pick a strategy and read the VERSIONED evidence the AI
// worked from — its profile/version pointer, and every recorded proposal with
// its supporting evidence and sample size. Every evidence row exposes its
// sample count, and a proposal whose evidence is too thin is flagged
// insufficient (D12: the AI must report insufficient sample, never invent it).
//
// The "Proposals" surface: each structured hypothesis (§27.3) can be turned into
// an experiment by a human. That only writes a `proposed` experiment draft — it
// can never touch the live strategy version (D7, §57.11).
const { t } = useI18n()
const notify = useNotify()
const router = useRouter()
const api = useResearch()
const strategies = useStrategies()

const { title, description } = useAdminPageChrome({
  titleKey: 'research.analyzeTitle',
  descKey: 'research.analyzeDesc'
})

const MIN_TRADES = 30

const strategyId = ref('')
const knownStrategies = ref<StrategyProfile[]>([])
const research = ref<StrategyResearch | null>(null)
const allProposals = ref<Proposal[]>([])
const isLoading = ref(false)

// -------- approve → evidence picker (§59.15 Slice E) --------
const showApprove = ref(false)
const pendingProposal = ref<Proposal | null>(null)
const evidenceOptions = ref<EvidenceSet[]>([])
const selectedEvidenceId = ref<string | null>(null)
const evidenceLoading = ref(false)
const approveError = ref('')
const creating = ref(false)

async function load() {
  isLoading.value = true
  try {
    const id = strategyId.value.trim()
    if (id) {
      research.value = await api.strategy(id)
      if (!research.value) research.value = { profile: null, versions: [], experiments: [], proposals: [], mongo: 'down' }
    } else {
      research.value = null
    }
    allProposals.value = await api.proposals({ limit: 100 })
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  knownStrategies.value = await strategies.list()
  await load()
})

const shownProposals = computed<Proposal[]>(() => research.value ? research.value.proposals : allProposals.value)

const profile = computed<Record<string, unknown> | null>(() => research.value?.profile ?? null)
const profileName = computed(() => (profile.value?.name as string) || strategyId.value || '—')
const activeVersion = computed(() => (profile.value?.strategyVersionId as string) || null)

// Evidence limitations (D12): roll up sample sizes across the proposals shown.
const evidenceStats = computed(() => {
  const samples = shownProposals.value.flatMap(p => (p.evidence ?? []).map(e => e.sampleSize))
  const total = samples.reduce((a, b) => a + b, 0)
  const min = samples.length ? Math.min(...samples) : null
  const insufficient = samples.length === 0 || samples.some(s => s < MIN_TRADES)
  return { count: samples.length, total, min, insufficient }
})

const evidenceMetrics = computed(() => [
  { key: 'profile', label: t('research.profileLabel'), value: profileName.value, icon: 'i-lucide-fingerprint' },
  { key: 'version', label: t('research.activeVersionLabel'), value: activeVersion.value || t('research.none'), icon: 'i-lucide-git-commit' },
  { key: 'versions', label: t('research.versionsLabel'), value: String(research.value?.versions.length ?? 0), icon: 'i-lucide-layers' },
  { key: 'samples', label: t('research.sampleTitle'), value: `${t('research.totalSamples')} ${evidenceStats.value.total}`, icon: 'i-lucide-database', tone: evidenceStats.value.insufficient ? 'warning' as const : 'success' as const }
])

const trail = computed(() => [
  { label: t('nav.data_research') },
  { label: title.value }
])

async function approve(proposal: Proposal) {
  // §59.15 Slice E — AI output links to evidence. Before an experiment can be
  // written, the reviewer picks WHICH frozen set the hypothesis came from; an
  // AI-generated proposal cannot be approved without one (the server refuses
  // with evidence_required). Integrity is re-verified server-side on save, not
  // guessed from this list.
  pendingProposal.value = proposal
  selectedEvidenceId.value = proposal.evidenceSetId ?? null
  approveError.value = ''
  evidenceLoading.value = true
  showApprove.value = true
  try {
    evidenceOptions.value = await api.evidenceSets({
      strategyVersionId: proposal.strategyVersionId || undefined,
      limit: 50
    })
    if (!selectedEvidenceId.value && evidenceOptions.value.length) {
      // pre-select the newest set for this version so approving is one click
      selectedEvidenceId.value = evidenceOptions.value[0]?.setId ?? null
    }
  } finally {
    evidenceLoading.value = false
  }
}

async function submitApprove() {
  const proposal = pendingProposal.value
  if (!proposal) return
  const aiGenerated = !!proposal.generation
  if (aiGenerated && !selectedEvidenceId.value) {
    approveError.value = t('research.approve.evidenceRequired')
    return
  }
  creating.value = true
  approveError.value = ''
  try {
    const exp = await api.createExperiment({
      ...proposal,
      evidenceSetId: selectedEvidenceId.value ?? undefined
    } as Proposal)
    notify.success(t('research.createExperiment'))
    showApprove.value = false
    if (exp?._id) router.push(`/data-research/research/experiments/${encodeURIComponent(exp._id)}`)
  } catch (err) {
    approveError.value = getErrorMessage(err, key => t(key))
  } finally {
    creating.value = false
  }
}

const fmtVal = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const fmtChange = (c: { parameter: string; from: unknown; to: unknown }) =>
  `${c.parameter}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="research" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('research.pips.analyze')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-lock"
          :label="t('research.viewEvidenceSets')"
          variant="soft"
          color="neutral"
          size="sm"
          to="/data-research/research/evidence"
          :ui="{ label: 'hidden md:block' }"
        />
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
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UInput
          v-model="strategyId"
          :placeholder="t('research.strategyPlaceholder')"
          icon="i-lucide-search"
          size="xs"
          class="w-56"
          :aria-label="t('research.strategyId')"
          @keyup.enter="load"
        />
        <UButton icon="i-lucide-corner-down-left" :label="t('research.load')" size="xs" color="primary" variant="soft" @click="load" />
        <span v-if="knownStrategies.length" class="text-[11px] text-dimmed ms-1">{{ t('research.knownStrategies') }}</span>
        <UButton
          v-for="s in knownStrategies"
          :key="s._id"
          :label="s.name || s.profileId || s._id"
          size="xs"
          :color="strategyId === s._id ? 'primary' : 'neutral'"
          :variant="strategyId === s._id ? 'soft' : 'ghost'"
          @click="strategyId = s._id; load()"
        />
      </div>
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <UAlert
        v-if="research && research.mongo === 'down'"
        color="warning"
        variant="subtle"
        icon="i-lucide-database-zap"
        :title="t('research.mongoDown')"
      />
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-shield-check"
        :title="t('research.guardrail')"
      />

      <!-- Evidence: the versioned set the AI read -->
      <UCard v-if="research">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('research.evidenceTitle') }}</h3>
            </div>
            <UBadge v-if="research.mongo === 'down'" :label="t('research.mongoDownShort')" color="warning" variant="subtle" size="xs" />
          </div>
        </template>

        <MetricRibbon :items="evidenceMetrics" cols="grid-cols-2 sm:grid-cols-4" />

        <UAlert
          class="mt-4"
          :color="evidenceStats.insufficient ? 'warning' : 'success'"
          variant="subtle"
          :icon="evidenceStats.insufficient ? 'i-lucide-triangle-alert' : 'i-lucide-check-circle'"
          :title="evidenceStats.insufficient ? t('research.insufficientSample') : t('research.sufficient')"
          :description="`${t('research.minSample')}: ${evidenceStats.min ?? 'n/a'} / ${MIN_TRADES}`"
        />
      </UCard>

      <!-- Proposals -->
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-lightbulb" class="w-4 h-4 text-primary" />
        <h3 class="font-semibold text-sm">{{ t('research.proposalsTitle') }}</h3>
        <UBadge :label="`${shownProposals.length}`" variant="subtle" size="xs" />
      </div>

      <div v-if="shownProposals.length" class="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <UCard v-for="p in shownProposals" :key="p.proposalId">
          <template #header>
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-highlighted line-clamp-2">{{ p.hypothesis }}</div>
                <div class="text-[10px] font-mono text-dimmed mt-0.5 truncate">{{ p.proposalId }}</div>
              </div>
              <UBadge v-if="p.status" :label="p.status" color="info" variant="subtle" size="xs" class="shrink-0" />
            </div>
          </template>

          <div class="space-y-4">
            <div v-if="p.strategyVersionId" class="text-[11px] text-muted">
              {{ t('research.targetVersion') }}: <span class="font-mono text-highlighted">{{ p.strategyVersionId }}</span>
            </div>

            <div>
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">{{ t('research.changes') }}</div>
              <div v-if="p.changes?.length" class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="(c, i) in p.changes"
                  :key="i"
                  :label="fmtChange(c)"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  class="font-mono"
                />
              </div>
              <span v-else class="text-[11px] text-dimmed">{{ t('research.none') }}</span>
            </div>

            <div>
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">{{ t('research.evidence') }}</div>
              <div v-if="p.evidence?.length" class="space-y-1">
                <div
                  v-for="(e, i) in p.evidence"
                  :key="i"
                  class="flex items-center justify-between gap-3 text-[11px]"
                >
                  <span class="font-mono text-muted truncate">{{ e.metric }}</span>
                  <span class="flex items-center gap-2 shrink-0">
                    <span class="font-mono text-highlighted">{{ e.value }}</span>
                    <UBadge
                      :label="`n=${e.sampleSize}`"
                      :color="e.sampleSize < MIN_TRADES ? 'warning' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    />
                  </span>
                </div>
              </div>
              <span v-else class="text-[11px] text-dimmed">{{ t('research.evidenceNone') }}</span>
            </div>

            <div v-if="p.risks?.length">
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">{{ t('research.risks') }}</div>
              <ul class="text-[11px] text-muted list-disc list-inside space-y-0.5">
                <li v-for="(r, i) in p.risks" :key="i">{{ r }}</li>
              </ul>
            </div>

            <div>
              <div class="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">{{ t('research.recommendedTest') }}</div>
              <div v-if="p.recommendedTest?.symbols?.length || p.recommendedTest?.timeframes?.length" class="flex flex-wrap gap-1.5">
                <UBadge v-for="s in p.recommendedTest.symbols" :key="`s-${s}`" :label="s" color="primary" variant="subtle" size="xs" class="font-mono" />
                <UBadge v-for="tf in p.recommendedTest.timeframes" :key="`tf-${tf}`" :label="tf" color="info" variant="subtle" size="xs" class="font-mono" />
              </div>
              <span v-else class="text-[11px] text-dimmed">{{ t('research.noTestPlan') }}</span>
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end">
              <UButton
                icon="i-lucide-flask-conical"
                :label="t('research.createExperiment')"
                color="primary"
                variant="soft"
                size="sm"
                :loading="creating && pendingProposal?.proposalId === p.proposalId"
                @click="approve(p)"
              />
            </div>
          </template>
        </UCard>
      </div>

      <div v-else class="py-6">
        <AdminEmptyState
          :title="t('research.proposalsEmpty')"
          :description="t('research.proposalsEmptyDesc')"
          icon="i-lucide-lightbulb"
        />
      </div>
    </div>

    <!-- Approve → pick the evidence the hypothesis came from (§59.15 Slice E) -->
    <UModal v-model:open="showApprove" :title="t('research.approve.title')" size="lg">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">{{ t('research.approve.desc') }}</p>

          <div class="text-xs text-dimmed truncate">
            {{ pendingProposal?.proposalId }} · {{ pendingProposal?.hypothesis?.slice(0, 80) }}
          </div>

          <div v-if="evidenceLoading" class="flex items-center gap-2 text-sm text-muted py-4">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-primary" />
            {{ t('research.approve.loadingEvidence') }}
          </div>

          <UAlert
            v-else-if="!evidenceOptions.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('research.approve.noEvidence')"
            :description="t('research.approve.noEvidenceHint')"
          />

          <div v-else class="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            <UButton
              v-for="s in evidenceOptions"
              :key="s.setId"
              :color="selectedEvidenceId === s.setId ? 'primary' : 'neutral'"
              :variant="selectedEvidenceId === s.setId ? 'soft' : 'ghost'"
              size="sm"
              class="justify-start h-auto py-2 flex-col items-start gap-1"
              @click="selectedEvidenceId = s.setId"
            >
              <span class="flex items-center gap-2 w-full flex-wrap">
                <UIcon
                  :name="selectedEvidenceId === s.setId ? 'i-lucide-circle-dot' : 'i-lucide-circle'"
                  class="w-3.5 h-3.5 shrink-0"
                />
                <span class="font-mono text-[11px] truncate">{{ s.setId }}</span>
                <UBadge
                  :label="t(`research.sets.kinds.${s.kind}`)"
                  color="info"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
                <UBadge
                  v-if="s.metrics && !s.metrics.sufficient"
                  :label="t('research.insufficientSample')"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
                <UBadge
                  v-if="s.sealed === false"
                  :label="t('research.sets.detail.moving')"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
              </span>
              <span class="text-[11px] text-muted ps-6 text-left">
                {{ t('research.sets.columns.trades') }}: {{ s.metrics?.trades ?? 0 }} ·
                {{ s.strategyVersionId || '—' }} ·
                {{ s.pointInTime?.frozenAt ? new Date(s.pointInTime.frozenAt).toLocaleString() : '—' }}
              </span>
            </UButton>
          </div>

          <UAlert
            v-if="approveError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="approveError"
          />

          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-shield-check"
            :title="t('research.approve.verifyNote')"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton :label="t('global.cancel')" color="neutral" variant="ghost" :disabled="creating" @click="showApprove = false" />
          <UButton
            icon="i-lucide-flask-conical"
            :label="t('research.createExperiment')"
            color="primary"
            variant="soft"
            :loading="creating"
            @click="submitApprove"
          />
        </div>
      </template>
    </UModal>
  </BasePage>
</template>
